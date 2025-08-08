import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../services/prisma.service';
import { PermissionsService } from '../services/permissions.service';
import type { Request } from 'express';
import {
  POLICY_KEY,
  PolicyDescriptor,
  PolicyRule,
} from '../decorators/policy.decorator';
import { Role } from '../enums/role.enum';

type RequestUser = {
  id: string;
  email?: string;
  role: Role | string;
  tenantId?: string | null;
};

const isRequestUser = (u: unknown): u is RequestUser => {
  if (typeof u !== 'object' || u === null) return false;
  const maybe = u as { id?: unknown; role?: unknown };
  return typeof maybe.id === 'string' && typeof maybe.role === 'string';
};

type RequestWithUser = Request & {
  user?: RequestUser;
  params?: Record<string, string>;
};

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const policy = this.reflector.get<PolicyDescriptor | undefined>(
      POLICY_KEY,
      handler,
    );
    if (!policy) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!isRequestUser(user)) {
      // Not authenticated properly
      throw new ForbiddenException('Insufficient permissions');
    }

    // Normalize role to Role enum when possible
    const role: Role = (Object.values(Role) as string[]).includes(user.role)
      ? (user.role as Role)
      : Role.GUEST;

    const evaluateRule = async (
      rule: PolicyRule,
    ): Promise<{ permOk: boolean; whereOk: boolean }> => {
      const perms = this.permissionsService.getPermissionsForRole(role);
      const permOk = perms.has(rule.perm);
      if (!permOk) return { permOk: false, whereOk: false };

      // Evaluate where conditions
      if (!rule.where) return { permOk: true, whereOk: true };

      const { ownerId } = rule.where;
      if (ownerId === 'self') {
        const paramId: string | undefined = request.params?.id;
        if (!paramId) return { permOk: true, whereOk: false };

        // Infer resource from route prefix. Support /projects/:id
        const url: string = request.url || '';
        if (url.startsWith('/projects/')) {
          const project = await this.prisma.project.findFirst({
            where: { id: paramId, userId: user.id },
            select: { id: true },
          });
          return { permOk: true, whereOk: !!project };
        }

        // Unknown resource: cannot prove ownership
        return { permOk: true, whereOk: false };
      }

      return { permOk: true, whereOk: false };
    };

    const anyOf = policy.anyOf || [];
    const allOf = policy.allOf || [];

    // Evaluate all rules
    const anyResults = await Promise.all(anyOf.map(evaluateRule));
    const allResults = await Promise.all(allOf.map(evaluateRule));

    // Determine outcome
    const anySatisfied =
      anyResults.length === 0
        ? true
        : anyResults.some((r) => r.permOk && r.whereOk);
    const allSatisfied =
      allResults.length === 0
        ? true
        : allResults.every((r) => r.permOk && r.whereOk);

    if (anySatisfied && allSatisfied) {
      return true;
    }

    // Decide error type: Forbidden if no permission; NotFound if permission exists but where fails
    const anyPermButWhereFailed = anyResults.some(
      (r) => r.permOk && !r.whereOk,
    );
    const allPermButSomeWhereFailed = allResults.some(
      (r) => r.permOk && !r.whereOk,
    );
    const anyPermFailed =
      anyResults.some((r) => !r.permOk) || allResults.some((r) => !r.permOk);

    if (anyPermButWhereFailed || allPermButSomeWhereFailed) {
      throw new NotFoundException('Resource not found');
    }

    if (anyPermFailed) {
      throw new ForbiddenException('Insufficient permissions');
    }

    // Fallback
    throw new ForbiddenException('Insufficient permissions');
  }
}
