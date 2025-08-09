import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { from } from 'rxjs';
import { mergeMap, tap } from 'rxjs/operators';
import type { Request } from 'express';
import { PrismaService } from '../services/prisma.service';
import { RequestContextService } from '../services/request-context.service';
import { Role } from '../enums/role.enum';

type RequestUser = { id: string; role: string; tenantId?: string };

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();
    const user = req.user;

    return from(this.applyTenantContext(req, user)).pipe(
      mergeMap(() => next.handle()),
      tap(() => {
        this.prisma.clearTenantId();
      }),
    );
  }

  private isUuid(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }

  private isRole(value: unknown): value is Role {
    return (
      typeof value === 'string' &&
      (Object.values(Role) as string[]).includes(value)
    );
  }

  private isAdminRole(role: unknown): boolean {
    return this.isRole(role) && role === Role.ADMIN;
  }

  private async applyTenantContext(
    req: Request & { user?: RequestUser },
    user?: RequestUser,
  ): Promise<void> {
    let effectiveTenantId: string | undefined =
      typeof user?.tenantId === 'string' ? user?.tenantId : undefined;

    const requestedTenantIdHeader = req.headers['x-tenant-id'];
    const requestedTenantId = Array.isArray(requestedTenantIdHeader)
      ? requestedTenantIdHeader[0]
      : requestedTenantIdHeader;

    // Allow ADMIN to switch tenant via header if valid UUID and tenant exists
    if (this.isAdminRole(user?.role) && this.isUuid(requestedTenantId)) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM tenants WHERE id = ${requestedTenantId}::uuid LIMIT 1
      `;
      const foundId: unknown =
        Array.isArray(rows) && rows.length > 0 ? rows[0]?.id : undefined;
      if (typeof foundId === 'string') {
        effectiveTenantId = foundId;
        // Audit the tenant switch action
        try {
          await this.prisma.auditLog.create({
            data: {
              userId: user?.id,
              action: 'tenant_switch',
              resourceType: 'tenant',
              resourceId: foundId,
              oldValues: { previousTenantId: user?.tenantId ?? null },
              newValues: { selectedTenantId: foundId },
              ipAddress: (req.ip || undefined) as unknown as string,
              userAgent:
                typeof req.headers['user-agent'] === 'string'
                  ? req.headers['user-agent']
                  : undefined,
            },
          });
        } catch {
          // Avoid failing the request on audit issues
        }
      }
    }

    this.prisma.setTenantId(effectiveTenantId);
    if (typeof effectiveTenantId === 'string') {
      this.requestContext.set('tenantId', effectiveTenantId);
    }
  }
}
