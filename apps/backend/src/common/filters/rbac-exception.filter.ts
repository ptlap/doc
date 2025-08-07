import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

@Catch(ForbiddenException)
export class RbacExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RbacExceptionFilter.name);

  catch(exception: ForbiddenException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithUser>();
    const status = exception.getStatus();

    const user = request.user;
    const method = request.method;
    const url = request.url;
    const timestamp = new Date().toISOString();

    // Enhanced error message based on context
    let enhancedMessage = 'Access denied';
    let errorCode = 'RBAC_ACCESS_DENIED';
    let details: Record<string, unknown> = {};

    // Determine the type of access denial
    if (url.includes('/admin/')) {
      enhancedMessage = 'Administrator privileges required';
      errorCode = 'RBAC_ADMIN_REQUIRED';
      details = {
        requiredRole: 'admin',
        currentRole: user?.role || 'unknown',
        resource: 'admin',
        action: this.extractActionFromMethod(method),
      };
    } else if (url.includes('/management/')) {
      enhancedMessage = 'Management access required';
      errorCode = 'RBAC_MANAGEMENT_ACCESS_REQUIRED';
      details = {
        requiredRoles: ['admin'],
        currentRole: user?.role || 'unknown',
        resource: 'management',
        action: this.extractActionFromMethod(method),
      };
    } else {
      // Generic role-based access denial
      enhancedMessage = 'Insufficient permissions for this resource';
      errorCode = 'RBAC_INSUFFICIENT_PERMISSIONS';
      details = {
        currentRole: user?.role || 'unknown',
        resource: this.extractResourceFromUrl(url),
        action: this.extractActionFromMethod(method),
      };
    }

    // Log the access denial for security monitoring
    this.logger.warn(
      `Access denied: User ${user?.email || 'unknown'} (${user?.role || 'unknown'}) attempted ${method} ${url}`,
      {
        userId: user?.id,
        userEmail: user?.email,
        userRole: user?.role,
        method,
        url,
        timestamp,
        errorCode,
      },
    );

    const errorResponse = {
      statusCode: status,
      timestamp,
      path: url,
      method,
      error: 'Forbidden',
      message: enhancedMessage,
      errorCode,
      details,
      // Include user context for debugging (remove in production if sensitive)
      user: user
        ? {
            role: user.role,
            // Don't include sensitive info like email in production
            ...(process.env.NODE_ENV === 'development' && {
              email: user.email,
            }),
          }
        : null,
      // Help information
      help: this.getHelpMessage(errorCode, user?.role),
    };

    response.status(status).json(errorResponse);
  }

  private extractActionFromMethod(method: string): string {
    const actionMap: Record<string, string> = {
      GET: 'read',
      POST: 'create',
      PUT: 'update',
      PATCH: 'update',
      DELETE: 'delete',
    };
    return actionMap[method] || 'unknown';
  }

  private extractResourceFromUrl(url: string): string {
    // Extract resource from URL path
    const pathSegments = url
      .split('/')
      .filter((segment) => segment && !segment.match(/^\d+$/));

    if (pathSegments.length >= 1) {
      // Handle /api/resource pattern
      if (pathSegments[0] === 'api' && pathSegments.length >= 2) {
        return pathSegments[1]; // e.g., /api/projects/123 -> projects
      }
      return pathSegments[0]; // e.g., /projects/123 -> projects, /upload/document -> upload
    }

    return 'unknown';
  }

  private getHelpMessage(errorCode: string, userRole?: string): string {
    switch (errorCode) {
      case 'RBAC_ADMIN_REQUIRED':
        return 'This endpoint requires administrator privileges. Contact your system administrator if you need access.';

      case 'RBAC_MANAGEMENT_ACCESS_REQUIRED':
        return 'This endpoint requires management access. Only administrators can access management functions.';

      case 'RBAC_INSUFFICIENT_PERMISSIONS':
        if (userRole === 'guest') {
          return 'Guest users have limited access. Please register for a full account or contact support.';
        } else if (userRole === 'user') {
          return 'This action requires elevated permissions. Contact your administrator if you need access.';
        }
        return 'You do not have sufficient permissions for this action.';

      default:
        return 'Access denied. Please check your permissions or contact support.';
    }
  }
}
