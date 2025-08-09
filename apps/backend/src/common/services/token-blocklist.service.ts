import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis as RedisClient } from 'ioredis';

type BlockRecord = { expiresAtMs: number };

@Injectable()
export class TokenBlocklistService implements OnModuleDestroy {
  private readonly logger = new Logger(TokenBlocklistService.name);
  private readonly memoryBlocked = new Map<string, BlockRecord>();
  private redis?: RedisClient;
  private readonly redisUrl?: string;

  constructor(private readonly configService: ConfigService) {
    const urlUnknown: unknown = this.configService.get('REDIS_URL');
    this.redisUrl =
      typeof urlUnknown === 'string' && urlUnknown.length > 0
        ? (urlUnknown as string)
        : undefined;
    if (!this.redisUrl) {
      this.logger.warn(
        'REDIS_URL not set; Token blocklist will use in-memory store',
      );
    }
  }

  private ensureRedisInitialized(): void {
    if (!this.redisUrl) return;
    if (this.isRedis(this.redis)) return;
    try {
      this.redis = new IORedis(this.redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: false,
        enableAutoPipelining: true,
      });
      this.redis.on('error', (err: unknown) => {
        this.logger.error(
          `Redis error in blocklist: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      this.redis.on('ready', () => {
        this.logger.log('Token blocklist is using Redis backend');
      });
    } catch {
      this.logger.error(
        'Failed to initialize Redis for token blocklist, falling back to in-memory',
      );
    }
  }

  private isRedis(client: unknown): client is RedisClient {
    return (
      !!client &&
      typeof client === 'object' &&
      typeof (client as { set?: unknown }).set === 'function' &&
      typeof (client as { exists?: unknown }).exists === 'function' &&
      typeof (client as { quit?: unknown }).quit === 'function'
    );
  }

  public async block(jti: string, ttlSeconds: number): Promise<void> {
    if (typeof jti !== 'string' || jti.length === 0) return;
    const ttl = Math.max(1, Math.floor(Number(ttlSeconds)));
    this.ensureRedisInitialized();
    if (this.isRedis(this.redis)) {
      try {
        await this.redis.set(this.buildKey(jti), '1', 'EX', ttl);
        this.logger.debug(`Blocked jti=${jti} for ${ttl}s (redis)`);
        return;
      } catch (err) {
        this.logger.error(
          `Redis block failed, using memory fallback: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const expiresAtMs = Date.now() + ttl * 1000;
    this.memoryBlocked.set(jti, { expiresAtMs });
    this.logger.debug(`Blocked jti=${jti} for ${ttl}s (memory)`);
  }

  public async isBlocked(jti: unknown): Promise<boolean> {
    if (typeof jti !== 'string' || jti.length === 0) return false;
    this.ensureRedisInitialized();
    if (this.isRedis(this.redis)) {
      try {
        const exists = await this.redis.exists(this.buildKey(jti));
        return exists === 1;
      } catch (err) {
        this.logger.error(
          `Redis check failed, using memory fallback: ${err instanceof Error ? err.message : String(err)}`,
        );
        // fallthrough to memory
      }
    }
    const rec = this.memoryBlocked.get(jti);
    if (!rec) return false;
    if (Date.now() > rec.expiresAtMs) {
      this.memoryBlocked.delete(jti);
      return false;
    }
    return true;
  }

  public cleanupExpired(): void {
    if (this.isRedis(this.redis)) return; // Redis keys auto-expire
    const now = Date.now();
    for (const [k, v] of this.memoryBlocked.entries()) {
      if (now > v.expiresAtMs) this.memoryBlocked.delete(k);
    }
  }

  private buildKey(jti: string): string {
    return `jwt:block:${jti}`;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.isRedis(this.redis)) {
        await this.redis.quit();
      }
    } catch {
      // ignore
    }
  }
}
