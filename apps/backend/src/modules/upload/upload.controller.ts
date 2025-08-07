import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  HttpStatus,
  HttpCode,
  Get,
  Param,
  Res,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Response } from 'express';
import { UploadService } from './upload.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { UploadProgressDto } from './dto/upload-progress.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { currentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('document')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a document for processing' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Document file and metadata',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file (PDF, DOCX, PPTX, TXT)',
        },
        projectId: {
          type: 'string',
          description: 'Project ID to associate the document with',
        },
        userId: {
          type: 'string',
          description: 'User ID (temporary - will be from auth)',
        },
      },
      required: ['file', 'projectId', 'userId'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Document uploaded successfully',
    type: DocumentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file or request data',
  })
  @ApiResponse({
    status: 413,
    description: 'File too large',
  })
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() createDocumentDto: CreateDocumentDto,
    @currentUser() user: User,
  ): Promise<DocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate file type
    const allowedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type ${file.mimetype} is not supported. Allowed types: PDF, DOCX, PPTX, TXT, JPG, PNG, GIF`,
      );
    }

    // Validate file size (25MB)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size ${file.size} exceeds maximum allowed size ${maxSize} bytes`,
      );
    }

    return await this.uploadService.uploadDocument(file, {
      ...createDocumentDto,
      userId: user.id,
    });
  }

  @Get('progress/:documentId')
  @ApiOperation({ summary: 'Get upload/processing progress for a document' })
  @ApiResponse({
    status: 200,
    description: 'Upload progress retrieved successfully',
    type: UploadProgressDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  async getUploadProgress(
    @Param('documentId') documentId: string,
  ): Promise<UploadProgressDto> {
    return await this.uploadService.getUploadProgress(documentId);
  }

  @Get('file/:documentId')
  @ApiOperation({ summary: 'Download original document file' })
  @ApiResponse({
    status: 200,
    description: 'File downloaded successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'File not found',
  })
  async downloadFile(
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const fileData = await this.uploadService.getDocumentFile(documentId);

      res.set({
        'Content-Type': fileData.mimetype,
        'Content-Disposition': `attachment; filename="${fileData.originalFilename}"`,
        'Content-Length': fileData.size.toString(),
      });

      res.send(fileData.buffer);
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  @Get('preview/:documentId')
  @ApiOperation({ summary: 'Get document preview URL' })
  @ApiResponse({
    status: 200,
    description: 'Preview URL generated successfully',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  async getPreviewUrl(@Param('documentId') documentId: string) {
    return await this.uploadService.getPreviewUrl(documentId);
  }

  @Post('validate')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Validate file before upload' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'File to validate',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'File validation result',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        filename: { type: 'string' },
        size: { type: 'number' },
        mimetype: { type: 'string' },
        errors: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  validateFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return {
        valid: false,
        errors: ['No file provided'],
      };
    }

    const errors: string[] = [];

    // Check file type
    const allowedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      errors.push(`File type ${file.mimetype} is not supported`);
    }

    // Check file size
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (file.size > maxSize) {
      errors.push(`File size ${file.size} exceeds maximum ${maxSize} bytes`);
    }

    // Check filename
    if (!file.originalname || file.originalname.trim() === '') {
      errors.push('Invalid filename');
    }

    return {
      valid: errors.length === 0,
      filename: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      errors,
    };
  }
}
