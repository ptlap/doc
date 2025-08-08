import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ProcessingModule } from './modules/processing/processing.module';
import { UploadModule } from './modules/upload/upload.module';
import { AdminModule } from './modules/admin/admin.module';
import { ManagementModule } from './modules/management/management.module';
import { CommonModule } from './common/common.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RbacExceptionFilter } from './common/filters/rbac-exception.filter';
import { AuthExceptionFilter } from './common/filters/auth-exception.filter';
import { PerformanceInterceptor } from './common/interceptors/performance.interceptor';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { RolesGuard } from './common/guards/roles.guard';
import { PolicyGuard } from './common/guards/policy.guard';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { RedactionInterceptor } from './common/interceptors/redaction.interceptor';
import configuration from './common/config/configuration';
import { configValidationSchema } from './common/config/config.schema';
import storageConfig from './config/storage.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration, storageConfig],
      envFilePath: [
        '.env.development.local',
        '.env.development',
        '.env.local',
        '.env',
      ],
      validationSchema: configValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
      },
    }),
    CommonModule,
    AuthModule,
    ProjectsModule,
    ProcessingModule,
    UploadModule,
    AdminModule,
    ManagementModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PolicyGuard,
    },
    {
      provide: APP_FILTER,
      useClass: RbacExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: AuthExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PerformanceInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RedactionInterceptor,
    },
  ],
})
export class AppModule {}
