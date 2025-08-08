import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request } from 'express';

@Catch(UnauthorizedException)
export class AuthExceptionFilter implements ExceptionFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Ensure clients know authentication is required
    response.setHeader('WWW-Authenticate', 'Bearer');

    const status = exception.getStatus();
    const body = exception.getResponse();

    const payload =
      typeof body === 'string'
        ? { message: body }
        : (body as Record<string, unknown>);

    response.status(status).json({
      statusCode: status,
      error: 'Unauthorized',
      path: request.url,
      timestamp: new Date().toISOString(),
      ...payload,
    });
  }
}
