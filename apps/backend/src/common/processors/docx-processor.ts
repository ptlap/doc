import { Injectable, Logger } from '@nestjs/common';
import {
  BaseProcessor,
  ProcessingResult,
  PageResult,
} from './base-processor.interface';
import * as mammoth from 'mammoth';

@Injectable()
export class DocxProcessor extends BaseProcessor {
  private readonly logger = new Logger(DocxProcessor.name);
  readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ];
  readonly processorName = 'DOCX Processor';

  canProcess(mimeType: string): boolean {
    return this.supportedMimeTypes.includes(mimeType);
  }

  async process(buffer: Buffer, filename: string): Promise<ProcessingResult> {
    const startTime = Date.now();

    try {
      this.logger.log(`Processing DOCX: ${filename}`);

      // Extract text from DOCX
      const result = await mammoth.extractRawText({ buffer });

      const pages: PageResult[] = [];
      if (result.value.trim()) {
        // Split document into logical pages (by page breaks or sections)
        const pageTexts = this.splitIntoPages(result.value);

        pageTexts.forEach((text, index) => {
          if (text.trim()) {
            pages.push(
              this.createPageResult(
                index + 1,
                text.trim(),
                1.0, // High confidence for direct text extraction
                {
                  processingTime: 0,
                },
              ),
            );
          }
        });
      }

      // Log any warnings from mammoth
      if (result.messages.length > 0) {
        this.logger.warn(
          `DOCX processing warnings for ${filename}:`,
          result.messages,
        );
      }

      return this.createProcessingResult(pages, {
        totalPages: pages.length,
        processingTime: Date.now() - startTime,
        fileSize: buffer.length,
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        confidence: 1.0,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `DOCX processing failed for ${filename}: ${errorMessage}`,
      );
      return this.createProcessingResult(
        [],
        {
          processingTime: Date.now() - startTime,
          fileSize: buffer.length,
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        `DOCX processing failed: ${errorMessage}`,
      );
    }
  }

  private splitIntoPages(text: string): string[] {
    // Split by explicit page breaks first
    let pages = text.split('\f'); // Form feed characters

    if (pages.length === 1) {
      // If no explicit page breaks, split by section breaks or double line breaks
      pages = text.split(/\n\s*\n\s*\n/);
    }

    if (pages.length === 1) {
      // If still one page, split by large chunks (approximately 3000 characters)
      const maxCharsPerPage = 3000;
      if (text.length > maxCharsPerPage) {
        pages = [];
        let currentPos = 0;

        while (currentPos < text.length) {
          let endPos = Math.min(currentPos + maxCharsPerPage, text.length);

          // Try to break at a sentence or paragraph boundary
          if (endPos < text.length) {
            const nextParagraph = text.indexOf('\n\n', endPos);
            const nextSentence = text.indexOf('. ', endPos);

            if (nextParagraph !== -1 && nextParagraph - endPos < 200) {
              endPos = nextParagraph;
            } else if (nextSentence !== -1 && nextSentence - endPos < 100) {
              endPos = nextSentence + 1;
            }
          }

          pages.push(text.substring(currentPos, endPos));
          currentPos = endPos;
        }
      } else {
        pages = [text];
      }
    }

    // Clean up pages
    return pages.map((page) => page.trim()).filter((page) => page.length > 0);
  }
}
