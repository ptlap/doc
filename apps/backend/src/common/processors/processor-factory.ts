import { Injectable, Logger } from '@nestjs/common';
import {
  BaseProcessor,
  ProcessingResult,
  ProcessorOptions,
} from './base-processor.interface';
import { PdfProcessor } from './pdf-processor';
import { ImageProcessor } from './image-processor';
import { DocxProcessor } from './docx-processor';
import { TextProcessor } from './text-processor';

@Injectable()
export class ProcessorFactory {
  private readonly logger = new Logger(ProcessorFactory.name);
  private readonly processors: BaseProcessor[];

  constructor(
    private readonly pdfProcessor: PdfProcessor,
    private readonly imageProcessor: ImageProcessor,
    private readonly docxProcessor: DocxProcessor,
    private readonly textProcessor: TextProcessor,
  ) {
    this.processors = [
      this.pdfProcessor,
      this.imageProcessor,
      this.docxProcessor,
      this.textProcessor,
    ];
  }

  getProcessor(mimeType: string): BaseProcessor | null {
    const processor = this.processors.find((p) => p.canProcess(mimeType));

    if (!processor) {
      this.logger.warn(`No processor found for MIME type: ${mimeType}`);
      return null;
    }

    this.logger.log(
      `Using ${processor.processorName} for MIME type: ${mimeType}`,
    );
    return processor;
  }

  async processDocument(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options?: ProcessorOptions,
  ): Promise<ProcessingResult> {
    const processor = this.getProcessor(mimeType);

    if (!processor) {
      return {
        success: false,
        pages: [],
        metadata: {
          totalPages: 0,
          processingTime: 0,
          fileSize: buffer.length,
          mimeType,
        },
        error: `Unsupported file type: ${mimeType}`,
      };
    }

    try {
      return await processor.process(buffer, filename, options);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Document processing failed: ${errorMessage}`);
      return {
        success: false,
        pages: [],
        metadata: {
          totalPages: 0,
          processingTime: 0,
          fileSize: buffer.length,
          mimeType,
        },
        error: `Processing failed: ${errorMessage}`,
      };
    }
  }

  getSupportedMimeTypes(): string[] {
    const allMimeTypes = this.processors.flatMap((p) => p.supportedMimeTypes);
    return [...new Set(allMimeTypes)]; // Remove duplicates
  }

  isSupported(mimeType: string): boolean {
    return this.processors.some((p) => p.canProcess(mimeType));
  }

  getProcessorInfo(): Array<{ name: string; supportedTypes: string[] }> {
    return this.processors.map((p) => ({
      name: p.processorName,
      supportedTypes: p.supportedMimeTypes,
    }));
  }
}
