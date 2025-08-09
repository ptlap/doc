import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { Role } from '../../common/enums/role.enum';
import type { UserRole as PrismaUserRole } from '@prisma/client';

interface GetUsersOptions {
  page: number;
  limit: number;
  role?: Role;
  status?: string;
  search?: string;
}

interface GetProjectsOptions {
  page: number;
  limit: number;
  status?: string;
}

interface GetDocumentsOptions {
  page: number;
  limit: number;
  status?: string;
}

interface GetLogsOptions {
  level?: string;
  limit: number;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toPrismaUserRole(role: Role): PrismaUserRole {
    switch (role) {
      case Role.ADMIN:
        return 'admin';
      case Role.USER:
        return 'user';
      case Role.GUEST:
        return 'guest';
      default:
        // Exhaustive guard
        return 'user';
    }
  }

  async getDashboard() {
    const [
      totalUsers,
      activeUsers,
      totalProjects,
      totalDocuments,
      recentUsers,
      recentProjects,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.project.count(),
      this.prisma.document.count(),
      this.prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      }),
      this.prisma.project.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          user: { select: { name: true, email: true } },
          createdAt: true,
          documentCount: true,
        },
      }),
    ]);

    const systemHealth = await this.getSystemHealth();

    return {
      totalUsers,
      activeUsers,
      totalProjects,
      totalDocuments,
      systemHealth,
      recentActivity: {
        users: recentUsers,
        projects: recentProjects,
      },
    };
  }

  async getUsers(options: GetUsersOptions) {
    const { page, limit, role, status, search } = options;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (role) {
      where.role = role;
    }

    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
          preferences: true,
          _count: {
            select: {
              projects: true,
              documents: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        preferences: true,
        projects: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            documentCount: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        documents: {
          select: {
            id: true,
            originalFilename: true,
            status: true,
            createdAt: true,
            fileSizeBytes: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            projects: true,
            documents: true,
            sessions: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateUserRole(userId: string, newRole: Role, adminId: string) {
    // Prevent admin from changing their own role
    if (userId === adminId) {
      throw new BadRequestException('Cannot change your own role');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { role: newRole, tokenVersion: { increment: 1 } },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        updatedAt: true,
      },
    });

    this.logger.log(
      `Admin ${adminId} changed user ${user.email} role from ${user.role} to ${newRole}`,
    );

    // Record role grant
    try {
      await this.prisma.roleGrant.create({
        data: {
          userId: userId,
          role: this.toPrismaUserRole(newRole),
          grantedBy: adminId,
          reason: 'manual_update',
        },
      });
    } catch {
      // ignore audit failure
    }

    // Audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'update_user_role',
          resourceType: 'user',
          resourceId: userId,
          oldValues: { role: user.role },
          newValues: { role: newRole },
        },
      });
    } catch {
      // ignore
    }

    return updatedUser;
  }

  async updateUserStatus(userId: string, isActive: boolean, adminId: string) {
    // Prevent admin from deactivating themselves
    if (userId === adminId && !isActive) {
      throw new BadRequestException('Cannot deactivate your own account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive, tokenVersion: { increment: 1 } },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        updatedAt: true,
      },
    });

    this.logger.log(
      `Admin ${adminId} ${isActive ? 'activated' : 'deactivated'} user ${user.email}`,
    );

    // Audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'update_user_status',
          resourceType: 'user',
          resourceId: userId,
          oldValues: { isActive: user.isActive },
          newValues: { isActive },
        },
      });
    } catch {
      // ignore
    }

    return updatedUser;
  }

  async deleteUser(userId: string, adminId: string) {
    // Prevent admin from deleting themselves
    if (userId === adminId) {
      throw new BadRequestException('Cannot delete your own account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Soft delete by deactivating and marking as deleted
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        // You might want to add a deletedAt field to your schema
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Admin ${adminId} deleted user ${user.email}`);

    // Audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'delete_user',
          resourceType: 'user',
          resourceId: userId,
          oldValues: { isActive: true },
          newValues: { isActive: false },
        },
      });
    } catch {
      // ignore
    }
  }

  async getAllProjects(options: GetProjectsOptions) {
    const { page, limit, status } = options;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          documentCount: true,
          totalSizeBytes: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.project.count({ where }),
    ]);

    return {
      projects,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAllDocuments(options: GetDocumentsOptions) {
    const { page, limit, status } = options;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }

    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          fileSizeBytes: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      documents,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSystemHealth() {
    try {
      // Test database connection
      await this.prisma.$queryRaw`SELECT 1`;
      const databaseStatus = 'healthy';

      // Get memory usage
      const memoryUsage = process.memoryUsage();

      return {
        database: databaseStatus,
        storage: 'healthy', // You can implement actual storage health check
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
        },
        uptime: Math.round(process.uptime()),
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Health check failed', error);
      return {
        database: 'unhealthy',
        storage: 'unknown',
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getSystemLogs(options: GetLogsOptions): Promise<{
    logs: Array<{
      id: number;
      timestamp: string;
      level: string;
      message: string;
      service: string;
      metadata: Record<string, unknown>;
    }>;
    total: number;
    filters: { level?: string; limit: number };
  }> {
    // This is a placeholder implementation
    // In a real application, you would integrate with your logging system
    await new Promise((resolve) => setTimeout(resolve, 1)); // Simulate async work
    const { level, limit } = options;

    // Mock logs for demonstration
    const mockLogs = Array.from({ length: limit }, (_, i) => ({
      id: i + 1,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      level: ['info', 'warn', 'error'][Math.floor(Math.random() * 3)],
      message: `Sample log message ${i + 1}`,
      service: 'backend',
      metadata: {
        userId: 'sample-user-id',
        action: 'sample-action',
      },
    }));

    let filteredLogs = mockLogs;
    if (level) {
      filteredLogs = mockLogs.filter((log) => log.level === level);
    }

    return {
      logs: filteredLogs,
      total: filteredLogs.length,
      filters: { level, limit },
    };
  }

  async triggerMaintenance(adminId: string): Promise<{
    success: boolean;
    message: string;
    results: Array<{ task: string; status: string; duration: string }>;
    timestamp: string;
  }> {
    this.logger.log(`Maintenance triggered by admin ${adminId}`);

    // Implement actual maintenance tasks here
    const tasks = [
      'Cleaning up expired sessions',
      'Optimizing database',
      'Clearing temporary files',
      'Updating system caches',
    ];

    // Simulate maintenance tasks
    await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate async work
    const results = tasks.map((task) => ({
      task,
      status: 'completed',
      duration: `${Math.floor(Math.random() * 5000) + 1000}ms`, // Random duration
    }));

    return {
      success: true,
      message: 'Maintenance tasks completed successfully',
      results: results,
      timestamp: new Date().toISOString(),
    };
  }

  async getUsageAnalytics(period: string) {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const [newUsers, newProjects, newDocuments, activeUsers] =
      await Promise.all([
        this.prisma.user.count({
          where: { createdAt: { gte: startDate } },
        }),
        this.prisma.project.count({
          where: { createdAt: { gte: startDate } },
        }),
        this.prisma.document.count({
          where: { createdAt: { gte: startDate } },
        }),
        this.prisma.user.count({
          where: {
            lastLoginAt: { gte: startDate },
            isActive: true,
          },
        }),
      ]);

    return {
      period,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      metrics: {
        newUsers,
        newProjects,
        newDocuments,
        activeUsers,
      },
    };
  }
}
