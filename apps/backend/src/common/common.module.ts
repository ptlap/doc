import { Global, Module } from '@nestjs/common';
import { AppLoggerService } from './services/app-logger.service';
import { PermissionsService } from './services/permissions.service';
import { PreprocessingCacheService } from './services/preprocessing-cache.service';
import { PrismaService } from './services/prisma.service';
import { RequestContextService } from './services/request-context.service';
import { StorageService } from './services/storage.service';
import { TokenBlocklistService } from './services/token-blocklist.service';

@Global()
@Module({
  providers: [
    PrismaService,
    StorageService,
    AppLoggerService,
    PermissionsService,
    TokenBlocklistService,
    RequestContextService,
    PreprocessingCacheService,
  ],
  exports: [
    PrismaService,
    StorageService,
    AppLoggerService,
    PermissionsService,
    TokenBlocklistService,
    RequestContextService,
    PreprocessingCacheService,
  ],
})
export class CommonModule {}
