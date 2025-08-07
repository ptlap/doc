import { ApiProperty } from '@nestjs/swagger';
import { ProjectResponseDto } from './project-response.dto';

export class PaginatedProjectsDto {
  @ApiProperty({
    description: 'Array of projects',
    type: [ProjectResponseDto],
  })
  data: ProjectResponseDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    example: {
      total: 25,
      page: 1,
      limit: 10,
      totalPages: 3,
      hasNext: true,
      hasPrev: false,
    },
  })
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
