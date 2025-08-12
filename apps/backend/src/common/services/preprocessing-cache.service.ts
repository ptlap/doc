import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import IORedis, { Redis as RedisClient } from 'ioredis';
import { StorageService } from './storage.service';

/**
 * Preprocessing cache payload stored in Redis index
 */
interface CacheIndexRecord {
  s3Key: string;
  bytes: number;
  storedInRedis: boolean;
  createdAt: number; // epoch ms
  paramsHash: string;
  page: number;
  dpi: number;
}

interface PreprocessingCacheMetrics {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
}

@Injectable()
export class PreprocessingCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(PreprocessingCacheService.name);

  private redis?: RedisClient;
  private readonly redisUrl?: string;
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly maxRedisBytes: number;
  private readonly maxItems: number;
  private readonly evictBatch: number;
  private lastAlertAtMs?: number;

  // In-memory fallback metrics
  private readonly memoryMetrics: PreprocessingCacheMetrics = {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {
    const urlUnknown: unknown = this.configService.get('REDIS_URL');
    this.redisUrl =
      typeof urlUnknown === 'string' && urlUnknown.length > 0
        ? urlUnknown
        : undefined;

    const ttlUnknown: unknown = this.configService.get(
      'PREPROC_CACHE_TTL_SECONDS',
    );
    const ttlCandidate = Number(ttlUnknown ?? 7 * 24 * 60 * 60); // default 7 days
    this.ttlSeconds =
      Number.isFinite(ttlCandidate) && ttlCandidate > 0
        ? ttlCandidate
        : 7 * 24 * 60 * 60;

    const prefixUnknown: unknown = this.configService.get(
      'PREPROC_CACHE_PREFIX',
    );
    this.keyPrefix =
      typeof prefixUnknown === 'string' && prefixUnknown.length > 0
        ? prefixUnknown
        : 'preproc';

    const maxUnknown: unknown = this.configService.get(
      'PREPROC_CACHE_MAX_REDIS_BYTES',
    );
    const maxCandidate = Number(maxUnknown ?? 128 * 1024); // default 128KB threshold
    this.maxRedisBytes =
      Number.isFinite(maxCandidate) && maxCandidate > 1024
        ? maxCandidate
        : 128 * 1024;

    const maxItemsUnknown: unknown = this.configService.get(
      'PREPROC_CACHE_MAX_ITEMS',
    );
    const maxItemsCandidate = Number(maxItemsUnknown ?? 5000);
    this.maxItems =
      Number.isFinite(maxItemsCandidate) && maxItemsCandidate > 100
        ? maxItemsCandidate
        : 5000;

    const evictBatchUnknown: unknown = this.configService.get(
      'PREPROC_CACHE_EVICT_BATCH',
    );
    const evictBatchCandidate = Number(evictBatchUnknown ?? 100);
    this.evictBatch =
      Number.isFinite(evictBatchCandidate) && evictBatchCandidate > 0
        ? evictBatchCandidate
        : 100;
  }

  // ---------- Public API ----------

  public buildParamsHash(params: unknown): string {
    const json = this.safeStableStringify(params);
    const hash = crypto.createHash('sha256');
    hash.update(json, 'utf8');
    return hash.digest('hex');
  }

  public buildCacheKey(
    documentId: string,
    pageNumber: number,
    dpi: number,
    paramsHash: string,
  ): string {
    if (!this.isNonEmptyString(documentId)) {
      throw new Error('documentId must be a non-empty string');
    }
    if (!this.isPositiveInteger(pageNumber)) {
      throw new Error('pageNumber must be a positive integer');
    }
    if (!this.isPositiveInteger(dpi)) {
      throw new Error('dpi must be a positive integer');
    }
    if (!this.isNonEmptyString(paramsHash)) {
      throw new Error('paramsHash must be a non-empty string');
    }
    return `${this.keyPrefix}:idx:${documentId}:${pageNumber}:${dpi}:${paramsHash}`;
  }

  /**
   * Helper: Build params hash from a generic preprocessing params object
   * This should be used by callers to ensure consistent hashing.
   */
  public buildParamsHashFromObject(params: {
    quality?: 'low' | 'medium' | 'high';
    language?: string;
    rotateHint?: number;
    deskew?: boolean;
    denoise?: boolean;
  }): string {
    const normalized = {
      quality: params.quality ?? 'medium',
      language: params.language ?? 'eng',
      rotateHint:
        typeof params.rotateHint === 'number' &&
        Number.isFinite(params.rotateHint)
          ? Math.round(((params.rotateHint % 360) + 360) % 360)
          : 0,
      deskew: Boolean(params.deskew ?? true),
      denoise: Boolean(params.denoise ?? true),
    } as const;
    return this.buildParamsHash(normalized);
  }

  /**
   * Try to fetch preprocessed binary from cache.
   * Strategy:
   * 1) If small payload is in Redis, return directly
   * 2) Otherwise, consult index to retrieve S3 key and download from storage
   */
  public async get(
    documentId: string,
    pageNumber: number,
    dpi: number,
    paramsHash: string,
  ): Promise<Buffer | null> {
    this.ensureRedis();
    const dataKey = this.dataKey(documentId, pageNumber, dpi, paramsHash);
    const idxKey = this.buildCacheKey(documentId, pageNumber, dpi, paramsHash);

    // 1) Try Redis data
    if (this.isRedis(this.redis)) {
      try {
        const binary = await this.redis.getBuffer(dataKey);
        if (binary && Buffer.isBuffer(binary) && binary.length > 0) {
          await this.bumpTtl([dataKey, idxKey]);
          await this.touchLru(idxKey);
          await this.enforceLruLimit();
          await this.incrementMetric('hits');
          return binary;
        }
      } catch (err) {
        this.logger.debug(
          `Redis getBuffer failed, will try index/s3: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2) Read index, then go to S3 if present
    const index = await this.getIndex(idxKey);
    if (index && this.isNonEmptyString(index.s3Key)) {
      try {
        const buffer = await this.storageService.getFile(index.s3Key);
        await this.incrementMetric('hits');
        await this.touchLru(idxKey);
        await this.enforceLruLimit();
        // Optionally rehydrate Redis small copy
        if (buffer.length <= this.maxRedisBytes && this.isRedis(this.redis)) {
          await this.saveRedisPayload(dataKey, buffer);
          await this.bumpTtl([dataKey, idxKey]);
        }
        return buffer;
      } catch (err) {
        this.logger.error(
          `S3 get failed for key=${index.s3Key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.incrementMetric('misses');
    await this.maybeAlertOnMissSpike();
    return null;
  }

  /**
   * Store payload in cache with S3 backup and Redis index.
   * Also registers keys for document-level invalidation.
   */
  public async set(
    documentId: string,
    pageNumber: number,
    dpi: number,
    paramsHash: string,
    payload: Buffer,
    contentType: string = 'application/octet-stream',
  ): Promise<void> {
    if (!Buffer.isBuffer(payload) || payload.length === 0) return;

    const idxKey = this.buildCacheKey(documentId, pageNumber, dpi, paramsHash);
    const dataKey = this.dataKey(documentId, pageNumber, dpi, paramsHash);
    const docKeysSet = this.docKeysSet(documentId);
    const docS3Set = this.docS3Set(documentId);

    // 1) Upload to S3
    const s3Key = this.s3ObjectKey(documentId, pageNumber, dpi, paramsHash);
    await this.storageService.uploadFile(
      {
        buffer: payload,
        originalname: s3Key,
        mimetype: contentType,
        size: payload.length,
      },
      s3Key,
    );

    // 2) Save small copy to Redis
    if (payload.length <= this.maxRedisBytes) {
      await this.saveRedisPayload(dataKey, payload);
    }

    // 3) Save index to Redis
    const index: CacheIndexRecord = {
      s3Key,
      bytes: payload.length,
      storedInRedis: payload.length <= this.maxRedisBytes,
      createdAt: Date.now(),
      paramsHash,
      page: pageNumber,
      dpi,
    };
    await this.saveIndex(idxKey, index);
    await this.touchLru(idxKey);
    await this.enforceLruLimit();

    // 4) Register keys for invalidation
    if (this.isRedis(this.redis)) {
      try {
        await this.redis.sadd(docKeysSet, dataKey, idxKey);
        await this.redis.sadd(docS3Set, s3Key);
        await this.redis.expire(docKeysSet, this.ttlSeconds);
        await this.redis.expire(docS3Set, this.ttlSeconds);
      } catch (err) {
        this.logger.debug(
          `Failed to register doc invalidation keys: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.incrementMetric('sets');
  }

  /** Invalidate all cache entries for a specific document */
  public async invalidateDocument(documentId: string): Promise<void> {
    this.ensureRedis();
    if (!this.isRedis(this.redis)) return;

    const keysSet = this.docKeysSet(documentId);
    const s3Set = this.docS3Set(documentId);
    try {
      const [redisKeys, s3Keys] = await Promise.all([
        this.redis.smembers(keysSet),
        this.redis.smembers(s3Set),
      ]);

      if (Array.isArray(redisKeys) && redisKeys.length > 0) {
        await this.redis.del(...redisKeys);
        await this.redis.del(keysSet);
      }
      if (Array.isArray(s3Keys) && s3Keys.length > 0) {
        for (const key of s3Keys) {
          try {
            await this.storageService.deleteFile(key);
          } catch (err) {
            this.logger.debug(
              `Delete S3 failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        await this.redis.del(s3Set);
      }
    } catch (err) {
      this.logger.error(
        `invalidateDocument failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Invalidate everything under prefix (use with caution) */
  public async invalidateAll(): Promise<void> {
    this.ensureRedis();
    if (!this.isRedis(this.redis)) return;
    try {
      // Use SCAN to avoid blocking Redis
      let cursor = '0';
      const pattern = `${this.keyPrefix}:*`;
      do {
        const result = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = result[0];
        const keys = result[1];
        if (Array.isArray(keys) && keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.error(
        `invalidateAll failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Return current metrics counters */
  public async getMetrics(): Promise<PreprocessingCacheMetrics> {
    this.ensureRedis();
    if (!this.isRedis(this.redis)) return { ...this.memoryMetrics };
    try {
      const raw = await this.redis.hmget(
        this.metricsKey(),
        'hits',
        'misses',
        'sets',
        'evictions',
      );
      const [hits, misses, sets, evictions] = raw.map((x) => Number(x || 0));
      return {
        hits: Number.isFinite(hits) ? hits : 0,
        misses: Number.isFinite(misses) ? misses : 0,
        sets: Number.isFinite(sets) ? sets : 0,
        evictions: Number.isFinite(evictions) ? evictions : 0,
      };
    } catch {
      return { ...this.memoryMetrics };
    }
  }

  // ---------- Internals ----------

  private ensureRedis(): void {
    if (!this.redisUrl || this.isRedis(this.redis)) return;
    try {
      this.redis = new IORedis(this.redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: false,
        enableAutoPipelining: true,
      });
      this.redis.on('error', (err: unknown) => {
        this.logger.error(
          `Redis error in preprocessing cache: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      this.redis.on('ready', () => {
        this.logger.log('Preprocessing cache is using Redis backend');
      });
    } catch (err) {
      this.logger.error(
        `Failed to initialize Redis for preprocessing cache: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private isRedis(client: unknown): client is RedisClient {
    return (
      !!client &&
      typeof client === 'object' &&
      typeof (client as { getBuffer?: unknown }).getBuffer === 'function' &&
      typeof (client as { set?: unknown }).set === 'function' &&
      typeof (client as { expire?: unknown }).expire === 'function' &&
      typeof (client as { quit?: unknown }).quit === 'function'
    );
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  }

  private dataKey(
    documentId: string,
    pageNumber: number,
    dpi: number,
    paramsHash: string,
  ): string {
    return `${this.keyPrefix}:data:${documentId}:${pageNumber}:${dpi}:${paramsHash}`;
  }

  private docKeysSet(documentId: string): string {
    return `${this.keyPrefix}:dockeys:${documentId}`;
  }

  private docS3Set(documentId: string): string {
    return `${this.keyPrefix}:s3keys:${documentId}`;
  }

  private metricsKey(): string {
    return `${this.keyPrefix}:metrics`;
  }

  private s3ObjectKey(
    documentId: string,
    pageNumber: number,
    dpi: number,
    paramsHash: string,
  ): string {
    return `${this.keyPrefix}/${documentId}/${pageNumber}/${dpi}/${paramsHash}.bin`;
  }

  private async bumpTtl(keys: string[]): Promise<void> {
    if (!this.isRedis(this.redis)) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const k of keys) pipeline.expire(k, this.ttlSeconds);
      await pipeline.exec();
    } catch {
      // ignore ttl bump errors
    }
  }

  private async saveRedisPayload(key: string, payload: Buffer): Promise<void> {
    if (!this.isRedis(this.redis)) return;
    try {
      await this.redis.set(key, payload, 'EX', this.ttlSeconds);
    } catch (err) {
      this.logger.debug(
        `Failed to set Redis payload (size=${payload.length}): ${err instanceof Error ? err.message : String(err)}`,
      );
      // Count as eviction-like since we couldn't store it
      await this.incrementMetric('evictions');
    }
  }

  private async getIndex(idxKey: string): Promise<CacheIndexRecord | null> {
    this.ensureRedis();
    if (!this.isRedis(this.redis)) return null;
    try {
      const raw = await this.redis.get(idxKey);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!this.isIndexRecord(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async saveIndex(
    idxKey: string,
    record: CacheIndexRecord,
  ): Promise<void> {
    this.ensureRedis();
    if (!this.isRedis(this.redis)) return;
    try {
      await this.redis.set(
        idxKey,
        JSON.stringify(record),
        'EX',
        this.ttlSeconds,
      );
    } catch (err) {
      this.logger.debug(
        `Failed to save index record: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private isIndexRecord(value: unknown): value is CacheIndexRecord {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    const ok =
      typeof v.s3Key === 'string' &&
      typeof v.bytes === 'number' &&
      typeof v.storedInRedis === 'boolean' &&
      typeof v.createdAt === 'number' &&
      typeof v.paramsHash === 'string' &&
      typeof v.page === 'number' &&
      typeof v.dpi === 'number';
    return ok;
  }

  private async incrementMetric(
    name: keyof PreprocessingCacheMetrics,
  ): Promise<void> {
    // Cập nhật metrics in-memory theo cách type-safe
    switch (name) {
      case 'hits':
        this.memoryMetrics.hits += 1;
        break;
      case 'misses':
        this.memoryMetrics.misses += 1;
        break;
      case 'sets':
        this.memoryMetrics.sets += 1;
        break;
      case 'evictions':
        this.memoryMetrics.evictions += 1;
        break;
      default:
        break;
    }
    this.ensureRedis();
    if (!this.isRedis(this.redis)) return;
    try {
      await this.redis.hincrby(this.metricsKey(), name, 1);
      // Optional: set TTL on metrics key so it doesn't grow forever
      await this.redis.expire(this.metricsKey(), 30 * 24 * 60 * 60); // 30 days
    } catch {
      // ignore metrics errors
    }
  }

  private async maybeAlertOnMissSpike(): Promise<void> {
    // Simple heuristic: if miss ratio > 60% and at least 10 minutes since last alert
    const now = Date.now();
    if (this.lastAlertAtMs && now - this.lastAlertAtMs < 10 * 60 * 1000) return;
    this.ensureRedis();
    if (!this.isRedis(this.redis)) return;
    try {
      const metrics = await this.getMetrics();
      const total = metrics.hits + metrics.misses;
      if (total < 100) return; // not enough data
      const missRatio = metrics.misses / total;
      if (missRatio > 0.6) {
        this.lastAlertAtMs = now;
        this.logger.warn(
          `Preprocessing cache miss ratio high: ${(missRatio * 100).toFixed(1)}% (hits=${metrics.hits}, misses=${metrics.misses})`,
        );
      }
    } catch {
      // ignore alert errors
    }
  }

  private lruKey(): string {
    return `${this.keyPrefix}:lru`;
  }

  private parseIdxKey(idxKey: string): {
    documentId: string;
    pageNumber: number;
    dpi: number;
    paramsHash: string;
  } | null {
    const prefix = `${this.keyPrefix}:idx:`;
    if (!idxKey.startsWith(prefix)) return null;
    const rest = idxKey.slice(prefix.length);
    const parts = rest.split(':');
    if (parts.length !== 4) return null;
    const [documentId, pageStr, dpiStr, paramsHash] = parts;
    const pageNumber = Number(pageStr);
    const dpi = Number(dpiStr);
    if (
      !this.isNonEmptyString(documentId) ||
      !this.isPositiveInteger(pageNumber) ||
      !this.isPositiveInteger(dpi) ||
      !this.isNonEmptyString(paramsHash)
    )
      return null;
    return { documentId, pageNumber, dpi, paramsHash };
  }

  private dataKeyFromIdx(idxKey: string): string | null {
    const parsed = this.parseIdxKey(idxKey);
    if (!parsed) return null;
    return this.dataKey(
      parsed.documentId,
      parsed.pageNumber,
      parsed.dpi,
      parsed.paramsHash,
    );
  }

  private async touchLru(idxKey: string): Promise<void> {
    this.ensureRedis();
    if (!this.isRedis(this.redis)) return;
    try {
      const nowScore = Date.now();
      await this.redis.zadd(this.lruKey(), nowScore, idxKey);
    } catch {
      // ignore
    }
  }

  private async enforceLruLimit(): Promise<void> {
    this.ensureRedis();
    if (!this.isRedis(this.redis)) return;
    try {
      const size = await this.redis.zcard(this.lruKey());
      if (typeof size !== 'number' || size <= this.maxItems) return;
      const over = size - this.maxItems;
      const batch = Math.min(this.evictBatch, over);
      const victims = await this.redis.zrange(this.lruKey(), 0, batch - 1);
      if (!Array.isArray(victims) || victims.length === 0) return;
      const pipeline = this.redis.pipeline();
      for (const idxKey of victims) {
        const dataKey = this.dataKeyFromIdx(idxKey);
        if (dataKey) pipeline.del(idxKey, dataKey);
        pipeline.zrem(this.lruKey(), idxKey);
        const parsed = this.parseIdxKey(idxKey);
        if (parsed) {
          pipeline.srem(this.docKeysSet(parsed.documentId), idxKey);
          if (dataKey)
            pipeline.srem(this.docKeysSet(parsed.documentId), dataKey);
        }
      }
      await pipeline.exec();
      await this.incrementMetric('evictions');
    } catch (err) {
      this.logger.debug(
        `LRU enforcement skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private safeStableStringify(value: unknown): string {
    try {
      return this.stableStringify(value);
    } catch {
      return '___unstringifiable___';
    }
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      const arr = value.map((item) => this.stableStringify(item));
      return `[${arr.join(',')}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(`${JSON.stringify(k)}:${this.stableStringify(obj[k])}`);
    }
    return `{${parts.join(',')}}`;
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
