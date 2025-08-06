import { IsString, IsUUID, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDocumentDto {
  @ApiProperty({
    description: 'Project ID to associate the document with',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description: 'User ID (temporary - will be extracted from JWT token)',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsString()
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Optional description for the document',
    example: 'Research paper on AI document processing',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;
}
