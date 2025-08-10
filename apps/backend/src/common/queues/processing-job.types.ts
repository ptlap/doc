import type { DocumentStatus } from '@prisma/client';

export type ProcessingQuality = 'low' | 'medium' | 'high';

export interface ProcessingOptions {
  language?: string;
  ocrEnabled?: boolean;
  extractImages?: boolean;
  preserveFormatting?: boolean;
  quality?: ProcessingQuality;
}

export interface DocumentProcessingJob {
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
  options: ProcessingOptions & {
    priority?: 'low' | 'normal' | 'high';
  };
  webhook?: string;
  metadata?: Record<string, unknown>;
  source: 'api';
  createdAt: string; // ISO
  reprocess?: boolean;
  version: number; // payload versioning
  attempt?: number; // current attempt count (for retries)
  maxAttempts?: number; // max retry attempts
}

export interface ProcessingProgress {
  documentId: string;
  status: DocumentStatus;
  progress: number; // 0..100
  currentStep: string;
  totalSteps: number;
  startedAt: string; // ISO
  estimatedCompletion?: string; // ISO
  error?: string;
  jobId?: string;
}
