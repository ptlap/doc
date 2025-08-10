import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Document, Project, User } from '@prisma/client';
import { PrismaService } from '../../common/services/prisma.service';
import {
  StorageFile,
  StorageService,
} from '../../common/services/storage.service';
import { DocumentStatus, DocumentType } from '../../types/prisma.types';
import { ProcessingService } from '../processing/processing.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { UploadProgressDto } from './dto/upload-progress.dto';

interface ProjectSettings {
  language?: string;
  ocrEnabled?: boolean;
  extractImages?: boolean;
  preserveFormatting?: boolean;
  quality?: string;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly projectsService: ProjectsService,
    private readonly processingService: ProcessingService,
  ) {}

  async uploadDocument(
    file: Express.Multer.File,
    createDocumentDto: CreateDocumentDto,
  ): Promise<DocumentResponseDto> {
    const { projectId, userId } = createDocumentDto;

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    // Verify project exists and user has access
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        userId: userId,
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found or access denied');
    }

    // Determine document type from MIME type
    const documentType = this.getDocumentTypeFromMime(file.mimetype);

    // Generate storage key
    const storageKey = this.storageService.generateFileKey(
      file.originalname,
      userId,
      projectId,
    );

    try {
      // Create document record first
      const document = await this.prisma.document.create({
        data: {
          projectId,
          userId,
          originalFilename: file.originalname,
          storedFilename: storageKey,
          mimeType: file.mimetype,
          fileSizeBytes: BigInt(file.size),
          status: DocumentStatus.uploading,
          documentType,
          metadata: {
            uploadStartedAt: new Date().toISOString(),
            userAgent: 'API', // TODO: Get from request headers
          },
          processingProgress: 0,
        },
      });

      // Upload file to storage
      const storageFile: StorageFile = {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      };

      const uploadResult = await this.storageService.uploadFile(
        storageFile,
        storageKey,
      );

      // Update document with upload success
      const updatedDocument = await this.prisma.document.update({
        where: { id: document.id },
        data: {
          status: DocumentStatus.uploaded,
          metadata: {
            ...(document.metadata as object),
            uploadCompletedAt: new Date().toISOString(),
            storageUrl: uploadResult.url,
            storageEtag: uploadResult.etag,
          },
          processingProgress: 25, // Upload complete = 25% progress
        },
        include: {
          project: true,
          user: true,
        },
      });

      // Update project document count and size
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          documentCount: {
            increment: 1,
          },
          totalSizeBytes: {
            increment: BigInt(file.size),
          },
        },
      });

      this.logger.log(`Document uploaded successfully: ${document.id}`);

      // Trigger document processing pipeline automatically
      void this.triggerDocumentProcessing(
        document.id,
        updatedDocument.project.settings as ProjectSettings,
      );

      return this.mapToDocumentResponse(updatedDocument);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Upload failed: ${errorMessage}`);

      // Update document status to failed if it was created
      try {
        await this.prisma.document.updateMany({
          where: {
            storedFilename: storageKey,
            status: DocumentStatus.uploading,
          },
          data: {
            status: DocumentStatus.failed,
            processingError: errorMessage,
          },
        });
      } catch (updateError) {
        const updateErrorMessage =
          updateError instanceof Error ? updateError.message : 'Unknown error';
        this.logger.error(
          `Failed to update document status: ${updateErrorMessage}`,
        );
      }

      throw new BadRequestException(`Upload failed: ${errorMessage}`);
    }
  }

  async getUploadProgress(documentId: string): Promise<UploadProgressDto> {
    // Type guard: ensure UUID format to avoid Prisma P2023 (invalid UUID) and return 404 for invalid ids
    const isUuid = (value: unknown): value is string =>
      typeof value === 'string' &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
        value,
      );

    if (!isUuid(documentId)) {
      throw new NotFoundException('Document not found');
    }

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        originalFilename: true,
        status: true,
        processingProgress: true,
        processingError: true,
        createdAt: true,
        updatedAt: true,
        processedAt: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return {
      documentId: document.id,
      filename: document.originalFilename,
      status: document.status,
      progress: document.processingProgress,
      error: document.processingError,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      completedAt: document.processedAt,
    };
  }

  async getDocumentFile(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        storedFilename: true,
        originalFilename: true,
        mimeType: true,
        fileSizeBytes: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const fileBuffer = await this.storageService.getFile(
      document.storedFilename,
    );

    return {
      buffer: fileBuffer,
      originalFilename: document.originalFilename,
      mimetype: document.mimeType,
      size: Number(document.fileSizeBytes),
    };
  }

  async getPreviewUrl(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        storedFilename: true,
        status: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (
      document.status !== DocumentStatus.uploaded &&
      document.status !== DocumentStatus.processed
    ) {
      throw new BadRequestException('Document is not ready for preview');
    }

    const expiresIn = 3600; // 1 hour
    const url = await this.storageService.getSignedUrl(
      document.storedFilename,
      expiresIn,
    );

    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  private getDocumentTypeFromMime(mimeType: string): DocumentType {
    switch (mimeType) {
      case 'application/pdf':
        return DocumentType.pdf;
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return DocumentType.docx;
      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        return DocumentType.pptx;
      case 'text/plain':
        return DocumentType.txt;
      case 'image/jpeg':
      case 'image/png':
      case 'image/gif':
        return DocumentType.image;
      default:
        return DocumentType.other;
    }
  }

  private mapToDocumentResponse(
    document: Document & { project: Project; user: User },
  ): DocumentResponseDto {
    return {
      id: document.id,
      projectId: document.projectId,
      projectName: document.project.name,
      originalFilename: document.originalFilename,
      mimeType: document.mimeType,
      fileSizeBytes: Number(document.fileSizeBytes),
      status: document.status,
      documentType: document.documentType,
      processingProgress: document.processingProgress,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      processedAt: document.processedAt,
      metadata: document.metadata,
      user: {
        name: document.user.name,
        email: document.user.email,
      },
    };
  }

  private triggerDocumentProcessing(
    documentId: string,
    projectSettings: ProjectSettings = {},
  ): void {
    try {
      // Extract processing options from project settings
      const processingOptions = {
        language: projectSettings.language || 'eng',
        ocrEnabled: projectSettings.ocrEnabled ?? true,
        extractImages: projectSettings.extractImages ?? false,
        preserveFormatting: projectSettings.preserveFormatting ?? false,
        quality: (projectSettings.quality || 'medium') as
          | 'low'
          | 'medium'
          | 'high',
        priority: 'normal' as const,
      };

      this.logger.log(`Triggering processing for document: ${documentId}`);

      // Start processing asynchronously (don't await to avoid blocking upload response)
      this.processingService
        .processDocument(documentId, processingOptions)
        .catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Auto-processing failed for document ${documentId}: ${errorMessage}`,
          );
        });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to trigger processing for document ${documentId}: ${errorMessage}`,
      );
    }
  }
}
