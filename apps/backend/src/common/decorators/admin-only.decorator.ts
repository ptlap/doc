import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './roles.decorator';
import { Role } from '../enums/role.enum';

/**
 * Composite decorator for admin-only endpoints
 * Combines authentication, authorization, and API documentation
 *
 * @example
 * ```typescript
 * @AdminOnly()
 * @Get('users')
 * getUsers() {
 *   return this.adminService.getUsers();
 * }
 * ```
 */
export function AdminOnly() {
  return applyDecorators(
    UseGuards(JwtAuthGuard, RolesGuard),
    Roles(Role.ADMIN),
    ApiBearerAuth(),
    ApiResponse({
      status: 401,
      description: 'Unauthorized - invalid or missing token',
      schema: {
        type: 'object',
        properties: {
          statusCode: { type: 'number', example: 401 },
          message: { type: 'string', example: 'Unauthorized' },
          error: { type: 'string', example: 'Unauthorized' },
        },
      },
    }),
    ApiResponse({
      status: 403,
      description: 'Forbidden - insufficient permissions',
      schema: {
        type: 'object',
        properties: {
          statusCode: { type: 'number', example: 403 },
          message: {
            type: 'string',
            example: 'Administrator privileges required',
          },
          errorCode: { type: 'string', example: 'RBAC_ADMIN_REQUIRED' },
          details: {
            type: 'object',
            properties: {
              requiredRole: { type: 'string', example: 'admin' },
              currentRole: { type: 'string', example: 'user' },
              resource: { type: 'string', example: 'admin' },
              action: { type: 'string', example: 'read' },
            },
          },
          help: {
            type: 'string',
            example:
              'This endpoint requires administrator privileges. Contact your system administrator if you need access.',
          },
        },
      },
    }),
  );
}
