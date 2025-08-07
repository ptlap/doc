import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ProcessingModule } from './modules/processing/processing.module';
import { UploadModule } from './modules/upload/upload.module';
import { PrismaService } from './common/services/prisma.service';
import { AppLoggerService } from './common/services/app-logger.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
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
    AuthModule,
    ProjectsModule,
    ProcessingModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    AppLoggerService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AppLoggerService],
})
export class AppModule {}
