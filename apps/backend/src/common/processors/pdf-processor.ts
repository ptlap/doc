import { Injectable, Logger } from '@nestjs/common';
import {
  BaseProcessor,
  ProcessingResult,
  ProcessorOptions,
  PageResult,
} from './base-processor.interface';
import * as pdfParse from 'pdf-parse';
import pdf2pic from 'pdf2pic';
import { createWorker, PSM } from 'tesseract.js';
import * as sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

@Injectable()
export class PdfProcessor extends BaseProcessor {
  private readonly logger = new Logger(PdfProcessor.name);
  readonly supportedMimeTypes = ['application/pdf'];
  readonly processorName = 'PDF Processor';

  canProcess(mimeType: string): boolean {
    return this.supportedMimeTypes.includes(mimeType);
  }

  async process(
    buffer: Buffer,
    filename: string,
    options: ProcessorOptions = {},
  ): Promise<ProcessingResult> {
    const startTime = Date.now();

    try {
      this.logger.log(`Processing PDF: ${filename}`);

      // First, try to extract text directly from PDF
      const pdfData = await pdfParse(buffer);

      // If we have good text content and OCR is not explicitly requested, use direct extraction
      if (pdfData.text.trim().length > 50 && !options.ocrEnabled) {
        return this.processTextPdf(pdfData, buffer.length, startTime);
      }

      // Otherwise, use OCR on PDF pages
      if (options.ocrEnabled !== false) {
        return await this.processWithOcr(buffer, filename, options, startTime);
      }

      // Fallback to direct text extraction even if it's minimal
      return this.processTextPdf(pdfData, buffer.length, startTime);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `PDF processing failed for ${filename}: ${errorMessage}`,
      );
      return this.createProcessingResult(
        [],
        {
          processingTime: Date.now() - startTime,
          fileSize: buffer.length,
          mimeType: 'application/pdf',
        },
        `PDF processing failed: ${errorMessage}`,
      );
    }
  }

  private processTextPdf(
    pdfData: { text: string; numpages?: number },
    fileSize: number,
    startTime: number,
  ): ProcessingResult {
    const pages: PageResult[] = [];

    if (pdfData.text) {
      // Split text by pages if possible, otherwise treat as single page
      const pageTexts = this.splitTextIntoPages(
        pdfData.text,
        pdfData.numpages || 1,
      );

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

    return this.createProcessingResult(pages, {
      totalPages: pdfData.numpages || pages.length,
      processingTime: Date.now() - startTime,
      fileSize,
      mimeType: 'application/pdf',
      confidence: 1.0,
    });
  }

  private async processWithOcr(
    buffer: Buffer,
    filename: string,
    options: ProcessorOptions,
    startTime: number,
  ): Promise<ProcessingResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-processing-'));
    const tempPdfPath = path.join(tempDir, `${Date.now()}.pdf`);

    try {
      // Write PDF to temp file
      await fs.writeFile(tempPdfPath, buffer);

      // Convert PDF pages to images
      const convert = pdf2pic.fromPath(tempPdfPath, {
        density: 200, // DPI
        saveFilename: 'page',
        savePath: tempDir,
        format: 'png',
        width: 2000,
        height: 2000,
      });

      // Get PDF info first
      const pdfData = await pdfParse(buffer);
      const totalPages = pdfData.numpages || 1;

      const pages: PageResult[] = [];
      const worker = await createWorker();

      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO_OSD, // Automatic page segmentation with OSD
          tessedit_ocr_engine_mode: 2, // LSTM only
        });

        if (options.language) {
          await worker.reinitialize(options.language);
        } else {
          await worker.reinitialize('eng');
        }

        // Process each page
        for (let pageNum = 1; pageNum <= Math.min(totalPages, 50); pageNum++) {
          // Limit to 50 pages
          try {
            const pageStartTime = Date.now();

            // Convert page to image
            const result = await convert(pageNum, { responseType: 'buffer' });

            if (result.buffer) {
              // Get image metadata
              const imageMetadata = await sharp(result.buffer).metadata();

              // Optimize image for OCR
              const optimizedImage = await sharp(result.buffer)
                .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
                .greyscale()
                .normalize()
                .sharpen()
                .png()
                .toBuffer();

              // Perform OCR
              const { data } = await worker.recognize(optimizedImage);

              if (data.text.trim()) {
                pages.push(
                  this.createPageResult(
                    pageNum,
                    data.text.trim(),
                    data.confidence / 100,
                    {
                      width: imageMetadata.width || 0,
                      height: imageMetadata.height || 0,
                      processingTime: Date.now() - pageStartTime,
                    },
                  ),
                );
              }
            }
          } catch (pageError) {
            const errorMessage =
              pageError instanceof Error
                ? pageError.message
                : String(pageError);
            this.logger.warn(
              `Failed to process page ${pageNum}: ${errorMessage}`,
            );
          }
        }

        await worker.terminate();
      } catch (ocrError) {
        await worker.terminate();
        throw ocrError;
      }

      return this.createProcessingResult(pages, {
        totalPages,
        processingTime: Date.now() - startTime,
        fileSize: buffer.length,
        mimeType: 'application/pdf',
        language: options.language || 'eng',
        confidence:
          pages.length > 0
            ? pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length
            : 0,
      });
    } finally {
      // Cleanup temp files
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        const errorMessage =
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        this.logger.warn(`Failed to cleanup temp directory: ${errorMessage}`);
      }
    }
  }

  private splitTextIntoPages(text: string, numPages: number): string[] {
    if (numPages <= 1) {
      return [text];
    }

    // Simple heuristic: split by form feed characters or divide equally
    const formFeedSplit = text.split('\f');
    if (formFeedSplit.length > 1) {
      return formFeedSplit;
    }

    // Divide text roughly equally among pages
    const textLength = text.length;
    const charsPerPage = Math.ceil(textLength / numPages);
    const pages: string[] = [];

    for (let i = 0; i < numPages; i++) {
      const start = i * charsPerPage;
      const end = Math.min(start + charsPerPage, textLength);
      const pageText = text.substring(start, end);

      if (pageText.trim()) {
        pages.push(pageText);
      }
    }

    return pages.length > 0 ? pages : [text];
  }
}
