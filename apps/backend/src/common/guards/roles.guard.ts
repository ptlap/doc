import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

interface RequestWithUser {
  user: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
  };
}

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required roles from decorator
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Get user from request (should be set by JwtAuthGuard)
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // Check if user exists (should be guaranteed by JwtAuthGuard)
    if (!user) {
      this.logger.warn('RolesGuard: No user found in request. Make sure JwtAuthGuard runs before RolesGuard.');
      return false;
    }

    // Check if user is active
    if (!user.isActive) {
      this.logger.warn(`RolesGuard: Inactive user ${user.email} attempted to access protected resource`);
      return false;
    }

    // Check if user's role is in the required roles
    const hasRequiredRole = requiredRoles.some((role) => user.role === role);

    if (!hasRequiredRole) {
      this.logger.warn(
        `RolesGuard: User ${user.email} with role '${user.role}' attempted to access resource requiring roles: [${requiredRoles.join(', ')}]`
      );
    } else {
      this.logger.debug(
        `RolesGuard: User ${user.email} with role '${user.role}' granted access to resource requiring roles: [${requiredRoles.join(', ')}]`
      );
    }

    return hasRequiredRole;
  }
}