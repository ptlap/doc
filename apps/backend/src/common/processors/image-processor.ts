import { Injectable, Logger } from '@nestjs/common';
import {
  BaseProcessor,
  ProcessingResult,
  ProcessorOptions,
  PageResult,
} from './base-processor.interface';
import { createWorker, PSM } from 'tesseract.js';
import * as sharp from 'sharp';

@Injectable()
export class ImageProcessor extends BaseProcessor {
  private readonly logger = new Logger(ImageProcessor.name);
  readonly supportedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'image/webp',
  ];
  readonly processorName = 'Image Processor';

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
      this.logger.log(`Processing image: ${filename}`);

      // Get image metadata
      const metadata = await sharp(buffer).metadata();

      // Optimize image for OCR
      const optimizedImage = await this.optimizeForOcr(
        buffer,
        options.quality || 'medium',
      );

      // Perform OCR
      const worker = await createWorker();

      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO, // Fully automatic page segmentation, but no OSD
          tessedit_ocr_engine_mode: 2, // LSTM only
        });

        if (options.language) {
          await worker.reinitialize(options.language);
        } else {
          await worker.reinitialize('eng');
        }

        const { data } = await worker.recognize(optimizedImage);
        await worker.terminate();

        const pages: PageResult[] = [];
        if (data.text.trim()) {
          pages.push(
            this.createPageResult(1, data.text.trim(), data.confidence / 100, {
              width: metadata.width || 0,
              height: metadata.height || 0,
              dpi: metadata.density,
              processingTime: Date.now() - startTime,
            }),
          );
        }

        return this.createProcessingResult(pages, {
          totalPages: 1,
          processingTime: Date.now() - startTime,
          fileSize: buffer.length,
          mimeType: this.detectMimeType(filename),
          language: options.language || 'eng',
          confidence: data.confidence / 100,
        });
      } catch (ocrError) {
        await worker.terminate();
        const errorMessage =
          ocrError instanceof Error ? ocrError.message : String(ocrError);
        throw new Error(`OCR processing failed: ${errorMessage}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Image processing failed for ${filename}: ${errorMessage}`,
      );
      return this.createProcessingResult(
        [],
        {
          processingTime: Date.now() - startTime,
          fileSize: buffer.length,
          mimeType: this.detectMimeType(filename),
        },
        `Image processing failed: ${errorMessage}`,
      );
    }
  }

  private async optimizeForOcr(
    buffer: Buffer,
    quality: 'low' | 'medium' | 'high',
  ): Promise<Buffer> {
    let sharpInstance = sharp(buffer);

    // Resize based on quality setting
    switch (quality) {
      case 'low':
        sharpInstance = sharpInstance.resize(1200, 1200, {
          fit: 'inside',
          withoutEnlargement: true,
        });
        break;
      case 'medium':
        sharpInstance = sharpInstance.resize(2000, 2000, {
          fit: 'inside',
          withoutEnlargement: true,
        });
        break;
      case 'high':
        sharpInstance = sharpInstance.resize(3000, 3000, {
          fit: 'inside',
          withoutEnlargement: true,
        });
        break;
    }

    // Apply OCR optimizations
    return sharpInstance
      .greyscale() // Convert to grayscale
      .normalize() // Normalize contrast
      .sharpen() // Sharpen for better text recognition
      .png() // Convert to PNG for better quality
      .toBuffer();
  }

  private detectMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      bmp: 'image/bmp',
      tiff: 'image/tiff',
      tif: 'image/tiff',
      webp: 'image/webp',
    };
    return mimeTypeMap[ext || ''] || 'image/jpeg';
  }
}
