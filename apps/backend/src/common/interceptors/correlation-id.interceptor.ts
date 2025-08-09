import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { RequestContextService } from '../services/request-context.service';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(private readonly requestContext: RequestContextService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const existing = req.headers['x-correlation-id'];
    const correlationId = Array.isArray(existing)
      ? existing[0]
      : existing || randomUUID();

    res.setHeader('X-Correlation-Id', correlationId);

    // Store into ALS for downstream usage
    this.requestContext.set('correlationId', String(correlationId));

    return next.handle().pipe(
      tap(() => {
        // no-op; header is already set
      }),
    );
  }
}
