import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

/**
 * Composite decorator for endpoints that require authentication only (no role check)
 * Combines authentication and API documentation
 *
 * @example
 * ```typescript
 * @Authenticated()
 * @Get('profile')
 * getProfile() {
 *   return this.userService.getProfile();
 * }
 * ```
 */
export function Authenticated() {
  return applyDecorators(
    UseGuards(JwtAuthGuard),
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
  );
}
