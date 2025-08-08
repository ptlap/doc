import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import {
  ProcessingService,
  ProcessDocumentOptions,
} from './processing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { currentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Policy } from '../../common/decorators/policy.decorator';
import { Role } from '../../common/enums/role.enum';
import { PrismaService } from '../../common/services/prisma.service';
// import { publicDecorator } from '../../common/decorators/public.decorator';
import type { User } from '@prisma/client';

@ApiTags('Document Processing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('processing')
export class ProcessingController {
  constructor(
    private readonly processingService: ProcessingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('documents/:id/process')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(Role.USER, Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'projects:write' }] })
  @ApiOperation({ summary: 'Start document processing' })
  @ApiParam({
    name: 'id',
    description: 'Document ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({
    description: 'Processing options',
    schema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          example: 'eng',
          description: 'OCR language (eng, vie, etc.)',
        },
        ocrEnabled: {
          type: 'boolean',
          example: true,
          description: 'Enable OCR processing',
        },
        extractImages: {
          type: 'boolean',
          example: false,
          description: 'Extract images from document',
        },
        preserveFormatting: {
          type: 'boolean',
          example: false,
          description: 'Preserve document formatting',
        },
        quality: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          example: 'medium',
          description: 'Processing quality',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          example: 'normal',
          description: 'Processing priority',
        },
      },
    },
    required: false,
  })
  @ApiResponse({
    status: 202,
    description: 'Processing started successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Document processing started' },
        documentId: {
          type: 'string',
          example: '123e4567-e89b-12d3-a456-426614174000',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid token',
  })
  async processDocument(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() options: ProcessDocumentOptions = {},
    @currentUser() user: User,
  ) {
    // Verify user owns the document
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        userId: user.id,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Start processing asynchronously
    this.processingService
      .processDocument(documentId, options)
      .catch((error) => {
        console.error(`Processing failed for document ${documentId}:`, error);
      });

    return {
      message: 'Document processing started',
      documentId,
    };
  }

  @Post('documents/:id/reprocess')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(Role.USER, Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'projects:write' }] })
  @ApiOperation({ summary: 'Reprocess document with new options' })
  @ApiParam({
    name: 'id',
    description: 'Document ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 202,
    description: 'Reprocessing started successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  async reprocessDocument(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() options: ProcessDocumentOptions = {},
    @currentUser() user: User,
  ) {
    // Verify user owns the document
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        userId: user.id,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Start reprocessing asynchronously
    this.processingService
      .reprocessDocument(documentId, options)
      .catch((error) => {
        console.error(`Reprocessing failed for document ${documentId}:`, error);
      });

    return {
      message: 'Document reprocessing started',
      documentId,
    };
  }

  @Get('documents/:id/progress')
  @Roles(Role.USER, Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'projects:read' }] })
  @ApiOperation({ summary: 'Get document processing progress' })
  @ApiParam({
    name: 'id',
    description: 'Document ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Processing progress retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['uploading', 'processing', 'completed', 'failed'],
        },
        progress: { type: 'number', minimum: 0, maximum: 100 },
        currentStep: { type: 'string' },
        totalSteps: { type: 'number' },
        startedAt: { type: 'string', format: 'date-time' },
        estimatedCompletion: {
          type: 'string',
          format: 'date-time',
          nullable: true,
        },
        error: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  async getProcessingProgress(
    @Param('id', ParseUUIDPipe) documentId: string,
    @currentUser() user: User,
  ) {
    // Verify user owns the document
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        userId: user.id,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const progress =
      await this.processingService.getProcessingProgress(documentId);

    if (!progress) {
      throw new NotFoundException('Processing progress not found');
    }

    return progress;
  }

  @Get('supported-types')
  @ApiOperation({ summary: 'Get supported file types for processing' })
  @ApiResponse({
    status: 200,
    description: 'Supported file types retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        mimeTypes: {
          type: 'array',
          items: { type: 'string' },
          example: ['application/pdf', 'image/jpeg', 'image/png'],
        },
        processors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              supportedTypes: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      },
    },
  })
  @Roles(Role.USER, Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'projects:read' }] })
  getSupportedTypes() {
    return {
      mimeTypes: this.processingService.getSupportedMimeTypes(),
      processors: this.processingService.getProcessorInfo(),
    };
  }

  @Get('documents/:id/pages')
  @Roles(Role.USER, Role.ADMIN)
  @ApiOperation({ summary: 'Get processed pages for a document' })
  @ApiParam({
    name: 'id',
    description: 'Document ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Document pages retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          pageNumber: { type: 'number' },
          content: { type: 'string' },
          confidence: { type: 'number' },
          metadata: { type: 'object' },
          boundingBoxes: { type: 'array' },
          imageUrl: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  async getDocumentPages(
    @Param('id', ParseUUIDPipe) documentId: string,
    @currentUser() user: User,
  ) {
    // Verify user owns the document
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        userId: user.id,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const pages = await this.prisma.page.findMany({
      where: { documentId },
      orderBy: { pageNumber: 'asc' },
    });

    return pages;
  }

  @Get('documents/:id/chunks')
  @Roles(Role.USER, Role.ADMIN)
  @ApiOperation({ summary: 'Get text chunks for a document' })
  @ApiParam({
    name: 'id',
    description: 'Document ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Document chunks retrieved successfully',
  })
  async getDocumentChunks(
    @Param('id', ParseUUIDPipe) documentId: string,
    @currentUser() user: User,
  ) {
    // Verify user owns the document
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        userId: user.id,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: [{ chunkIndex: 'asc' }],
    });

    return chunks;
  }
}
