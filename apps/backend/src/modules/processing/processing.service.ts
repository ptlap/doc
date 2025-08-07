import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { StorageService } from '../../common/services/storage.service';
import { ProcessorFactory } from '../../common/processors/processor-factory';
import {
  ProcessingResult,
  ProcessorOptions,
} from '../../common/processors/base-processor.interface';
import { DocumentStatus } from '@prisma/client';

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
  private readonly processingQueue = new Map<string, ProcessingProgress>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly processorFactory: ProcessorFactory,
  ) {}

  async processDocument(
    documentId: string,
    options: ProcessDocumentOptions = {},
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting document processing: ${documentId}`);

      // Initialize progress tracking
      this.initializeProgress(documentId);

      // Get document from database
      const document = await this.prisma.document.findUnique({
        where: { id: documentId },
        include: {
          project: {
            select: {
              settings: true,
            },
          },
        },
      });

      if (!document) {
        throw new NotFoundException(`Document not found: ${documentId}`);
      }

      // Update status to processing
      await this.updateDocumentStatus(
        documentId,
        DocumentStatus.processing,
        10,
      );

      // Download file from storage
      this.updateProgress(documentId, 'Downloading file', 20);
      const fileBuffer = await this.storageService.getFile(
        document.storedFilename,
      );

      // Merge project settings with processing options
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

      // Process document
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

      // Save processing results
      this.updateProgress(documentId, 'Saving results', 70);
      await this.saveProcessingResults(documentId, result);

      // Update document status
      await this.updateDocumentStatus(
        documentId,
        DocumentStatus.processed,
        100,
      );

      // Update project statistics
      await this.updateProjectStats(document.projectId);

      this.logger.log(
        `Document processing completed: ${documentId} in ${Date.now() - startTime}ms`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Document processing failed: ${documentId} - ${errorMessage}`,
      );

      // Update document with error
      await this.updateDocumentStatus(
        documentId,
        DocumentStatus.failed,
        0,
        errorMessage,
      );

      // Update progress with error
      this.updateProgress(documentId, 'Processing failed', 0, errorMessage);

      throw error;
    } finally {
      // Clean up progress tracking after a delay
      setTimeout(() => {
        this.processingQueue.delete(documentId);
      }, 60000); // Keep for 1 minute for status queries
    }
  }

  async getProcessingProgress(
    documentId: string,
  ): Promise<ProcessingProgress | null> {
    // Check in-memory progress first
    const inMemoryProgress = this.processingQueue.get(documentId);
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
    this.processingQueue.set(documentId, {
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
    const current = this.processingQueue.get(documentId);
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
          boundingBoxes: (pageResult.boundingBoxes || []) as any,
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
