import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RbacExceptionFilter } from './rbac-exception.filter';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly rbacExceptionFilter = new RbacExceptionFilter();

  catch(exception: unknown, host: ArgumentsHost): void {
    // Delegate ForbiddenException to RbacExceptionFilter for enhanced error messages
    if (exception instanceof ForbiddenException) {
      this.rbacExceptionFilter.catch(exception, host);
      return;
    }
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();

      if (typeof errorResponse === 'object' && errorResponse !== null) {
        const errorObj = errorResponse as Record<string, any>;
        message = (errorObj.message as string) || exception.message;
        error = (errorObj.error as string) || 'Http Exception';
      } else {
        message = String(errorResponse);
        error = 'Http Exception';
      }
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message;
      error = 'Internal Server Error';
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred';
      error = 'Internal Server Error';
    }

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      error,
      message,
      ...(process.env.NODE_ENV === 'development' && {
        stack: exception instanceof Error ? exception.stack : undefined,
      }),
    };

    // Log the error
    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
      exception instanceof Error ? exception.stack : exception,
    );

    response.status(status).json(errorResponse);
  }
}
