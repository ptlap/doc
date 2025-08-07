import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './roles.decorator';
import { Role } from '../enums/role.enum';

/**
 * Composite decorator for endpoints accessible by users and admins
 * Combines authentication, authorization, and API documentation
 *
 * @example
 * ```typescript
 * @UserOrAdmin()
 * @Get('dashboard')
 * getDashboard() {
 *   return this.userService.getDashboard();
 * }
 * ```
 */
export function UserOrAdmin() {
  return applyDecorators(
    UseGuards(JwtAuthGuard, RolesGuard),
    Roles(Role.USER, Role.ADMIN),
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
            example: 'Insufficient permissions for this resource',
          },
          errorCode: {
            type: 'string',
            example: 'RBAC_INSUFFICIENT_PERMISSIONS',
          },
          details: {
            type: 'object',
            properties: {
              currentRole: { type: 'string', example: 'guest' },
              resource: { type: 'string', example: 'projects' },
              action: { type: 'string', example: 'read' },
            },
          },
          help: {
            type: 'string',
            example:
              'Guest users have limited access. Please register for a full account or contact support.',
          },
        },
      },
    }),
  );
}
