import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';
import pdf2pic from 'pdf2pic';
import { getDocument, OPS } from 'pdfjs-dist';
import * as sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import {
  computeBornDigitalConfidence,
  computeTextQualityMetrics,
  shouldUseDirectExtraction,
} from '../utils/text-quality';
import {
  BaseProcessor,
  PageResult,
  ProcessingResult,
  ProcessorOptions,
} from './base-processor.interface';

// Type guards for pdfjs and tesseract results
interface PdfjsTextItemLike {
  str: unknown;
  transform: unknown;
  width: unknown;
  height: unknown;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFunctionValue(
  value: unknown,
): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function isTextItem(value: unknown): value is PdfjsTextItemLike {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return 'str' in v && 'transform' in v && 'width' in v && 'height' in v;
}

interface TesseractWordLike {
  text?: unknown;
  confidence?: unknown;
  bbox?: unknown;
}

// Minimal bbox shape used inline; no explicit interface needed to avoid unused warnings

// Removed unused strict guards for Tesseract word/bbox to avoid unused vars

interface TesseractDataLike {
  text?: unknown;
  confidence?: unknown;
  words?: unknown;
}

// Removed unused TesseractResultLike guard

// Narrowing for pdfjs OPS to avoid unsafe member access
function isPdfOps(value: unknown): value is {
  save: number;
  restore: number;
  transform: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintXObject: number;
} {
  if (!isObjectRecord(value)) return false;
  const v = value;
  const keys = [
    'save',
    'restore',
    'transform',
    'paintImageXObject',
    'paintInlineImageXObject',
    'paintXObject',
  ];
  return keys.every((k) => typeof v[k] === 'number');
}

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

      // First, parse PDF text and compute quality metrics
      const pdfData = await pdfParse(buffer);
      const metrics = computeTextQualityMetrics(
        pdfData.text ?? '',
        pdfData.numpages ?? 1,
      );
      const confidence = computeBornDigitalConfidence(metrics);

      // Decide path: direct extraction when confidence passes threshold OR OCR is disabled
      const directPreferred = shouldUseDirectExtraction(confidence, 0.8);

      if (directPreferred || options.ocrEnabled === false) {
        // Với born-digital, đồng thời trích bbox + regions ảnh để OCR chọn lọc
        const [bboxByPage, imageRegions] = await Promise.all([
          this.extractBoundingBoxesFromPdf(buffer),
          this.extractImageRegionsFromPdf(buffer),
        ]);
        const base = this.processTextPdf(
          pdfData,
          buffer.length,
          startTime,
          confidence,
          bboxByPage,
        );
        // Augment song song bằng OCR các vùng ảnh
        await this.augmentPagesWithImageOcr(
          buffer,
          filename,
          options,
          base.pages,
          imageRegions,
        );
        return base;
      }

      // Otherwise, run OCR as fallback
      return await this.processWithOcr(buffer, filename, options, startTime);
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
    confidenceOverride?: number,
    bboxByPage?: Array<{
      pageNumber: number;
      boxes: PageResult['boundingBoxes'];
    }>,
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
          const pageResult = this.createPageResult(
            index + 1,
            text.trim(),
            1.0,
            { processingTime: 0 },
          );
          if (Array.isArray(bboxByPage)) {
            const match = bboxByPage.find((b) => b.pageNumber === index + 1);
            if (match && Array.isArray(match.boxes)) {
              pageResult.boundingBoxes = match.boxes.filter((b) => {
                const wOk = typeof b.width === 'number' && b.width > 0.5;
                const hOk = typeof b.height === 'number' && b.height > 0.5;
                return wOk && hOk;
              });
            }
          }
          pages.push(pageResult);
        }
      });
    }

    return this.createProcessingResult(pages, {
      totalPages: pdfData.numpages || pages.length,
      processingTime: Date.now() - startTime,
      fileSize,
      mimeType: 'application/pdf',
      confidence:
        typeof confidenceOverride === 'number' ? confidenceOverride : 1.0,
    });
  }

  private async extractBoundingBoxesFromPdf(
    buffer: Buffer,
  ): Promise<
    Array<{ pageNumber: number; boxes: PageResult['boundingBoxes'] }>
  > {
    // Sử dụng pdfjs để trích xuất bbox và normalize về pixel space (an toàn kiểu)
    const results: Array<{
      pageNumber: number;
      boxes: PageResult['boundingBoxes'];
    }> = [];

    const loadingTaskUnknown: unknown = isFunctionValue(getDocument)
      ? getDocument({ data: buffer })
      : undefined;
    const loadingTask =
      typeof loadingTaskUnknown === 'object' && loadingTaskUnknown !== null
        ? (loadingTaskUnknown as Record<string, unknown>)
        : {};
    const promiseUnknown = loadingTask.promise;
    const pdfUnknown =
      typeof promiseUnknown === 'object' || typeof promiseUnknown === 'function'
        ? await (promiseUnknown as Promise<unknown>)
        : undefined;
    const pdf =
      typeof pdfUnknown === 'object' && pdfUnknown !== null
        ? (pdfUnknown as Record<string, unknown>)
        : {};
    const numPagesVal = pdf.numPages;
    const numPages: number = isNumber(numPagesVal) ? numPagesVal : 0;
    const getPageFn = pdf.getPage;

    for (let pageIndex = 1; pageIndex <= numPages; pageIndex++) {
      const pageUnknown =
        typeof getPageFn === 'function'
          ? await (getPageFn as (n: number) => unknown)(pageIndex)
          : undefined;
      const page =
        typeof pageUnknown === 'object' && pageUnknown !== null
          ? (pageUnknown as Record<string, unknown>)
          : {};
      const rotateVal = page.rotate;
      const rotate: number = isNumber(rotateVal) ? rotateVal : 0;
      const getViewportFn = page.getViewport;
      const viewportUnknown =
        typeof getViewportFn === 'function'
          ? (
              getViewportFn as (opts: {
                scale: number;
                rotation?: number;
              }) => unknown
            )({
              scale: 1.0,
              rotation: rotate,
            })
          : undefined;
      const viewport =
        typeof viewportUnknown === 'object' && viewportUnknown !== null
          ? (viewportUnknown as Record<string, unknown>)
          : {};
      const txUnknown = viewport.transform;
      const tx: number[] = Array.isArray(txUnknown)
        ? (txUnknown as unknown[]).map((v) => (isNumber(v) ? v : 0))
        : [1, 0, 0, 1, 0, 0];
      const getTextContentFn = page.getTextContent;
      const textContentUnknown =
        typeof getTextContentFn === 'function'
          ? await (getTextContentFn as () => unknown)()
          : undefined;
      const textContent =
        typeof textContentUnknown === 'object' && textContentUnknown !== null
          ? (textContentUnknown as Record<string, unknown>)
          : {};

      const pageBoxes: NonNullable<PageResult['boundingBoxes']> = [];
      const itemsUnknown = textContent.items;
      const items: unknown[] = Array.isArray(itemsUnknown) ? itemsUnknown : [];
      for (const item of items) {
        if (!isTextItem(item)) continue;
        const str: string = typeof item.str === 'string' ? item.str : '';
        const transformRaw = item.transform;
        const transform: number[] = Array.isArray(transformRaw)
          ? (transformRaw as unknown[]).map((v) => (isNumber(v) ? v : 0))
          : [];
        const width: number = isNumber(item.width) ? item.width : 0;
        const height: number = isNumber(item.height) ? item.height : 0;

        if (transform.length === 6) {
          const [, , , , e, f] = transform.map((v) => (isNumber(v) ? v : 0));

          function mapPoint(x: number, y: number): { x: number; y: number } {
            const X = x * tx[0] + y * tx[2] + tx[4];
            const Y = x * tx[1] + y * tx[3] + tx[5];
            return { x: X, y: Y };
          }

          const p1 = mapPoint(e, f);
          const p2 = mapPoint(e + width, f);
          const p3 = mapPoint(e + width, f + height);
          const p4 = mapPoint(e, f + height);

          pageBoxes.push({
            x: Math.min(p1.x, p2.x, p3.x, p4.x),
            y: Math.min(p1.y, p2.y, p3.y, p4.y),
            width:
              Math.max(p1.x, p2.x, p3.x, p4.x) -
              Math.min(p1.x, p2.x, p3.x, p4.x),
            height:
              Math.max(p1.y, p2.y, p3.y, p4.y) -
              Math.min(p1.y, p2.y, p3.y, p4.y),
            text: str,
            confidence: 1,
            polygon: [p1, p2, p3, p4],
            rotation: rotate,
          });
        }
      }

      results.push({ pageNumber: pageIndex, boxes: pageBoxes });
    }

    return results;
  }

  private async extractImageRegionsFromPdf(buffer: Buffer): Promise<
    Array<{
      pageNumber: number;
      viewport: {
        width: number;
        height: number;
        rotation: number;
        transform: number[];
      };
      images: NonNullable<PageResult['boundingBoxes']>;
    }>
  > {
    const results: Array<{
      pageNumber: number;
      viewport: {
        width: number;
        height: number;
        rotation: number;
        transform: number[];
      };
      images: NonNullable<PageResult['boundingBoxes']>;
    }> = [];

    const loadingTaskUnknown: unknown = isFunctionValue(getDocument)
      ? getDocument({ data: buffer })
      : undefined;
    const loadingTask =
      typeof loadingTaskUnknown === 'object' && loadingTaskUnknown !== null
        ? (loadingTaskUnknown as Record<string, unknown>)
        : {};
    const promiseUnknown = loadingTask.promise;
    const pdfUnknown =
      typeof promiseUnknown === 'object' || typeof promiseUnknown === 'function'
        ? await (promiseUnknown as Promise<unknown>)
        : undefined;
    const pdf =
      typeof pdfUnknown === 'object' && pdfUnknown !== null
        ? (pdfUnknown as Record<string, unknown>)
        : {};
    const numPagesVal = pdf.numPages;
    const numPages: number = isNumber(numPagesVal) ? numPagesVal : 0;

    // Matrix helpers
    const mul = (m1: number[], m2: number[]): number[] => [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];

    for (let pageIndex = 1; pageIndex <= numPages; pageIndex++) {
      const getPageFn = pdf.getPage;
      const pageUnknown =
        typeof getPageFn === 'function'
          ? await (getPageFn as (n: number) => unknown)(pageIndex)
          : undefined;
      const page =
        typeof pageUnknown === 'object' && pageUnknown !== null
          ? (pageUnknown as Record<string, unknown>)
          : {};
      const rotateVal = page.rotate;
      const rotate: number = isNumber(rotateVal) ? rotateVal : 0;
      const getViewportFn = page.getViewport;
      const viewportUnknown =
        typeof getViewportFn === 'function'
          ? (
              getViewportFn as (opts: {
                scale: number;
                rotation?: number;
              }) => unknown
            )({
              scale: 1.0,
              rotation: rotate,
            })
          : undefined;
      const viewport =
        typeof viewportUnknown === 'object' && viewportUnknown !== null
          ? (viewportUnknown as Record<string, unknown>)
          : {};
      const txUnknown = viewport.transform;
      const tx: number[] = Array.isArray(txUnknown)
        ? (txUnknown as unknown[]).map((v) => (isNumber(v) ? v : 0))
        : [1, 0, 0, 1, 0, 0];
      const getOperatorListFn = page.getOperatorList;
      const opListUnknown =
        typeof getOperatorListFn === 'function'
          ? await (getOperatorListFn as () => unknown)()
          : undefined;
      const opList =
        typeof opListUnknown === 'object' && opListUnknown !== null
          ? (opListUnknown as Record<string, unknown>)
          : {};
      const fnArrayUnknown: unknown = opList.fnArray;
      const argsArrayUnknown: unknown = opList.argsArray;
      const fnArray: number[] = Array.isArray(fnArrayUnknown)
        ? (fnArrayUnknown as unknown[]).map((v) => (isNumber(v) ? v : -1))
        : [];
      const argsArray: unknown[] = Array.isArray(argsArrayUnknown)
        ? (argsArrayUnknown as unknown[])
        : [];

      const stack: number[][] = [];
      let ctm: number[] = [1, 0, 0, 1, 0, 0];
      const images: NonNullable<PageResult['boundingBoxes']> = [];

      const mapPoint = (
        x: number,
        y: number,
        transform: number[],
      ): { x: number; y: number } => {
        const X = x * transform[0] + y * transform[2] + transform[4];
        const Y = x * transform[1] + y * transform[3] + transform[5];
        return { x: X, y: Y };
      };

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i];
        if (isPdfOps(OPS) && fn === OPS.save) {
          stack.push([...ctm]);
        } else if (isPdfOps(OPS) && fn === OPS.restore) {
          const popped = stack.pop();
          ctm =
            Array.isArray(popped) && popped.length === 6
              ? popped
              : [1, 0, 0, 1, 0, 0];
        } else if (isPdfOps(OPS) && fn === OPS.transform) {
          const a = Array.isArray(args) ? args : [];
          const m: number[] = [
            isNumber(a[0]) ? a[0] : 1,
            isNumber(a[1]) ? a[1] : 0,
            isNumber(a[2]) ? a[2] : 0,
            isNumber(a[3]) ? a[3] : 1,
            isNumber(a[4]) ? a[4] : 0,
            isNumber(a[5]) ? a[5] : 0,
          ];
          ctm = mul(ctm, m);
        } else if (
          isPdfOps(OPS) &&
          (fn === OPS.paintImageXObject ||
            fn === OPS.paintInlineImageXObject ||
            fn === OPS.paintXObject)
        ) {
          // Approximate image quad by transforming unit square by current CTM and then viewport transform
          const dev = mul(tx, ctm);
          const p1 = mapPoint(0, 0, dev);
          const p2 = mapPoint(1, 0, dev);
          const p3 = mapPoint(1, 1, dev);
          const p4 = mapPoint(0, 1, dev);
          images.push({
            x: Math.min(p1.x, p2.x, p3.x, p4.x),
            y: Math.min(p1.y, p2.y, p3.y, p4.y),
            width:
              Math.max(p1.x, p2.x, p3.x, p4.x) -
              Math.min(p1.x, p2.x, p3.x, p4.x),
            height:
              Math.max(p1.y, p2.y, p3.y, p4.y) -
              Math.min(p1.y, p2.y, p3.y, p4.y),
            text: '',
            confidence: 1,
            polygon: [p1, p2, p3, p4],
            rotation: rotate,
          });
        }
      }

      const vpwUnknown = viewport.width;
      const vphUnknown = viewport.height;
      const vpWidth: number = isNumber(vpwUnknown) ? vpwUnknown : 0;
      const vpHeight: number = isNumber(vphUnknown) ? vphUnknown : 0;

      results.push({
        pageNumber: pageIndex,
        viewport: {
          width: vpWidth,
          height: vpHeight,
          rotation: rotate,
          transform: tx,
        },
        images,
      });
    }

    return results;
  }

  private async augmentPagesWithImageOcr(
    buffer: Buffer,
    filename: string,
    options: ProcessorOptions,
    pages: PageResult[],
    imageRegions: Array<{
      pageNumber: number;
      viewport: {
        width: number;
        height: number;
        rotation: number;
        transform: number[];
      };
      images: NonNullable<PageResult['boundingBoxes']>;
    }>,
  ): Promise<void> {
    if (!imageRegions.some((p) => p.images && p.images.length > 0)) return;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-image-ocr-'));
    const tempPdfPath = path.join(
      tempDir,
      `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
    );
    await fs.writeFile(tempPdfPath, buffer);

    const convert = pdf2pic.fromPath(tempPdfPath, {
      density: 200,
      saveFilename: 'page',
      savePath: tempDir,
      format: 'png',
      width: 2000,
      height: 2000,
    });

    const worker = await createWorker();
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO_OSD,
        tessedit_ocr_engine_mode: 2,
      });
      await worker.reinitialize(options.language || 'eng');

      for (const region of imageRegions) {
        if (!region.images || region.images.length === 0) continue;
        const pageNum = region.pageNumber;
        const pagePng = await convert(pageNum, { responseType: 'buffer' });
        if (!pagePng.buffer) continue;
        const pageImg = pagePng.buffer;
        // Map viewport coords to pixels
        const pageMeta = await sharp(pageImg).metadata();
        const pxWidth = pageMeta.width || 2000;
        const pxHeight = pageMeta.height || 2000;
        const scaleX = pxWidth / region.viewport.width;
        const scaleY = pxHeight / region.viewport.height;

        for (const imgBox of region.images) {
          // Skip tiny images
          if (!isNumber(imgBox.width) || !isNumber(imgBox.height)) continue;
          if (imgBox.width < 8 || imgBox.height < 8) continue;

          const left = Math.max(0, Math.floor(imgBox.x * scaleX));
          const top = Math.max(0, Math.floor(imgBox.y * scaleY));
          const width = Math.max(1, Math.floor(imgBox.width * scaleX));
          const height = Math.max(1, Math.floor(imgBox.height * scaleY));

          try {
            const crop = await sharp(pageImg)
              .extract({ left, top, width, height })
              .greyscale()
              .normalize()
              .sharpen()
              .png()
              .toBuffer();

            const ocrRes = await worker.recognize(crop);
            const ocrResUnknown: unknown = ocrRes;
            const dataUnknown: unknown =
              typeof ocrResUnknown === 'object' &&
              ocrResUnknown !== null &&
              'data' in (ocrResUnknown as Record<string, unknown>)
                ? (ocrResUnknown as Record<string, unknown>).data
                : undefined;
            const data: TesseractDataLike =
              typeof dataUnknown === 'object' && dataUnknown !== null
                ? (dataUnknown as TesseractDataLike)
                : {};
            const textStr: string =
              typeof (data as Record<string, unknown>).text === 'string'
                ? ((data as Record<string, unknown>).text as string)
                : '';
            const wordsUnknown: unknown = (data as Record<string, unknown>)
              .words;
            const words: unknown[] = Array.isArray(wordsUnknown)
              ? wordsUnknown
              : [];

            if (textStr.trim()) {
              const pageEntry = pages.find((p) => p.pageNumber === pageNum);
              if (pageEntry) {
                pageEntry.text = `${pageEntry.text}\n${textStr.trim()}`.trim();
                if (!pageEntry.boundingBoxes) pageEntry.boundingBoxes = [];
                const boxes = words
                  .filter(
                    (w): w is TesseractWordLike =>
                      typeof w === 'object' && w !== null,
                  )
                  .map((w) => {
                    const wrec = w as Record<string, unknown>;
                    const wt = wrec.text;
                    if (typeof wt !== 'string' || !wt.trim()) return null;
                    const bb = (wrec.bbox || {}) as Record<string, unknown>;
                    const x0 = typeof bb.x0 === 'number' ? bb.x0 : 0;
                    const y0 = typeof bb.y0 === 'number' ? bb.y0 : 0;
                    const x1 = typeof bb.x1 === 'number' ? bb.x1 : 0;
                    const y1 = typeof bb.y1 === 'number' ? bb.y1 : 0;
                    const worldX0 = left + x0;
                    const worldY0 = top + y0;
                    const worldX1 = left + x1;
                    const worldY1 = top + y1;
                    const polygon = [
                      { x: worldX0, y: worldY0 },
                      { x: worldX1, y: worldY0 },
                      { x: worldX1, y: worldY1 },
                      { x: worldX0, y: worldY1 },
                    ];
                    const wConf =
                      typeof wrec.confidence === 'number'
                        ? wrec.confidence / 100
                        : 1;
                    return {
                      x: Math.min(worldX0, worldX1),
                      y: Math.min(worldY0, worldY1),
                      width: Math.abs(worldX1 - worldX0),
                      height: Math.abs(worldY1 - worldY0),
                      text: wt,
                      confidence: wConf,
                      polygon,
                      rotation: 0,
                    };
                  })
                  .filter((b): b is NonNullable<typeof b> => !!b);
                pageEntry.boundingBoxes.push(...boxes);
              }
            }
          } catch (err) {
            this.logger.warn(
              `Image region OCR failed on page ${pageNum}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    } finally {
      try {
        await worker.terminate();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Worker terminate failed: ${msg}`);
      }
      // temp dir cleanup handled by caller if needed
    }
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
              const ocrRes = await worker.recognize(optimizedImage);
              const ocrResUnknown: unknown = ocrRes;
              const dataUnknown: unknown =
                typeof ocrResUnknown === 'object' &&
                ocrResUnknown !== null &&
                'data' in (ocrResUnknown as Record<string, unknown>)
                  ? (ocrResUnknown as Record<string, unknown>).data
                  : undefined;
              const data: TesseractDataLike =
                typeof dataUnknown === 'object' && dataUnknown !== null
                  ? (dataUnknown as TesseractDataLike)
                  : {};

              const textStr: string =
                typeof (data as Record<string, unknown>).text === 'string'
                  ? ((data as Record<string, unknown>).text as string)
                  : '';
              const confNum: number =
                typeof (data as Record<string, unknown>).confidence === 'number'
                  ? ((data as Record<string, unknown>).confidence as number)
                  : 0;
              if (textStr.trim()) {
                pages.push(
                  this.createPageResult(
                    pageNum,
                    textStr.trim(),
                    confNum / 100,
                    {
                      width: imageMetadata.width || 0,
                      height: imageMetadata.height || 0,
                      processingTime: Date.now() - pageStartTime,
                    },
                  ),
                );
                // Đính kèm bbox từ Tesseract nếu có (words-level)
                try {
                  const lastPage = pages[pages.length - 1];
                  const wordsUnknown: unknown = (
                    data as Record<string, unknown>
                  ).words;
                  const words: unknown[] = Array.isArray(wordsUnknown)
                    ? wordsUnknown
                    : [];
                  if (words.length > 0) {
                    const boxes = words
                      .filter(
                        (w): w is TesseractWordLike =>
                          typeof w === 'object' && w !== null,
                      )
                      .map((w) => {
                        const wrec = w as Record<string, unknown>;
                        const textVal = wrec.text;
                        if (typeof textVal !== 'string' || !textVal.trim())
                          return null;
                        const bb = (wrec.bbox || {}) as Record<string, unknown>;
                        const x0 = typeof bb.x0 === 'number' ? bb.x0 : 0;
                        const y0 = typeof bb.y0 === 'number' ? bb.y0 : 0;
                        const x1 = typeof bb.x1 === 'number' ? bb.x1 : 0;
                        const y1 = typeof bb.y1 === 'number' ? bb.y1 : 0;
                        const x = Math.min(x0, x1);
                        const y = Math.min(y0, y1);
                        const width = Math.abs(x1 - x0);
                        const height = Math.abs(y1 - y0);
                        const polygon = [
                          { x: x0, y: y0 },
                          { x: x1, y: y0 },
                          { x: x1, y: y1 },
                          { x: x0, y: y1 },
                        ];
                        const wConf =
                          typeof wrec.confidence === 'number'
                            ? wrec.confidence / 100
                            : 1;
                        return {
                          x,
                          y,
                          width,
                          height,
                          text: textVal,
                          confidence: wConf,
                          polygon,
                          rotation: 0,
                        };
                      })
                      .filter((b): b is NonNullable<typeof b> => !!b);
                    if (boxes.length > 0) {
                      lastPage.boundingBoxes = boxes;
                    }
                  }
                } catch {
                  // ignore bbox failures for OCR branch
                }
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
