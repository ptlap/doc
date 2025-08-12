import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { ProcessingController } from './processing.controller';
import { ProcessingService } from './processing.service';

import { DocxProcessor } from '../../common/processors/docx-processor';
import { ImageProcessor } from '../../common/processors/image-processor';
import { PdfProcessor } from '../../common/processors/pdf-processor';
import { ProcessorFactory } from '../../common/processors/processor-factory';
import { TextProcessor } from '../../common/processors/text-processor';
import { CircuitBreakerService } from '../../common/services/circuit-breaker.service';
import { ProcessingQueueService } from '../../common/services/processing-queue.service';

@Module({
  imports: [CommonModule],
  controllers: [ProcessingController],
  providers: [
    ProcessingService,
    ProcessorFactory,
    PdfProcessor,
    ImageProcessor,
    DocxProcessor,
    TextProcessor,
    ProcessingQueueService,
    CircuitBreakerService,
  ],
  exports: [ProcessingService, ProcessorFactory],
})
export class ProcessingModule {}
