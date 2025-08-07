import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { currentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { AdminService } from './admin.service';
import type { User } from '@prisma/client';

@ApiTags('Admin Management')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @AdminOnly()
  @ApiOperation({ summary: 'Get admin dashboard overview' })
  @ApiResponse({
    status: 200,
    description: 'Admin dashboard data retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalUsers: { type: 'number' },
        activeUsers: { type: 'number' },
        totalProjects: { type: 'number' },
        totalDocuments: { type: 'number' },
        systemHealth: { type: 'object' },
        recentActivity: { type: 'array' },
      },
    },
  })
  async getDashboard() {
    return await this.adminService.getDashboard();
  }

  @Get('users')
  @AdminOnly()
  @ApiOperation({ summary: 'Get all users with pagination and filters' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'role',
    required: false,
    enum: Role,
    description: 'Filter by role',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name or email',
  })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        users: { type: 'array' },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  async getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('role') role?: Role,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return await this.adminService.getUsers({
      page: parseInt(page),
      limit: parseInt(limit),
      role,
      status,
      search,
    });
  }

  @Get('users/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Get user details by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User details retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async getUserById(@Param('id') id: string) {
    return await this.adminService.getUserById(id);
  }

  @Put('users/:id/role')
  @AdminOnly()
  @ApiOperation({ summary: 'Update user role' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User role updated successfully',
  })
  async updateUserRole(
    @Param('id') id: string,
    @Body() updateRoleDto: { role: Role },
    @currentUser() admin: User,
  ) {
    return await this.adminService.updateUserRole(
      id,
      updateRoleDto.role,
      admin.id,
    );
  }

  @Put('users/:id/status')
  @AdminOnly()
  @ApiOperation({ summary: 'Update user status (activate/deactivate)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User status updated successfully',
  })
  async updateUserStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: { isActive: boolean },
    @currentUser() admin: User,
  ) {
    return await this.adminService.updateUserStatus(
      id,
      updateStatusDto.isActive,
      admin.id,
    );
  }

  @Delete('users/:id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete user (soft delete)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 204,
    description: 'User deleted successfully',
  })
  async deleteUser(@Param('id') id: string, @currentUser() admin: User) {
    await this.adminService.deleteUser(id, admin.id);
  }

  @Get('projects')
  @AdminOnly()
  @ApiOperation({ summary: 'Get all projects across all users' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Projects retrieved successfully',
  })
  async getAllProjects(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: string,
  ) {
    return await this.adminService.getAllProjects({
      page: parseInt(page),
      limit: parseInt(limit),
      status,
    });
  }

  @Get('documents')
  @AdminOnly()
  @ApiOperation({ summary: 'Get all documents across all users' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Documents retrieved successfully',
  })
  async getAllDocuments(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: string,
  ) {
    return await this.adminService.getAllDocuments({
      page: parseInt(page),
      limit: parseInt(limit),
      status,
    });
  }

  @Get('system/health')
  @AdminOnly()
  @ApiOperation({ summary: 'Get system health status' })
  @ApiResponse({
    status: 200,
    description: 'System health retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        database: { type: 'string' },
        storage: { type: 'string' },
        memory: { type: 'object' },
        uptime: { type: 'number' },
        version: { type: 'string' },
      },
    },
  })
  async getSystemHealth() {
    return await this.adminService.getSystemHealth();
  }

  @Get('system/logs')
  @AdminOnly()
  @ApiOperation({ summary: 'Get system logs' })
  @ApiQuery({
    name: 'level',
    required: false,
    type: String,
    description: 'Log level filter',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of logs',
  })
  @ApiResponse({
    status: 200,
    description: 'System logs retrieved successfully',
  })
  async getSystemLogs(
    @Query('level') level?: string,
    @Query('limit') limit: string = '100',
  ) {
    return await this.adminService.getSystemLogs({
      level,
      limit: parseInt(limit),
    });
  }

  @Post('system/maintenance')
  @AdminOnly()
  @ApiOperation({ summary: 'Trigger system maintenance tasks' })
  @ApiResponse({
    status: 200,
    description: 'Maintenance tasks started successfully',
  })
  async triggerMaintenance(@currentUser() admin: User) {
    return await this.adminService.triggerMaintenance(admin.id);
  }

  @Get('analytics/usage')
  @AdminOnly()
  @ApiOperation({ summary: 'Get system usage analytics' })
  @ApiQuery({
    name: 'period',
    required: false,
    type: String,
    description: 'Time period (day, week, month)',
  })
  @ApiResponse({
    status: 200,
    description: 'Usage analytics retrieved successfully',
  })
  async getUsageAnalytics(@Query('period') period: string = 'week') {
    return await this.adminService.getUsageAnalytics(period);
  }
}
