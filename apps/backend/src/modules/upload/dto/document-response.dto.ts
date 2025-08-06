import { ApiProperty } from '@nestjs/swagger';
import { DocumentStatus, DocumentType } from '../../../types/prisma.types';

export class DocumentResponseDto {
  @ApiProperty({
    description: 'Document ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Project ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  projectId: string;

  @ApiProperty({
    description: 'Project name',
    example: 'My Research Project',
  })
  projectName: string;

  @ApiProperty({
    description: 'Original filename',
    example: 'research-paper.pdf',
  })
  originalFilename: string;

  @ApiProperty({
    description: 'MIME type',
    example: 'application/pdf',
  })
  mimeType: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1048576,
  })
  fileSizeBytes: number;

  @ApiProperty({
    description: 'Document processing status',
    enum: DocumentStatus,
    example: DocumentStatus.uploaded,
  })
  status: DocumentStatus;

  @ApiProperty({
    description: 'Document type',
    enum: DocumentType,
    example: DocumentType.pdf,
  })
  documentType: DocumentType;

  @ApiProperty({
    description: 'Processing progress (0-100)',
    example: 25,
  })
  processingProgress: number;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-08-06T12:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-08-06T12:05:00.000Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'Processing completion timestamp',
    example: '2024-08-06T12:10:00.000Z',
    nullable: true,
  })
  processedAt: Date | null;

  @ApiProperty({
    description: 'Document metadata',
    example: {
      uploadStartedAt: '2024-08-06T12:00:00.000Z',
      uploadCompletedAt: '2024-08-06T12:05:00.000Z',
      storageUrl: 'https://storage.example.com/files/...',
    },
  })
  metadata: any;

  @ApiProperty({
    description: 'User information',
    example: {
      name: 'John Doe',
      email: 'john@example.com',
    },
  })
  user: {
    name: string;
    email: string;
  };
}
