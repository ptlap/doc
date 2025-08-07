import { Injectable, Logger } from '@nestjs/common';
import {
  BaseProcessor,
  ProcessingResult,
  PageResult,
} from './base-processor.interface';

@Injectable()
export class TextProcessor extends BaseProcessor {
  private readonly logger = new Logger(TextProcessor.name);
  readonly supportedMimeTypes = [
    'text/plain',
    'text/csv',
    'text/html',
    'text/markdown',
    'application/json',
    'application/xml',
  ];
  readonly processorName = 'Text Processor';

  canProcess(mimeType: string): boolean {
    return this.supportedMimeTypes.includes(mimeType);
  }

  async process(buffer: Buffer, filename: string): Promise<ProcessingResult> {
    const startTime = Date.now();

    try {
      this.logger.log(`Processing text file: ${filename}`);

      // Convert buffer to text
      const text = await Promise.resolve(buffer.toString('utf-8'));

      // Clean and process text based on file type
      const processedText = this.processTextByType(
        text,
        this.detectFileType(filename),
      );

      const pages: PageResult[] = [];
      if (processedText.trim()) {
        // Split text into logical pages
        const pageTexts = this.splitIntoPages(processedText);

        pageTexts.forEach((pageText, index) => {
          if (pageText.trim()) {
            pages.push(
              this.createPageResult(
                index + 1,
                pageText.trim(),
                1.0, // High confidence for direct text
                {
                  processingTime: 0,
                },
              ),
            );
          }
        });
      }

      return this.createProcessingResult(pages, {
        totalPages: pages.length,
        processingTime: Date.now() - startTime,
        fileSize: buffer.length,
        mimeType: this.detectMimeType(filename),
        confidence: 1.0,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Text processing failed for ${filename}: ${errorMessage}`,
      );
      return this.createProcessingResult(
        [],
        {
          processingTime: Date.now() - startTime,
          fileSize: buffer.length,
          mimeType: this.detectMimeType(filename),
        },
        `Text processing failed: ${errorMessage}`,
      );
    }
  }

  private detectFileType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    return ext || 'txt';
  }

  private detectMimeType(filename: string): string {
    const ext = this.detectFileType(filename);
    const mimeTypeMap: Record<string, string> = {
      txt: 'text/plain',
      csv: 'text/csv',
      html: 'text/html',
      htm: 'text/html',
      md: 'text/markdown',
      markdown: 'text/markdown',
      json: 'application/json',
      xml: 'application/xml',
    };
    return mimeTypeMap[ext] || 'text/plain';
  }

  private processTextByType(text: string, fileType: string): string {
    switch (fileType) {
      case 'html':
      case 'htm':
        return this.stripHtmlTags(text);

      case 'json':
        return this.formatJson(text);

      case 'xml':
        return this.formatXml(text);

      case 'csv':
        return this.formatCsv(text);

      case 'md':
      case 'markdown':
        return this.formatMarkdown(text);

      default:
        return text;
    }
  }

  private stripHtmlTags(html: string): string {
    // Simple HTML tag removal - for production, consider using a proper HTML parser
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
      .replace(/<[^>]*>/g, '') // Remove all HTML tags
      .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
      .replace(/&amp;/g, '&') // Replace HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private formatJson(jsonText: string): string {
    try {
      const parsed: unknown = JSON.parse(jsonText);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return jsonText; // Return original if parsing fails
    }
  }

  private formatXml(xmlText: string): string {
    // Basic XML formatting - remove tags for text extraction
    return xmlText
      .replace(/<[^>]*>/g, ' ') // Remove XML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private formatCsv(csvText: string): string {
    // Convert CSV to readable format
    const lines = csvText.split('\n');
    return lines.map((line) => line.split(',').join(' | ')).join('\n');
  }

  private formatMarkdown(markdownText: string): string {
    // Basic markdown processing - remove markdown syntax for text extraction
    return markdownText
      .replace(/^#{1,6}\s+/gm, '') // Remove headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/`(.*?)`/g, '$1') // Remove inline code
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
      .replace(/^\s*[-*+]\s+/gm, '') // Remove list markers
      .replace(/^\s*\d+\.\s+/gm, '') // Remove numbered list markers
      .trim();
  }

  private splitIntoPages(text: string): string[] {
    // Split by explicit page breaks or form feeds
    let pages = text.split('\f');

    if (pages.length === 1) {
      // Split by double line breaks (paragraphs)
      const paragraphs = text.split(/\n\s*\n/);

      // Group paragraphs into pages (approximately 2000 characters per page)
      const maxCharsPerPage = 2000;
      pages = [];
      let currentPage = '';

      for (const paragraph of paragraphs) {
        if (
          currentPage.length + paragraph.length > maxCharsPerPage &&
          currentPage.length > 0
        ) {
          pages.push(currentPage.trim());
          currentPage = paragraph;
        } else {
          currentPage += (currentPage ? '\n\n' : '') + paragraph;
        }
      }

      if (currentPage.trim()) {
        pages.push(currentPage.trim());
      }
    }

    return pages.filter((page) => page.trim().length > 0);
  }
}
