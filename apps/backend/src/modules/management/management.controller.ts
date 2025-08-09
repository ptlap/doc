import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Policy } from '../../common/decorators/policy.decorator';
import { Role } from '../../common/enums/role.enum';
import { currentUser } from '../../common/decorators/current-user.decorator';
import { ManagementService } from './management.service';
import type { User } from '@prisma/client';

@ApiTags('System Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('management')
export class ManagementController {
  constructor(private readonly managementService: ManagementService) {}

  @Get('config')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:read' }] })
  @ApiOperation({ summary: 'Get system configuration' })
  @ApiResponse({
    status: 200,
    description: 'System configuration retrieved successfully',
  })
  async getSystemConfig() {
    return await this.managementService.getSystemConfig();
  }

  @Put('config')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:write' }] })
  @ApiOperation({ summary: 'Update system configuration' })
  @ApiResponse({
    status: 200,
    description: 'System configuration updated successfully',
  })
  async updateSystemConfig(
    @Body() configDto: Record<string, unknown>,
    @currentUser() admin: User,
  ) {
    return await this.managementService.updateSystemConfig(configDto, admin.id);
  }

  @Get('backups')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:read' }] })
  @ApiOperation({ summary: 'Get list of system backups' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Backups list retrieved successfully',
  })
  async getBackups(@Query('limit') limit: string = '10') {
    return await this.managementService.getBackups(parseInt(limit));
  }

  @Post('backups')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:write' }] })
  @ApiOperation({ summary: 'Create system backup' })
  @ApiResponse({
    status: 201,
    description: 'Backup created successfully',
  })
  async createBackup(@currentUser() admin: User) {
    return await this.managementService.createBackup(admin.id);
  }

  @Post('backups/:id/restore')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:write' }] })
  @ApiOperation({ summary: 'Restore from backup' })
  @ApiParam({ name: 'id', description: 'Backup ID' })
  @ApiResponse({
    status: 200,
    description: 'Restore initiated successfully',
  })
  async restoreBackup(
    @Param('id') backupId: string,
    @currentUser() admin: User,
  ) {
    return await this.managementService.restoreBackup(backupId, admin.id);
  }

  @Get('monitoring/metrics')
  @Roles(Role.ADMIN, Role.USER) // Users can view basic metrics
  @ApiOperation({ summary: 'Get system monitoring metrics' })
  @ApiQuery({ name: 'timeframe', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Monitoring metrics retrieved successfully',
  })
  async getMetrics(
    @Query('timeframe') timeframe: string = '1h',
    @currentUser() user: User,
  ) {
    return await this.managementService.getMetrics(timeframe, user.role);
  }

  @Get('monitoring/alerts')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:read' }] })
  @ApiOperation({ summary: 'Get system alerts' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'severity', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'System alerts retrieved successfully',
  })
  async getAlerts(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
  ) {
    return await this.managementService.getAlerts({ status, severity });
  }

  @Put('monitoring/alerts/:id')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:write' }] })
  @ApiOperation({ summary: 'Update alert status' })
  @ApiParam({ name: 'id', description: 'Alert ID' })
  @ApiResponse({
    status: 200,
    description: 'Alert updated successfully',
  })
  async updateAlert(
    @Param('id') alertId: string,
    @Body() updateDto: { status: string; notes?: string },
    @currentUser() admin: User,
  ) {
    return await this.managementService.updateAlert(
      alertId,
      updateDto,
      admin.id,
    );
  }

  @Get('security/audit-logs')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:read' }] })
  @ApiOperation({ summary: 'Get security audit logs' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'action', required: false, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
  })
  async getAuditLogs(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('action') action?: string,
    @Query('userId') userId?: string,
  ) {
    return await this.managementService.getAuditLogs({
      page: parseInt(page),
      limit: parseInt(limit),
      action,
      userId,
    });
  }

  @Get('security/sessions')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:read' }] })
  @ApiOperation({ summary: 'Get active user sessions' })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Active sessions retrieved successfully',
  })
  async getActiveSessions(@Query('userId') userId?: string) {
    return await this.managementService.getActiveSessions(userId);
  }

  @Delete('security/sessions/:id')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:write' }] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Terminate user session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({
    status: 204,
    description: 'Session terminated successfully',
  })
  async terminateSession(
    @Param('id') sessionId: string,
    @currentUser() admin: User,
  ) {
    await this.managementService.terminateSession(sessionId, admin.id);
  }

  @Get('performance/reports')
  @Roles(Role.ADMIN, Role.USER) // Users can view basic performance reports
  @Policy({ anyOf: [{ perm: 'management:config:read' }] })
  @ApiOperation({ summary: 'Get performance reports' })
  @ApiQuery({ name: 'type', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Performance reports retrieved successfully',
  })
  async getPerformanceReports(
    @Query('type') type: string = 'overview',
    @Query('period') period: string = 'week',
    @currentUser() user: User,
  ) {
    return await this.managementService.getPerformanceReports(
      type,
      period,
      user.role,
    );
  }

  @Post('maintenance/cleanup')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:write' }] })
  @ApiOperation({ summary: 'Run system cleanup tasks' })
  @ApiResponse({
    status: 200,
    description: 'Cleanup tasks initiated successfully',
  })
  async runCleanup(@currentUser() admin: User) {
    return await this.managementService.runCleanup(admin.id);
  }

  @Post('maintenance/optimize')
  @Roles(Role.ADMIN)
  @Policy({ anyOf: [{ perm: 'management:config:write' }] })
  @ApiOperation({ summary: 'Run system optimization tasks' })
  @ApiResponse({
    status: 200,
    description: 'Optimization tasks initiated successfully',
  })
  async runOptimization(@currentUser() admin: User) {
    return await this.managementService.runOptimization(admin.id);
  }
}
