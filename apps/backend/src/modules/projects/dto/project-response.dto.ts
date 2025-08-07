import { ApiProperty } from '@nestjs/swagger';
import { ProjectStatus } from '@prisma/client';

export class ProjectResponseDto {
  @ApiProperty({
    description: 'Project ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Project name',
    example: 'AI Research Documents',
  })
  name: string;

  @ApiProperty({
    description: 'Project description',
    example: 'Collection of AI research papers for analysis',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    description: 'Project status',
    enum: ProjectStatus,
    example: ProjectStatus.active,
  })
  status: ProjectStatus;

  @ApiProperty({
    description: 'Project owner ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  userId: string;

  @ApiProperty({
    description: 'Project creation date',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Project last update date',
    example: '2024-01-01T00:00:00.000Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'Project settings and preferences',
    example: {
      ocrEnabled: true,
      chatEnabled: true,
      language: 'en',
      autoProcess: true,
    },
  })
  settings: Record<string, any>;

  @ApiProperty({
    description: 'Project statistics',
    example: {
      totalDocuments: 5,
      totalPages: 150,
      totalSize: 1024000,
      lastActivity: '2024-01-01T00:00:00.000Z',
    },
  })
  stats?: {
    totalDocuments: number;
    totalPages: number;
    totalSize: number;
    lastActivity: Date | null;
  };

  @ApiProperty({
    description: 'Project owner information',
    example: {
      id: '123e4567-e89b-12d3-a456-426614174001',
      name: 'John Doe',
      email: 'john@example.com',
    },
  })
  user?: {
    id: string;
    name: string;
    email: string;
  };
}
