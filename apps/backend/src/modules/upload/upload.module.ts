import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../common/services/prisma.service';
import { ProjectsModule } from '../projects/projects.module';
import { ProcessingModule } from '../processing/processing.module';

@Module({
  imports: [
    ProjectsModule,
    ProcessingModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        limits: {
          fileSize: configService.get<number>(
            'storage.maxFileSize',
            25 * 1024 * 1024,
          ), // 25MB default
        },
        fileFilter: (req, file, callback) => {
          const allowedMimeTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
            'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
            'text/plain',
            'image/jpeg',
            'image/png',
            'image/gif',
          ];

          if (allowedMimeTypes.includes(file.mimetype)) {
            callback(null, true);
          } else {
            callback(
              new Error(`File type ${file.mimetype} is not allowed`),
              false,
            );
          }
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, StorageService, PrismaService],
  exports: [UploadService],
})
export class UploadModule {}
