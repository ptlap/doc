export interface ProcessingResult {
  success: boolean;
  pages: PageResult[];
  metadata: {
    totalPages: number;
    processingTime: number;
    fileSize: number;
    mimeType: string;
    language?: string;
    confidence?: number;
  };
  error?: string;
}

export interface PageResult {
  pageNumber: number;
  text: string;
  confidence: number;
  boundingBoxes?: BoundingBox[];
  imageUrl?: string;
  metadata: {
    width: number;
    height: number;
    dpi?: number;
    processingTime: number;
  };
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence: number;
  polygon?: Array<{ x: number; y: number }>;
  rotation?: number;
}

export interface ProcessorOptions {
  language?: string;
  ocrEnabled?: boolean;
  extractImages?: boolean;
  preserveFormatting?: boolean;
  quality?: 'low' | 'medium' | 'high';
}

export abstract class BaseProcessor {
  abstract readonly supportedMimeTypes: string[];
  abstract readonly processorName: string;

  abstract canProcess(mimeType: string): boolean;
  abstract process(
    buffer: Buffer,
    filename: string,
    options?: ProcessorOptions,
  ): Promise<ProcessingResult>;

  protected createPageResult(
    pageNumber: number,
    text: string,
    confidence: number = 1.0,
    metadata: Partial<PageResult['metadata']> = {},
  ): PageResult {
    return {
      pageNumber,
      text,
      confidence,
      metadata: {
        width: metadata.width || 0,
        height: metadata.height || 0,
        dpi: metadata.dpi,
        processingTime: metadata.processingTime || 0,
      },
    };
  }

  protected createProcessingResult(
    pages: PageResult[],
    metadata: Partial<ProcessingResult['metadata']> = {},
    error?: string,
  ): ProcessingResult {
    return {
      success: !error,
      pages,
      metadata: {
        totalPages: pages.length,
        processingTime: metadata.processingTime || 0,
        fileSize: metadata.fileSize || 0,
        mimeType: metadata.mimeType || '',
        language: metadata.language,
        confidence: metadata.confidence,
      },
      error,
    };
  }
}
