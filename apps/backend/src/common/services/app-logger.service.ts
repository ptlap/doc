import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContextService } from './request-context.service';

export interface LogContext {
  userId?: string;
  requestId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  duration?: number;
  [key: string]: any;
}

@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly logger = new Logger(AppLoggerService.name);
  private readonly logLevel: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    this.logLevel = this.configService.get<string>('logging.level', 'info');
  }

  /**
   * Write a 'log' level log.
   */
  log(message: any, context?: string | LogContext): void {
    if (typeof context === 'string') {
      this.logger.log(message, context);
    } else {
      this.logger.log(this.formatMessage(String(message), context));
    }
  }

  /**
   * Write an 'error' level log.
   */
  error(message: any, trace?: string, context?: string | LogContext): void {
    if (typeof context === 'string') {
      this.logger.error(message, trace, context);
    } else {
      this.logger.error(this.formatMessage(String(message), context), trace);
    }
  }

  /**
   * Write a 'warn' level log.
   */
  warn(message: any, context?: string | LogContext): void {
    if (typeof context === 'string') {
      this.logger.warn(message, context);
    } else {
      this.logger.warn(this.formatMessage(String(message), context));
    }
  }

  /**
   * Write a 'debug' level log.
   */
  debug(message: any, context?: string | LogContext): void {
    if (this.shouldLog('debug')) {
      if (typeof context === 'string') {
        this.logger.debug(message, context);
      } else {
        this.logger.debug(this.formatMessage(String(message), context));
      }
    }
  }

  /**
   * Write a 'verbose' level log.
   */
  verbose(message: any, context?: string | LogContext): void {
    if (this.shouldLog('verbose')) {
      if (typeof context === 'string') {
        this.logger.verbose(message, context);
      } else {
        this.logger.verbose(this.formatMessage(String(message), context));
      }
    }
  }

  /**
   * Log HTTP request
   */
  logRequest(method: string, url: string, context?: LogContext): void {
    this.log(`${method} ${url}`, {
      ...context,
      method,
      url,
      type: 'request',
    });
  }

  /**
   * Log HTTP response
   */
  logResponse(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    context?: LogContext,
  ): void {
    const level = statusCode >= 400 ? 'error' : 'log';
    const message = `${method} ${url} - ${statusCode} - ${duration}ms`;

    if (level === 'error') {
      this.error(message, undefined, {
        ...context,
        method,
        url,
        statusCode,
        duration,
        type: 'response',
      });
    } else {
      this.log(message, {
        ...context,
        method,
        url,
        statusCode,
        duration,
        type: 'response',
      });
    }
  }

  /**
   * Log database operation
   */
  logDatabase(
    operation: string,
    table: string,
    duration?: number,
    context?: LogContext,
  ): void {
    this.debug(
      `DB ${operation} on ${table}${duration ? ` - ${duration}ms` : ''}`,
      {
        ...context,
        operation,
        table,
        duration,
        type: 'database',
      },
    );
  }

  /**
   * Log business operation
   */
  logBusiness(
    operation: string,
    entity: string,
    entityId?: string,
    context?: LogContext,
  ): void {
    this.log(`${operation} ${entity}${entityId ? ` (${entityId})` : ''}`, {
      ...context,
      operation,
      entity,
      entityId,
      type: 'business',
    });
  }

  /**
   * Log security event
   */
  logSecurity(event: string, context?: LogContext): void {
    this.warn(`SECURITY: ${event}`, {
      ...context,
      type: 'security',
    });
  }

  private formatMessage(message: string, context?: LogContext): string {
    if (!context) return message;

    const enrich: LogContext = {
      ...context,
      requestId: context.requestId ?? this.requestContext.get('correlationId'),
    };

    const contextStr = Object.entries(enrich)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');

    return `${message} | ${contextStr}`;
  }

  private shouldLog(level: string): boolean {
    const levels = ['error', 'warn', 'log', 'debug', 'verbose'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const requestedLevelIndex = levels.indexOf(level);

    return requestedLevelIndex <= currentLevelIndex;
  }
}
