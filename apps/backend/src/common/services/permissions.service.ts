import { Injectable, Logger } from '@nestjs/common';
import { Role } from '../enums/role.enum';
import { type Permission, RoleToPermissions } from '../permissions/permissions';
import * as crypto from 'crypto';

type PermissionsCacheRecord = {
  fetchedAt: number;
  permissions: ReadonlySet<Permission>;
};

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  // In-memory cache
  private readonly roleCache = new Map<Role, PermissionsCacheRecord>();

  // TTL for cache in ms (default: 5 minutes)
  private readonly ttlMs: number = Number(
    process.env.PERMISSIONS_CACHE_TTL_MS || 5 * 60 * 1000,
  );

  public getPermissionsForRole(role: Role): ReadonlySet<Permission> {
    if (!this.isValidRole(role)) {
      return new Set();
    }

    const now = Date.now();
    const cached = this.roleCache.get(role);
    if (cached && now - cached.fetchedAt < this.ttlMs) {
      return cached.permissions;
    }

    // In a real app this might be loaded from DB or config service. For now use const map.
    const perms = new Set<Permission>(RoleToPermissions[role] || []);
    this.roleCache.set(role, { fetchedAt: now, permissions: perms });
    return perms;
  }

  public getPermissionsHashForRole(role: Role): string {
    if (!this.isValidRole(role)) return '';
    const values = [...(RoleToPermissions[role] || [])].sort();
    const hash = crypto.createHash('sha256');
    hash.update(values.join('|'), 'utf8');
    return hash.digest('hex');
  }

  public invalidateRole(role: Role): void {
    if (this.roleCache.delete(role)) {
      this.logger.debug(`Invalidated permissions cache for role: ${role}`);
    }
  }

  public invalidateAll(): void {
    this.roleCache.clear();
    this.logger.debug('Invalidated all permissions cache');
  }

  private isValidRole(value: unknown): value is Role {
    return (
      typeof value === 'string' &&
      (Object.values(Role) as string[]).includes(value)
    );
  }
}
