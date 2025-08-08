import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Request } from 'express';
import { Role } from '../enums/role.enum';

type RequestUser = { id: string; role: string };

@Injectable()
export class RedactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();
    const user = req.user;

    // Type guard for Role
    const isRole = (value: unknown): value is Role => {
      return (
        typeof value === 'string' &&
        (Object.values(Role) as string[]).includes(value)
      );
    };

    const roleUnknown: unknown = user?.role;
    const isAdmin = isRole(roleUnknown) && roleUnknown === Role.ADMIN;
    const userId = typeof user?.id === 'string' ? user?.id : undefined;

    return next
      .handle()
      .pipe(
        map((data: unknown) =>
          this.redact(data, { isAdmin, viewerId: userId }),
        ),
      );
  }

  private redact(
    data: unknown,
    ctx: { isAdmin: boolean; viewerId?: string },
  ): unknown {
    if (data === null || data === undefined) return data;
    if (Array.isArray(data)) return data.map((d) => this.redact(d, ctx));
    if (typeof data !== 'object') return data;

    const obj = { ...(data as Record<string, unknown>) };

    // basic user redaction
    if (!ctx.isAdmin) {
      if (typeof obj['userId'] === 'string' && obj['userId'] !== ctx.viewerId) {
        // non-owner & non-admin: hide PII-like fields if present
        if ('email' in obj) delete obj['email'];
        if ('token' in obj) delete obj['token'];
      }
    }

    // deep redact
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (Array.isArray(value)) {
        obj[key] = value.map((v) => this.redact(v, ctx));
      } else if (typeof value === 'object' && value !== null) {
        obj[key] = this.redact(value, ctx) as any;
      }
    }

    return obj;
  }
}
