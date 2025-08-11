import IORedis from 'ioredis';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

type ProcessingQuality = 'low' | 'medium' | 'high';

interface ProcessingOptions {
  language?: string;
  ocrEnabled?: boolean;
  extractImages?: boolean;
  preserveFormatting?: boolean;
  quality?: ProcessingQuality;
  priority?: 'low' | 'normal' | 'high';
}

interface DocumentProcessingJob {
  jobId: string;
  documentId: string;
  projectId: string;
  userId: string;
  tenantId?: string | null;
  file: {
    storedFilename: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
  };
  options: ProcessingOptions;
  webhook?: string;
  metadata?: Record<string, unknown>;
  source: 'api';
  createdAt: string; // ISO
  reprocess?: boolean;
  version: number;
  attempt?: number;
  maxAttempts?: number;
}

const QUEUE_KEY = process.env.QUEUE_KEY || 'queue:document-processing';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SHUTDOWN_TIMEOUT_MS = 30_000;

const redis = new IORedis(REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 2,
  enableAutoPipelining: true,
});

let isShuttingDown = false;

async function processJob(job: DocumentProcessingJob): Promise<void> {
  console.log(
    `[worker] Processing job ${job.jobId} for document ${job.documentId}`
  );
  // Tạm thời: chỉ đánh dấu đã nhận job. Pipeline chi tiết thuộc Phase 2/3
  await new Promise(r => setTimeout(r, 100));
  try {
    const result = { success: true, completedAt: new Date().toISOString() };
    await redis.set(
      `result:document:${job.documentId}`,
      JSON.stringify(result),
      'EX',
      86400
    );
  } catch (error) {
    console.warn('[worker] Failed to store result:', error);
  }
  console.log(`[worker] Done job ${job.jobId}`);
}

async function consumeLoop(): Promise<void> {
  console.log('[worker] Consumer loop started');
  while (!isShuttingDown) {
    try {
      // BRPOP with 5s timeout để có thể kiểm tra shutdown flag
      const res = await redis.brpop(QUEUE_KEY, 5);
      if (!res) continue;
      const [, payload] = res;
      let parsedJob: DocumentProcessingJob | null = null;
      try {
        const jobUnknown: unknown = JSON.parse(payload);
        if (!isDocumentProcessingJob(jobUnknown)) {
          console.warn('[worker] Invalid job payload schema, skipping');
          continue;
        }
        parsedJob = jobUnknown;
        await processJob(parsedJob);
      } catch (error) {
        console.error('[worker] Failed to handle job:', error);
        // retry with backoff if applicable
        const attempt = parsedJob?.attempt ?? 0;
        const maxAttempts = parsedJob?.maxAttempts ?? 3;
        if (attempt + 1 <= maxAttempts) {
          const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
          await new Promise(r => setTimeout(r, delayMs));
          if (!parsedJob) {
            continue;
          }
          const retryJob: DocumentProcessingJob = {
            ...parsedJob,
            attempt: attempt + 1,
          };
          await redis.lpush(QUEUE_KEY, JSON.stringify(retryJob));
          console.warn(
            `[worker] Re-queued job ${retryJob.jobId} (attempt ${attempt + 1}/${maxAttempts})`
          );
        } else {
          if (parsedJob) {
            console.error(
              `[worker] Job ${parsedJob.jobId} exceeded max attempts (${maxAttempts}), giving up`
            );
          } else {
            console.error('[worker] Job exceeded max attempts (unknown id)');
          }
        }
      }
    } catch (error) {
      console.error('[worker] Redis BRPOP failed:', error);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.log('[worker] Consumer loop exited');
}

function isDocumentProcessingJob(
  value: unknown
): value is DocumentProcessingJob {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.jobId === 'string' &&
    typeof v.documentId === 'string' &&
    typeof v.projectId === 'string' &&
    typeof v.userId === 'string' &&
    typeof v.file === 'object' &&
    v.file !== null &&
    typeof (v.file as Record<string, unknown>)['storedFilename'] === 'string' &&
    typeof (v.file as Record<string, unknown>)['originalFilename'] ===
      'string' &&
    typeof (v.file as Record<string, unknown>)['mimeType'] === 'string' &&
    typeof (v.file as Record<string, unknown>)['sizeBytes'] === 'number' &&
    typeof v.options === 'object' &&
    v.options !== null &&
    typeof v.createdAt === 'string' &&
    typeof v.version === 'number'
  );
}

function setupHealthServer(): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void req;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok' }));
  });
  const port = process.env.WORKER_PORT ? Number(process.env.WORKER_PORT) : 4001;
  server.listen(port, () =>
    console.log(`[worker] Health listening on :${port}`)
  );
}

async function gracefulShutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[worker] Shutting down...');
  const timer = setTimeout(() => {
    console.warn('[worker] Force exit after timeout');
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  try {
    await redis.quit();
  } catch (error) {
    console.warn(
      '[worker] Redis quit failed:',
      error instanceof Error ? error.message : String(error)
    );
  }
  clearTimeout(timer);
  console.log('[worker] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

async function main(): Promise<void> {
  setupHealthServer();
  await consumeLoop();
}

main().catch(err => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
