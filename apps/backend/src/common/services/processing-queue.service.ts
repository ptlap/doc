import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis as RedisClient } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { queueNames } from '../constants/app.constants';
import type {
  DocumentProcessingJob,
  ProcessingProgress,
} from '../queues/processing-job.types';

interface EnqueueResult {
  jobId: string;
  enqueued: boolean;
}

@Injectable()
export class ProcessingQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(ProcessingQueueService.name);
  private publisher?: RedisClient;
  private readonly redisUrl?: string;
  private readonly defaultConcurrency: number;

  constructor(private readonly configService: ConfigService) {
    const urlUnknown: unknown = this.configService.get('REDIS_URL');
    this.redisUrl =
      typeof urlUnknown === 'string' && urlUnknown.length > 0
        ? urlUnknown
        : undefined;
    const concUnknown: unknown = this.configService.get(
      'processing.queueConcurrency',
    );
    const conc = typeof concUnknown === 'number' ? concUnknown : 5;
    this.defaultConcurrency = conc;
  }

  private isRedis(client: unknown): client is RedisClient {
    return !!client && typeof (client as RedisClient).publish === 'function';
  }

  private ensurePublisher(): void {
    if (!this.redisUrl) return;
    if (this.isRedis(this.publisher)) return;
    try {
      this.publisher = new IORedis(this.redisUrl, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
        enableAutoPipelining: true,
      });
      this.publisher.on('ready', () =>
        this.logger.log('ProcessingQueueService connected to Redis'),
      );
      this.publisher.on('error', (err: unknown) =>
        this.logger.error(
          `Redis error in processing queue: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize Redis publisher for processing queue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async enqueueDocumentProcessing(
    partial: Omit<DocumentProcessingJob, 'jobId' | 'createdAt' | 'version'>,
  ): Promise<EnqueueResult> {
    const jobId = randomUUID();
    // Type-safe guards to avoid any-based access
    const hasAttempt = (value: unknown): value is { attempt?: unknown } =>
      !!value && Object.prototype.hasOwnProperty.call(value, 'attempt');
    const hasMaxAttempts = (
      value: unknown,
    ): value is { maxAttempts?: unknown } =>
      !!value && Object.prototype.hasOwnProperty.call(value, 'maxAttempts');

    const attemptValue =
      hasAttempt(partial) && typeof partial.attempt === 'number'
        ? partial.attempt
        : 0;
    const maxAttemptsValue =
      hasMaxAttempts(partial) && typeof partial.maxAttempts === 'number'
        ? partial.maxAttempts
        : 3;

    const job: DocumentProcessingJob = {
      ...partial,
      jobId,
      createdAt: new Date().toISOString(),
      version: 1,
      attempt: attemptValue,
      maxAttempts: maxAttemptsValue,
    };

    // If Redis is not available, we still return enqueued=false so caller can fallback
    this.ensurePublisher();
    if (!this.isRedis(this.publisher)) {
      this.logger.warn(
        'REDIS_URL not set or Redis unavailable; queue enqueue skipped',
      );
      return { jobId, enqueued: false };
    }

    // Use a simple LPUSH into a Redis list as queue (worker will BRPOP)
    const queueKey = this.buildQueueKey(queueNames.DOCUMENT_PROCESSING);
    try {
      await this.publisher.lpush(queueKey, JSON.stringify(job));
      // Set an upper bound to list length optionally to avoid unbounded growth (no trim here by default)
      return { jobId, enqueued: true };
    } catch (err) {
      this.logger.error(
        `Failed to enqueue job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { jobId, enqueued: false };
    }
  }

  async reportProgress(progress: ProcessingProgress): Promise<void> {
    // Publish progress on a pubsub channel for real-time updates (optional)
    this.ensurePublisher();
    if (!this.isRedis(this.publisher)) return;
    try {
      const channel = this.buildProgressChannel(progress.documentId);
      await this.publisher.publish(channel, JSON.stringify(progress));
    } catch (err) {
      this.logger.debug(
        `Progress publish failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async storeResult(documentId: string, result: unknown): Promise<void> {
    this.ensurePublisher();
    if (!this.isRedis(this.publisher)) return;
    try {
      const key = `result:document:${documentId}`;
      // TTL 24h
      await this.publisher.set(key, JSON.stringify(result), 'EX', 86400);
    } catch (err) {
      this.logger.debug(
        `Result store failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private buildQueueKey(name: string): string {
    return `queue:${name}`;
  }

  private buildProgressChannel(documentId: string): string {
    return `progress:document:${documentId}`;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.isRedis(this.publisher)) {
      try {
        await this.publisher.quit();
      } catch {
        // ignore
      }
    }
  }
}
