import { ApiProperty } from '@nestjs/swagger';
import { DocumentStatus } from '../../../types/prisma.types';

export class UploadProgressDto {
  @ApiProperty({
    description: 'Document ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  documentId: string;

  @ApiProperty({
    description: 'Original filename',
    example: 'research-paper.pdf',
  })
  filename: string;

  @ApiProperty({
    description: 'Current processing status',
    enum: DocumentStatus,
    example: DocumentStatus.processing,
  })
  status: DocumentStatus;

  @ApiProperty({
    description: 'Processing progress percentage (0-100)',
    example: 75,
  })
  progress: number;

  @ApiProperty({
    description: 'Error message if processing failed',
    example: null,
    nullable: true,
  })
  error: string | null;

  @ApiProperty({
    description: 'Upload start timestamp',
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
  completedAt: Date | null;
}
