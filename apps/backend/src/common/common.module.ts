import { Global, Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service';
import { StorageService } from './services/storage.service';
import { AppLoggerService } from './services/app-logger.service';

@Global()
@Module({
  providers: [PrismaService, StorageService, AppLoggerService],
  exports: [PrismaService, StorageService, AppLoggerService],
})
export class CommonModule {}
