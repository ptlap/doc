import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { PaginatedProjectsDto } from './dto/paginated-projects.dto';
import { ProjectStatus, Project, User, Prisma } from '@prisma/client';

type ProjectWithUser = Project & {
  user?: Pick<User, 'id' | 'name' | 'email'>;
};

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(
    createProjectDto: CreateProjectDto,
    userId: string,
  ): Promise<ProjectResponseDto> {
    try {
      const project = await this.prisma.project.create({
        data: {
          name: createProjectDto.name,
          description: createProjectDto.description,
          status: createProjectDto.status || ProjectStatus.active,
          userId: userId,
          settings: createProjectDto.settings || {
            ocrEnabled: true,
            chatEnabled: true,
            language: 'en',
            autoProcess: true,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      this.logger.log(`Project created: ${project.id} by user ${userId}`);

      return this.formatProjectResponse(project);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create project: ${errorMessage}`);
      throw new BadRequestException('Failed to create project');
    }
  }

  async findAll(
    query: ProjectQueryDto,
    userId: string,
  ): Promise<PaginatedProjectsDto> {
    const {
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 10,
      includeStats = false,
      includeOwner = false,
    } = query;

    // Build where clause
    const where: Prisma.ProjectWhereInput = {
      userId: userId, // Users can only see their own projects
    };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
    }

    // Build include clause
    const include: Prisma.ProjectInclude = {};
    if (includeOwner) {
      include.user = {
        select: {
          id: true,
          name: true,
          email: true,
        },
      };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    try {
      const [projects, total] = await Promise.all([
        this.prisma.project.findMany({
          where,
          include,
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.project.count({ where }),
      ]);

      // Add stats if requested
      const projectsWithStats = includeStats
        ? await this.addProjectStats(projects)
        : projects.map((p) => this.formatProjectResponse(p));

      const totalPages = Math.ceil(total / limit);

      return {
        data: projectsWithStats,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch projects: ${errorMessage}`);
      throw new BadRequestException('Failed to fetch projects');
    }
  }

  async findOne(
    id: string,
    userId: string,
    includeStats = false,
  ): Promise<ProjectResponseDto> {
    const project = await this.prisma.project.findFirst({
      where: {
        id,
        userId: userId, // Ensure user owns the project
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const projectResponse = this.formatProjectResponse(project);

    if (includeStats) {
      const stats = await this.getProjectStats(id);
      projectResponse.stats = stats;
    }

    return projectResponse;
  }

  async update(
    id: string,
    updateProjectDto: UpdateProjectDto,
    userId: string,
  ): Promise<ProjectResponseDto> {
    // Check if project exists and user owns it
    const existingProject = await this.prisma.project.findFirst({
      where: {
        id,
        userId: userId,
      },
    });

    if (!existingProject) {
      throw new NotFoundException('Project not found');
    }

    try {
      const project = await this.prisma.project.update({
        where: { id },
        data: {
          name: updateProjectDto.name,
          description: updateProjectDto.description,
          status: updateProjectDto.status,
          settings: updateProjectDto.settings
            ? {
                ...(existingProject.settings as object),
                ...updateProjectDto.settings,
              }
            : undefined,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      this.logger.log(`Project updated: ${project.id} by user ${userId}`);

      return this.formatProjectResponse(project);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update project: ${errorMessage}`);
      throw new BadRequestException('Failed to update project');
    }
  }

  async remove(id: string, userId: string): Promise<void> {
    // Check if project exists and user owns it
    const project = await this.prisma.project.findFirst({
      where: {
        id,
        userId: userId,
      },
      select: {
        id: true,
        userId: true,
        documentCount: true,
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Check if project has documents
    if (project.documentCount > 0) {
      throw new BadRequestException(
        'Cannot delete project with existing documents. Please delete all documents first.',
      );
    }

    try {
      await this.prisma.project.delete({
        where: { id },
      });

      this.logger.log(`Project deleted: ${id} by user ${userId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete project: ${errorMessage}`);
      throw new BadRequestException('Failed to delete project');
    }
  }

  async getProjectStats(projectId: string): Promise<{
    totalDocuments: number;
    totalPages: number;
    totalSize: number;
    lastActivity: Date | null;
  }> {
    const stats = await this.prisma.document.aggregate({
      where: { projectId },
      _count: { id: true },
      _sum: { fileSizeBytes: true },
    });

    const pageCount = await this.prisma.page.count({
      where: {
        document: {
          projectId,
        },
      },
    });

    const lastDocument = await this.prisma.document.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return {
      totalDocuments: stats._count.id || 0,
      totalPages: pageCount || 0,
      totalSize: Number(stats._sum.fileSizeBytes || 0),
      lastActivity: lastDocument?.createdAt || null,
    };
  }

  private async addProjectStats(
    projects: any[],
  ): Promise<ProjectResponseDto[]> {
    const projectsWithStats = await Promise.all(
      projects.map(async (project: any) => {
        const stats = await this.getProjectStats(
          (project as ProjectWithUser).id,
        );
        const formatted = this.formatProjectResponse(
          project as ProjectWithUser,
        );
        formatted.stats = stats;
        return formatted;
      }),
    );

    return projectsWithStats;
  }

  private formatProjectResponse(project: ProjectWithUser): ProjectResponseDto {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      userId: project.userId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      settings: (project.settings as Record<string, any>) || {},
      user: project.user,
    };
  }

  // Helper method to check if user can access project
  async canAccessProject(projectId: string, userId: string): Promise<boolean> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        userId: userId,
      },
    });

    return !!project;
  }
}
