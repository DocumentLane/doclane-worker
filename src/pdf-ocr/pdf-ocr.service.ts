import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PdfRasterizationService } from '../pdf-rasterization/pdf-rasterization.service';
import {
  PdfOcrJobOptions,
  PdfOcrJobPage,
} from './interfaces/pdf-ocr-job-payload.interface';
import { RecognizedPdfDocument } from './interfaces/recognized-pdf-document.interface';

const execFileAsync = promisify(execFile);

interface RecognizedWord {
  blockNumber: string;
  paragraphNumber: string;
  lineNumber: string;
  text: string;
  confidence: number;
}

@Injectable()
export class PdfOcrService {
  private readonly logger = new Logger(PdfOcrService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly pdfRasterizationService: PdfRasterizationService,
  ) {}

  async recognize(
    pdfBytes: Uint8Array,
    options: {
      documentId?: string;
      language?: string;
      ocrOptions?: Partial<PdfOcrJobOptions>;
      pages: PdfOcrJobPage[];
      onPageComplete?: (params: {
        completed: number;
        total: number;
        pageNumber: number;
      }) => Promise<void>;
    },
  ): Promise<RecognizedPdfDocument> {
    if (!this.configService.getOrThrow<boolean>('pdfProcessing.ocr.enabled')) {
      throw new Error('PDF OCR is disabled.');
    }

    const language =
      options.ocrOptions?.language ??
      options.language ??
      this.configService.getOrThrow<string>('pdfProcessing.ocr.language');
    const targetWidth = this.configService.getOrThrow<number>(
      'pdfProcessing.ocr.targetWidth',
    );
    const dpi =
      options.ocrOptions?.dpi ??
      this.configService.getOrThrow<number>('pdfProcessing.ocr.dpi');
    const psm =
      options.ocrOptions?.psm ??
      this.configService.getOrThrow<number>('pdfProcessing.ocr.psm');
    const pdfOutputEnabled =
      options.ocrOptions?.pdfOutputEnabled ??
      this.configService.getOrThrow<boolean>(
        'pdfProcessing.ocr.pdfOutputEnabled',
      );
    const workdir = await mkdtemp(join(tmpdir(), 'doclane-pdf-ocr-'));

    try {
      const recognizedPages: RecognizedPdfDocument['pages'] = [];
      let completed = 0;

      for (const page of options.pages) {
        this.logger.log(
          `OCR rasterizing page ${page.pageNumber} (${completed + 1}/${options.pages.length})${
            options.documentId ? ` for document ${options.documentId}` : ''
          }`,
        );
        const imagePath = join(
          workdir,
          `page-${page.pageNumber.toString().padStart(4, '0')}.png`,
        );
        const rasterizedPage = await this.pdfRasterizationService.rasterizePage(
          {
            documentId: options.documentId,
            pdfBytes,
            pageNumber: page.pageNumber,
            dpi,
            targetWidth,
          },
        );

        await writeFile(imagePath, rasterizedPage.bytes);
        this.logger.log(
          `OCR recognizing page ${page.pageNumber} (${completed + 1}/${options.pages.length})${
            options.documentId ? ` for document ${options.documentId}` : ''
          }`,
        );
        const recognized = await this.recognizeImage(
          imagePath,
          language,
          dpi,
          psm,
        );

        recognizedPages.push({
          pageNumber: page.pageNumber,
          language,
          ...recognized,
        });
        completed += 1;
        this.logger.log(
          `OCR recognized page ${page.pageNumber} (${completed}/${options.pages.length}, ${recognized.text.length} chars${
            recognized.confidence === undefined
              ? ''
              : `, confidence ${recognized.confidence}`
          })${options.documentId ? ` for document ${options.documentId}` : ''}`,
        );
        await options.onPageComplete?.({
          completed,
          total: options.pages.length,
          pageNumber: page.pageNumber,
        });
      }

      const ocrPdfBytes = pdfOutputEnabled
        ? await this.createSearchablePdf({
            pdfBytes,
            pages: options.pages,
            workdir,
            language,
            psm,
            documentId: options.documentId,
          })
        : undefined;

      return {
        pages: recognizedPages,
        ocrPdfBytes,
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  private async recognizeImage(
    imagePath: string,
    language: string,
    dpi: number,
    psm: number,
  ): Promise<{ text: string; confidence?: number }> {
    const tesseractPath = this.configService.getOrThrow<string>(
      'pdfProcessing.ocr.tesseractPath',
    );
    const imageDir = dirname(imagePath);
    const imageName = basename(imagePath);
    const { stdout } = await execFileAsync(
      tesseractPath,
      [
        imageName,
        'stdout',
        '-l',
        language,
        '--dpi',
        dpi.toString(),
        '--psm',
        psm.toString(),
        'tsv',
      ],
      {
        cwd: imageDir,
        maxBuffer: 1024 * 1024 * 10,
      },
    );

    return this.parseTsv(stdout);
  }

  private async createSearchablePdf(params: {
    pdfBytes: Uint8Array;
    pages: PdfOcrJobPage[];
    workdir: string;
    language: string;
    psm: number;
    documentId?: string;
  }): Promise<Uint8Array> {
    const ocrmypdfPath = this.configService.getOrThrow<string>(
      'pdfProcessing.ocr.ocrmypdfPath',
    );
    const inputPath = join(params.workdir, 'input.pdf');
    const outputPath = join(params.workdir, 'ocr-output.pdf');
    const args = [
      '--skip-text',
      '--language',
      params.language,
      '--tesseract-pagesegmode',
      params.psm.toString(),
      '--output-type',
      'pdf',
      '--pages',
      this.createOcrmypdfPageRange(params.pages),
      inputPath,
      outputPath,
    ];

    this.logger.log(
      `Generating searchable OCR PDF with ocrmypdf for ${params.pages.length} page(s)${
        params.documentId ? ` for document ${params.documentId}` : ''
      }`,
    );
    await writeFile(inputPath, params.pdfBytes);
    await execFileAsync(ocrmypdfPath, args, {
      maxBuffer: 1024 * 1024 * 10,
    });

    return readFile(outputPath);
  }

  private createOcrmypdfPageRange(pages: PdfOcrJobPage[]): string {
    const pageNumbers = [
      ...new Set(pages.map((page) => page.pageNumber).sort((a, b) => a - b)),
    ];

    if (pageNumbers.length === 0) {
      throw new Error('Cannot create OCR PDF without pages.');
    }

    const ranges: string[] = [];
    let rangeStart = pageNumbers[0];
    let previous = pageNumbers[0];

    for (const pageNumber of pageNumbers.slice(1)) {
      if (pageNumber === previous + 1) {
        previous = pageNumber;
        continue;
      }

      ranges.push(this.formatPageRange(rangeStart, previous));
      rangeStart = pageNumber;
      previous = pageNumber;
    }

    ranges.push(this.formatPageRange(rangeStart, previous));

    return ranges.join(',');
  }

  private formatPageRange(start: number, end: number): string {
    return start === end ? start.toString() : `${start}-${end}`;
  }

  private parseTsv(tsv: string): { text: string; confidence?: number } {
    const [, ...rows] = tsv.trim().split(/\r?\n/);
    const words = rows
      .map((row) => this.parseWord(row))
      .filter((word): word is RecognizedWord => word !== undefined);

    if (words.length === 0) {
      return { text: '' };
    }

    const lines: string[] = [];
    let previousLineKey = '';

    for (const word of words) {
      const lineKey = [
        word.blockNumber,
        word.paragraphNumber,
        word.lineNumber,
      ].join(':');

      if (lineKey !== previousLineKey) {
        lines.push(word.text);
        previousLineKey = lineKey;
        continue;
      }

      lines[lines.length - 1] = `${lines[lines.length - 1]} ${word.text}`;
    }

    const confidence =
      words.reduce((sum, word) => sum + word.confidence, 0) / words.length;

    return {
      text: lines.join('\n'),
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  private parseWord(row: string): RecognizedWord | undefined {
    const columns = row.split('\t');
    const confidence = Number(columns[10]);
    const text = columns.slice(11).join('\t').trim();

    if (!text || Number.isNaN(confidence) || confidence < 0) {
      return undefined;
    }

    return {
      blockNumber: columns[2],
      paragraphNumber: columns[3],
      lineNumber: columns[4],
      confidence,
      text,
    };
  }
}
