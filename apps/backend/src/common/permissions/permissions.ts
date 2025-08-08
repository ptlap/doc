import { Role } from '../enums/role.enum';

// Fine-grained permission scopes
export type Permission =
  | 'projects:read'
  | 'projects:write'
  | 'admin:users:read'
  | 'admin:users:write'
  | 'management:config:read'
  | 'management:config:write';

export const RoleToPermissions: Record<Role, Permission[]> = {
  [Role.ADMIN]: [
    'projects:read',
    'projects:write',
    'admin:users:read',
    'admin:users:write',
    'management:config:read',
    'management:config:write',
  ],
  [Role.USER]: ['projects:read', 'projects:write'],
  [Role.GUEST]: [],
};

export const isPermission = (value: unknown): value is Permission => {
  return (
    typeof value === 'string' &&
    (value === 'projects:read' ||
      value === 'projects:write' ||
      value === 'admin:users:read' ||
      value === 'admin:users:write' ||
      value === 'management:config:read' ||
      value === 'management:config:write')
  );
};

export const hasPermission = (role: Role, perm: Permission): boolean => {
  const perms = RoleToPermissions[role] || [];
  return perms.includes(perm);
};

export const getPermissionsForRole = (role: Role): Set<Permission> => {
  return new Set(RoleToPermissions[role] || []);
};
