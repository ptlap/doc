import { Global, Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service';
import { StorageService } from './services/storage.service';
import { AppLoggerService } from './services/app-logger.service';
import { PermissionsService } from './services/permissions.service';
import { TokenBlocklistService } from './services/token-blocklist.service';
import { RequestContextService } from './services/request-context.service';

@Global()
@Module({
  providers: [
    PrismaService,
    StorageService,
    AppLoggerService,
    PermissionsService,
    TokenBlocklistService,
    RequestContextService,
  ],
  exports: [
    PrismaService,
    StorageService,
    AppLoggerService,
    PermissionsService,
    TokenBlocklistService,
    RequestContextService,
  ],
})
export class CommonModule {}
