import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis as RedisClient } from 'ioredis';
import { Role } from '../enums/role.enum';
import { type Permission, RoleToPermissions } from '../permissions/permissions';
import * as crypto from 'crypto';

type PermissionsCacheRecord = {
  fetchedAt: number;
  permissions: ReadonlySet<Permission>;
};

@Injectable()
export class PermissionsService implements OnModuleDestroy {
  private readonly logger = new Logger(PermissionsService.name);

  // In-memory cache
  private readonly roleCache = new Map<Role, PermissionsCacheRecord>();

  // TTL for cache in ms (default: 5 minutes)
  private readonly ttlMs: number;

  private redis?: RedisClient;
  private redisSubscriber?: RedisClient;
  private readonly redisUrl?: string;
  private subscriberInitialized = false;

  constructor(private readonly configService: ConfigService) {
    this.ttlMs = Number(
      this.configService.get<string>(
        'PERMISSIONS_CACHE_TTL_MS',
        String(5 * 60 * 1000),
      ),
    );
    const url: unknown = this.configService.get('REDIS_URL');
    this.redisUrl =
      typeof url === 'string' && url.length > 0 ? (url as string) : undefined;
  }

  private ensureRedisInitialized(): void {
    if (!this.redisUrl) return;
    if (!this.isRedis(this.redis)) {
      try {
        this.redis = new IORedis(this.redisUrl, {
          lazyConnect: false,
          maxRetriesPerRequest: 1,
        });
        this.redis.on('error', (err: unknown) => {
          this.logger.error(
            `Redis error in permissions cache: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        this.redis.on('ready', () => {
          this.logger.log('PermissionsService using Redis cache');
        });
      } catch {
        this.logger.error('Failed to initialize Redis for permissions cache');
      }
    }
    if (!this.subscriberInitialized) {
      try {
        this.redisSubscriber = new IORedis(this.redisUrl, {
          lazyConnect: false,
          maxRetriesPerRequest: 1,
        });
        this.redisSubscriber.on('error', (err: unknown) => {
          this.logger.error(
            `Redis subscriber error in permissions cache: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        this.redisSubscriber.on('ready', () => {
          this.logger.log('PermissionsService subscriber ready');
        });
        void this.redisSubscriber.subscribe('perms:invalidate');
        this.redisSubscriber.on(
          'message',
          (channel: string, message: string) => {
            if (channel !== 'perms:invalidate') return;
            if (message === '*') {
              this.invalidateAll(false);
              return;
            }
            if (this.isValidRole(message)) {
              this.invalidateRole(message, false);
            } else {
              this.logger.debug(
                `Ignore invalid perms:invalidate payload: ${message}`,
              );
            }
          },
        );
        this.subscriberInitialized = true;
      } catch {
        this.logger.error(
          'Failed to initialize Redis subscriber for permissions cache',
        );
      }
    }
  }

  private isRedis(client: unknown): client is RedisClient {
    return (
      !!client &&
      typeof client === 'object' &&
      typeof (client as { get?: unknown }).get === 'function'
    );
  }

  private buildKey(role: Role): string {
    return `perms:role:${role}`;
  }

  public getPermissionsForRole(role: Role): ReadonlySet<Permission> {
    if (!this.isValidRole(role)) {
      return new Set();
    }

    const now = Date.now();
    const cached = this.roleCache.get(role);
    if (cached && now - cached.fetchedAt < this.ttlMs) {
      return cached.permissions;
    }

    // Try Redis first
    this.ensureRedisInitialized();
    if (this.isRedis(this.redis)) {
      // fire-and-forget synchronous style not possible; do sync fallback while scheduling async refresh
      void this.fetchFromRedis(role).then((perms) => {
        if (perms) {
          this.roleCache.set(role, {
            fetchedAt: Date.now(),
            permissions: perms,
          });
        }
      });
    }

    // In a real app this might be loaded from DB or config service. For now use const map.
    const perms = new Set<Permission>(RoleToPermissions[role] || []);
    this.roleCache.set(role, { fetchedAt: now, permissions: perms });
    // Save to Redis so other instances can reuse the shared cache
    this.ensureRedisInitialized();
    if (this.isRedis(this.redis)) {
      void this.saveToRedis(role, perms);
    }
    return perms;
  }

  private async fetchFromRedis(
    role: Role,
  ): Promise<ReadonlySet<Permission> | null> {
    if (!this.isRedis(this.redis)) return null;
    try {
      const raw = await this.redis.get(this.buildKey(role));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const perms = new Set<Permission>();
      for (const item of parsed) {
        if (typeof item === 'string') {
          perms.add(item as Permission);
        }
      }
      return perms;
    } catch {
      return null;
    }
  }

  public getPermissionsHashForRole(role: Role): string {
    if (!this.isValidRole(role)) return '';
    const values = [...(RoleToPermissions[role] || [])].sort();
    const hash = crypto.createHash('sha256');
    hash.update(values.join('|'), 'utf8');
    return hash.digest('hex');
  }

  public invalidateRole(role: Role, broadcast: boolean = true): void {
    if (this.roleCache.delete(role)) {
      this.logger.debug(`Invalidated permissions cache for role: ${role}`);
    }
    this.ensureRedisInitialized();
    if (this.isRedis(this.redis)) {
      void this.redis.del(this.buildKey(role));
      // Publish invalidation event (unless handling a remote invalidation)
      if (broadcast) {
        void this.redis.publish('perms:invalidate', role);
      }
    }
  }

  public invalidateAll(broadcast: boolean = true): void {
    this.roleCache.clear();
    this.logger.debug('Invalidated all permissions cache');
    this.ensureRedisInitialized();
    if (this.isRedis(this.redis)) {
      // broadcast special token
      if (broadcast) {
        void this.redis.publish('perms:invalidate', '*');
      }
    }
  }

  private isValidRole(value: unknown): value is Role {
    return (
      typeof value === 'string' &&
      (Object.values(Role) as string[]).includes(value)
    );
  }

  private async saveToRedis(
    role: Role,
    perms: ReadonlySet<Permission>,
  ): Promise<void> {
    this.ensureRedisInitialized();
    if (!this.isRedis(this.redis)) return;
    try {
      const ttlSec = Math.max(1, Math.ceil(this.ttlMs / 1000));
      await this.redis.set(
        this.buildKey(role),
        JSON.stringify([...perms]),
        'EX',
        ttlSec,
      );
    } catch (err) {
      this.logger.debug(
        `Skipping Redis set for permissions cache (role=${role}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Close subscriber first to stop incoming messages
    try {
      if (
        this.redisSubscriber &&
        typeof this.redisSubscriber.quit === 'function'
      ) {
        await this.redisSubscriber.quit();
      }
    } catch {
      // ignore
    }
    // Then close main redis client
    try {
      if (this.isRedis(this.redis)) {
        await this.redis.quit();
      }
    } catch {
      // ignore
    }
  }
}
