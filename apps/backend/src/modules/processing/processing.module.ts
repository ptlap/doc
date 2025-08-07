import { Module } from '@nestjs/common';
import { ProcessingService } from './processing.service';
import { ProcessingController } from './processing.controller';

import { ProcessorFactory } from '../../common/processors/processor-factory';
import { PdfProcessor } from '../../common/processors/pdf-processor';
import { ImageProcessor } from '../../common/processors/image-processor';
import { DocxProcessor } from '../../common/processors/docx-processor';
import { TextProcessor } from '../../common/processors/text-processor';

@Module({
  controllers: [ProcessingController],
  providers: [
    ProcessingService,
    ProcessorFactory,
    PdfProcessor,
    ImageProcessor,
    DocxProcessor,
    TextProcessor,
  ],
  exports: [ProcessingService, ProcessorFactory],
})
export class ProcessingModule {}
