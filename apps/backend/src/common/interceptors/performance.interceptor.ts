import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { PERFORMANCE_MONITOR_KEY } from '../decorators/performance-monitor.decorator';

interface PerformanceOptions {
  threshold: number;
  logSlowQueries: boolean;
  trackMemory: boolean;
}

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PerformanceInterceptor.name);

  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const performanceOptions =
      this.reflector.getAllAndOverride<PerformanceOptions>(
        PERFORMANCE_MONITOR_KEY,
        [context.getHandler(), context.getClass()],
      );

    // If no performance monitoring is configured, proceed normally
    if (!performanceOptions) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const method: string = request.method;
    const url: string = request.url;
    const startTime = Date.now();
    const startMemory = performanceOptions.trackMemory
      ? process.memoryUsage()
      : null;

    return next.handle().pipe(
      tap({
        next: () => {
          this.logPerformance(
            method,
            url,
            startTime,
            startMemory,
            performanceOptions,
            'success',
          );
        },
        error: (error: unknown) => {
          this.logPerformance(
            method,
            url,
            startTime,
            startMemory,
            performanceOptions,
            'error',
            error as Error,
          );
        },
      }),
    );
  }

  private logPerformance(
    method: string,
    url: string,
    startTime: number,
    startMemory: NodeJS.MemoryUsage | null,
    options: PerformanceOptions,
    status: 'success' | 'error',
    error?: Error,
  ) {
    const duration = Date.now() - startTime;
    const isSlow = duration > options.threshold;

    // Always log slow requests
    if (isSlow) {
      const logData: Record<string, unknown> = {
        method,
        url,
        duration: `${duration}ms`,
        status,
        threshold: `${options.threshold}ms`,
      };

      if (startMemory && options.trackMemory) {
        const endMemory = process.memoryUsage();
        logData.memoryUsage = {
          heapUsedDelta: `${Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(endMemory.heapTotal / 1024 / 1024)}MB`,
        };
      }

      if (error) {
        logData.error =
          error instanceof Error ? error.message : 'Unknown error';
      }

      this.logger.warn(`Slow request detected: ${JSON.stringify(logData)}`);
    } else {
      // Log normal requests at debug level
      this.logger.debug(`${method} ${url} - ${duration}ms - ${status}`);
    }

    // Log to metrics collection system (if available)
    this.collectMetrics(method, url, duration, status, isSlow);
  }

  private collectMetrics(
    method: string,
    url: string,
    duration: number,
    status: 'success' | 'error',
    isSlow: boolean,
  ) {
    // This is where you would integrate with your metrics collection system
    // Examples: Prometheus, DataDog, New Relic, etc.

    // For now, we'll just store in memory (in production, use proper metrics store)
    const metricsKey = `${method}:${url}`;

    // You could implement a simple in-memory metrics store here
    // or integrate with external monitoring services

    if (process.env.NODE_ENV === 'development') {
      console.debug(
        `Metrics: ${metricsKey} - ${duration}ms - ${status} - slow: ${isSlow}`,
      );
    }
  }
}
