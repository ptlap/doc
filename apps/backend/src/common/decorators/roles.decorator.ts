import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for accessing an endpoint
 * @param roles - Array of roles that can access the endpoint
 * 
 * @example
 * ```typescript
 * @Roles(Role.ADMIN)
 * @Get('admin-only')
 * adminOnlyEndpoint() {
 *   return 'Admin only content';
 * }
 * 
 * @Roles(Role.ADMIN, Role.USER)
 * @Get('user-content')
 * userContent() {
 *   return 'Content for admin and users';
 * }
 * ```
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);