import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import {
  ProcessingResult,
  ProcessorOptions,
} from '../../common/processors/base-processor.interface';
import { ProcessorFactory } from '../../common/processors/processor-factory';
import type { DocumentProcessingJob } from '../../common/queues/processing-job.types';
import { CircuitBreakerService } from '../../common/services/circuit-breaker.service';
import { PrismaService } from '../../common/services/prisma.service';
import { ProcessingQueueService } from '../../common/services/processing-queue.service';
import { StorageService } from '../../common/services/storage.service';

export interface ProcessDocumentOptions extends ProcessorOptions {
  priority?: 'low' | 'normal' | 'high';
  webhook?: string;
  metadata?: Record<string, any>;
}

interface ProjectSettings {
  language?: string;
  ocrEnabled?: boolean;
  extractImages?: boolean;
  preserveFormatting?: boolean;
  quality?: string;
}

export interface ProcessingProgress {
  documentId: string;
  status: DocumentStatus;
  progress: number;
  currentStep: string;
  totalSteps: number;
  startedAt: Date;
  estimatedCompletion?: Date;
  error?: string;
}

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);
  private readonly inMemoryProgressMap = new Map<string, ProcessingProgress>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly processorFactory: ProcessorFactory,
    private readonly processingQueue: ProcessingQueueService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  async processDocument(
    documentId: string,
    options: ProcessDocumentOptions = {},
  ): Promise<void> {
    this.logger.log(`Dispatching processing job for: ${documentId}`);

    // Initialize progress tracking (controller can show immediate feedback)
    this.initializeProgress(documentId);

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        project: { select: { id: true, settings: true } },
        user: { select: { id: true } },
      },
    });

    if (!document) {
      throw new NotFoundException(`Document not found: ${documentId}`);
    }

    await this.updateDocumentStatus(documentId, DocumentStatus.processing, 10);

    const projectSettings =
      (document.project.settings as ProjectSettings) || {};
    const processingOptions: ProcessorOptions = {
      language: options.language || projectSettings.language || 'eng',
      ocrEnabled: options.ocrEnabled ?? projectSettings.ocrEnabled ?? true,
      extractImages:
        options.extractImages ?? projectSettings.extractImages ?? false,
      preserveFormatting:
        options.preserveFormatting ??
        projectSettings.preserveFormatting ??
        false,
      quality: (options.quality || projectSettings.quality || 'medium') as
        | 'low'
        | 'medium'
        | 'high',
    };

    const jobPayload: Omit<
      DocumentProcessingJob,
      'jobId' | 'createdAt' | 'version'
    > = {
      documentId,
      projectId: document.projectId,
      userId: document.userId,
      tenantId: document.tenantId,
      file: {
        storedFilename: document.storedFilename,
        originalFilename: document.originalFilename,
        mimeType: document.mimeType,
        sizeBytes: Number(document.fileSizeBytes ?? 0),
      },
      options: { ...processingOptions, priority: options.priority ?? 'normal' },
      webhook: options.webhook,
      metadata: options.metadata,
      source: 'api',
      reprocess: false,
    };

    // Circuit breaker wraps enqueue; fallback to in-process execution if queue is unavailable
    const { enqueued, jobId } = await this.circuitBreaker.exec(
      () => this.processingQueue.enqueueDocumentProcessing(jobPayload),
      () =>
        Promise.resolve({ enqueued: false, jobId: 'fallback-' + Date.now() }),
    );

    if (enqueued) {
      this.updateProgress(documentId, 'Queued for processing', 15);
      this.logger.log(
        `Enqueued processing job ${jobId} for document ${documentId}`,
      );
      return;
    }

    // Fallback path: process synchronously (temporary until worker service picks up)
    this.logger.warn(
      'Queue unavailable; falling back to in-process processing',
    );
    await this.processInline(documentId, processingOptions);
  }

  private async processInline(
    documentId: string,
    processingOptions: ProcessorOptions,
  ): Promise<void> {
    const startTime = Date.now();

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        projectId: true,
        storedFilename: true,
        originalFilename: true,
        mimeType: true,
      },
    });

    if (!document) {
      throw new NotFoundException(`Document not found: ${documentId}`);
    }

    try {
      this.updateProgress(documentId, 'Downloading file', 20);
      const fileBuffer = await this.storageService.getFile(
        document.storedFilename,
      );

      this.updateProgress(documentId, 'Processing document', 30);
      const result = await this.processorFactory.processDocument(
        fileBuffer,
        document.originalFilename,
        document.mimeType,
        processingOptions,
      );

      if (!result.success) {
        throw new Error(result.error || 'Processing failed');
      }

      this.updateProgress(documentId, 'Saving results', 70);
      await this.saveProcessingResults(documentId, result);
      await this.updateDocumentStatus(
        documentId,
        DocumentStatus.processed,
        100,
      );
      await this.updateProjectStats(document.projectId);

      this.logger.log(
        `Inline processing completed: ${documentId} in ${Date.now() - startTime}ms`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Inline processing failed: ${documentId} - ${errorMessage}`,
      );
      await this.updateDocumentStatus(
        documentId,
        DocumentStatus.failed,
        0,
        errorMessage,
      );
      this.updateProgress(documentId, 'Processing failed', 0, errorMessage);
      throw error;
    } finally {
      setTimeout(() => {
        this.inMemoryProgressMap.delete(documentId);
      }, 60000);
    }
  }

  async getProcessingProgress(
    documentId: string,
  ): Promise<ProcessingProgress | null> {
    // Check in-memory progress first
    const inMemoryProgress = this.inMemoryProgressMap.get(documentId);
    if (inMemoryProgress) {
      return inMemoryProgress;
    }

    // Fallback to database
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        status: true,
        processingProgress: true,
        processingError: true,
        createdAt: true,
        processedAt: true,
      },
    });

    if (!document) {
      return null;
    }

    return {
      documentId,
      status: document.status,
      progress: document.processingProgress,
      currentStep: this.getStepFromStatus(document.status),
      totalSteps: 5,
      startedAt: document.createdAt,
      estimatedCompletion: document.processedAt || undefined,
      error: document.processingError || undefined,
    };
  }

  async reprocessDocument(
    documentId: string,
    options: ProcessDocumentOptions = {},
  ): Promise<void> {
    // Delete existing pages and chunks
    await this.prisma.page.deleteMany({
      where: { documentId },
    });

    // Reset document status
    await this.updateDocumentStatus(documentId, DocumentStatus.uploading, 0);

    // Start processing
    await this.processDocument(documentId, options);
  }

  getSupportedMimeTypes(): string[] {
    return this.processorFactory.getSupportedMimeTypes();
  }

  getProcessorInfo(): Array<{ name: string; supportedTypes: string[] }> {
    return this.processorFactory.getProcessorInfo();
  }

  private initializeProgress(documentId: string): void {
    this.inMemoryProgressMap.set(documentId, {
      documentId,
      status: DocumentStatus.processing,
      progress: 0,
      currentStep: 'Initializing',
      totalSteps: 5,
      startedAt: new Date(),
    });
  }

  private updateProgress(
    documentId: string,
    step: string,
    progress: number,
    error?: string,
  ): void {
    const current = this.inMemoryProgressMap.get(documentId);
    if (current) {
      current.currentStep = step;
      current.progress = progress;
      current.error = error;

      if (progress === 100) {
        current.estimatedCompletion = new Date();
      }
    }
  }

  private async updateDocumentStatus(
    documentId: string,
    status: DocumentStatus,
    progress: number,
    error?: string,
  ): Promise<void> {
    const updateData: {
      status: DocumentStatus;
      processingProgress: number;
      processingError?: string | null;
      processedAt?: Date;
    } = {
      status,
      processingProgress: progress,
    };

    if (error) {
      updateData.processingError = error;
    }

    if (status === DocumentStatus.processed) {
      updateData.processedAt = new Date();
      updateData.processingError = null;
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: updateData,
    });
  }

  private async saveProcessingResults(
    documentId: string,
    result: ProcessingResult,
  ): Promise<void> {
    // Update document metadata
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        metadata: {
          ...result.metadata,
          processingResult: {
            success: result.success,
            totalPages: result.pages.length,
            averageConfidence:
              result.pages.length > 0
                ? result.pages.reduce((sum, p) => sum + p.confidence, 0) /
                  result.pages.length
                : 0,
          },
        },
      },
    });

    // Save pages
    for (const pageResult of result.pages) {
      await this.prisma.page.create({
        data: {
          documentId,
          pageNumber: pageResult.pageNumber,
          extractedText: pageResult.text || '',
          confidenceScore: pageResult.confidence,
          ocrMetadata: pageResult.metadata,
          boundingBoxes: JSON.stringify(pageResult.boundingBoxes || []),
        },
      });

      // Create text chunks for better search and retrieval
      const page = await this.prisma.page.findFirst({
        where: { documentId, pageNumber: pageResult.pageNumber },
        select: { id: true },
      });
      if (page) {
        await this.createTextChunks(documentId, page.id, pageResult.text);
      }
    }
  }

  private async createTextChunks(
    documentId: string,
    pageId: string,
    text: string,
  ): Promise<void> {
    // Split text into chunks of approximately 500 characters
    const chunkSize = 500;
    const overlap = 50; // Overlap between chunks for context

    const chunks: Array<{
      documentId: string;
      pageId: string;
      chunkIndex: number;
      content: string;
      startChar: number;
      endChar: number;
      metadata: {
        wordCount: number;
        characterCount: number;
      };
    }> = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      let chunkText = text.substring(start, end);

      // Try to break at word boundaries
      if (end < text.length) {
        const lastSpace = chunkText.lastIndexOf(' ');
        if (lastSpace > chunkSize * 0.8) {
          // Only if we don't lose too much text
          chunkText = chunkText.substring(0, lastSpace);
        }
      }

      if (chunkText.trim()) {
        chunks.push({
          documentId,
          pageId,
          chunkIndex: chunkIndex++,
          content: chunkText.trim(),
          startChar: start,
          endChar: start + chunkText.length,
          metadata: {
            wordCount: chunkText.split(/\s+/).length,
            characterCount: chunkText.length,
          },
        });
      }

      start += chunkText.length - overlap;
      if (start >= text.length) break;
    }

    // Batch insert chunks
    if (chunks.length > 0) {
      await this.prisma.documentChunk.createMany({
        data: chunks,
      });
    }
  }

  private async updateProjectStats(projectId: string): Promise<void> {
    // Get aggregated stats
    const stats = await this.prisma.document.aggregate({
      where: { projectId },
      _count: { id: true },
      _sum: { fileSizeBytes: true },
    });

    // Note: pageCount could be used for future statistics
    // const pageCount = await this.prisma.page.count({
    //   where: {
    //     document: { projectId },
    //   },
    // });

    // Update project
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        documentCount: stats._count.id || 0,
        totalSizeBytes: stats._sum.fileSizeBytes || BigInt(0),
      },
    });
  }

  private getStepFromStatus(status: DocumentStatus): string {
    switch (status) {
      case DocumentStatus.uploading:
        return 'Uploading';
      case DocumentStatus.processing:
        return 'Processing';
      case DocumentStatus.processed:
        return 'Completed';
      case DocumentStatus.failed:
        return 'Failed';
      default:
        return 'Unknown';
    }
  }
}
