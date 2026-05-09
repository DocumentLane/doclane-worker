import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExtractedPdfMetadata } from './interfaces/extracted-pdf-metadata.interface';
import { PdfMetadataPageResult } from './interfaces/pdf-metadata-result-payload.interface';

const execFileAsync = promisify(execFile);

@Injectable()
export class PdfMetadataService {
  private readonly logger = new Logger(PdfMetadataService.name);

  constructor(private readonly configService: ConfigService) {}

  async extract(
    pdfBytes: Uint8Array,
    options?: {
      documentId?: string;
      onPageComplete?: (params: {
        pageNumber: number;
        pageCount: number;
      }) => Promise<void>;
    },
  ): Promise<ExtractedPdfMetadata> {
    const workdir = await mkdtemp(join(tmpdir(), 'doclane-pdf-metadata-'));
    const inputPath = join(workdir, 'input.pdf');

    try {
      await writeFile(inputPath, pdfBytes);

      const pageCount = await this.readPageCount(inputPath);
      this.logger.log(
        `Read PDF metadata page count ${pageCount}${
          options?.documentId ? ` for document ${options.documentId}` : ''
        }`,
      );
      const pages = await this.readPages(inputPath, pageCount);

      for (const page of pages) {
        page.hasTextLayer = await this.hasPageTextLayer(
          inputPath,
          page.pageNumber,
        );
        this.logger.log(
          `Read PDF page ${page.pageNumber}/${pageCount} metadata (${page.width}x${page.height}, rotation ${page.rotation}, textLayer ${page.hasTextLayer})${
            options?.documentId ? ` for document ${options.documentId}` : ''
          }`,
        );
        await options?.onPageComplete?.({
          pageNumber: page.pageNumber,
          pageCount,
        });
      }

      return {
        pageCount,
        hasTextLayer: pages.some((page) => page.hasTextLayer),
        pages,
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  private async readPageCount(inputPath: string): Promise<number> {
    const { stdout } = await execFileAsync(
      this.configService.getOrThrow<string>(
        'pdfProcessing.metadata.pdfinfoPath',
      ),
      [inputPath],
    );
    const match = /^Pages:\s+(\d+)$/m.exec(stdout);

    if (!match) {
      throw new Error('Unable to read PDF page count.');
    }

    return Number(match[1]);
  }

  private async readPages(
    inputPath: string,
    pageCount: number,
  ): Promise<PdfMetadataPageResult[]> {
    const { stdout } = await execFileAsync(
      this.configService.getOrThrow<string>(
        'pdfProcessing.metadata.pdfinfoPath',
      ),
      ['-box', '-f', '1', '-l', pageCount.toString(), inputPath],
    );
    const pages: PdfMetadataPageResult[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      pages.push({
        pageNumber,
        ...this.readPageGeometry(stdout, pageNumber),
        hasTextLayer: false,
      });
    }

    return pages;
  }

  private readPageGeometry(
    pdfInfoOutput: string,
    pageNumber: number,
  ): { width: number; height: number; rotation: number } {
    const sizeMatch = new RegExp(
      `^Page\\s+${pageNumber}\\s+size:\\s+([\\d.]+)\\s+x\\s+([\\d.]+)\\s+pts`,
      'm',
    ).exec(pdfInfoOutput);
    const rotationMatch = new RegExp(
      `^Page\\s+${pageNumber}\\s+rot:\\s+(\\d+)`,
      'm',
    ).exec(pdfInfoOutput);

    if (!sizeMatch) {
      throw new Error(`Unable to read PDF page ${pageNumber} size.`);
    }

    return {
      width: Number(sizeMatch[1]),
      height: Number(sizeMatch[2]),
      rotation: rotationMatch ? Number(rotationMatch[1]) : 0,
    };
  }

  private async hasPageTextLayer(
    inputPath: string,
    pageNumber: number,
  ): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        this.configService.getOrThrow<string>(
          'pdfProcessing.metadata.pdftotextPath',
        ),
        [
          '-f',
          pageNumber.toString(),
          '-l',
          pageNumber.toString(),
          inputPath,
          '-',
        ],
        {
          maxBuffer: 1024 * 1024 * 10,
        },
      );

      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
}
