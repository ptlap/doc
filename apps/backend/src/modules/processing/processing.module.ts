import { Module } from '@nestjs/common';
import { ProcessingService } from './processing.service';
import { ProcessingController } from './processing.controller';
import { PrismaService } from '../../common/services/prisma.service';
import { StorageService } from '../../common/services/storage.service';
import { ProcessorFactory } from '../../common/processors/processor-factory';
import { PdfProcessor } from '../../common/processors/pdf-processor';
import { ImageProcessor } from '../../common/processors/image-processor';
import { DocxProcessor } from '../../common/processors/docx-processor';
import { TextProcessor } from '../../common/processors/text-processor';

@Module({
  controllers: [ProcessingController],
  providers: [
    ProcessingService,
    PrismaService,
    StorageService,
    ProcessorFactory,
    PdfProcessor,
    ImageProcessor,
    DocxProcessor,
    TextProcessor,
  ],
  exports: [ProcessingService, ProcessorFactory],
})
export class ProcessingModule {}
