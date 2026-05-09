import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RasterizedPdfPage } from './interfaces/rasterized-pdf-page.interface';

const execFileAsync = promisify(execFile);

@Injectable()
export class PdfRasterizationService {
  private readonly logger = new Logger(PdfRasterizationService.name);

  constructor(private readonly configService: ConfigService) {}

  async rasterizePage(params: {
    documentId?: string;
    pdfBytes: Uint8Array;
    pageNumber: number;
    targetWidth?: number;
    dpi?: number;
  }): Promise<RasterizedPdfPage> {
    const workdir = await mkdtemp(join(tmpdir(), 'doclane-pdf-rasterize-'));
    const inputPath = join(workdir, 'input.pdf');
    const outputPrefix = join(workdir, 'page');
    const outputPath = `${outputPrefix}.png`;

    try {
      this.logger.log(
        `Rasterizing PDF page ${params.pageNumber} at ${
          params.dpi ? `${params.dpi} DPI` : `width ${params.targetWidth}`
        }${params.documentId ? ` for document ${params.documentId}` : ''}`,
      );
      await writeFile(inputPath, params.pdfBytes);
      const sizeArgs = params.dpi
        ? ['-r', params.dpi.toString()]
        : [
            '-scale-to-x',
            (params.targetWidth ?? 1800).toString(),
            '-scale-to-y',
            '-1',
          ];
      await execFileAsync(
        this.configService.getOrThrow<string>(
          'pdfProcessing.rasterization.pdftoppmPath',
        ),
        [
          '-f',
          params.pageNumber.toString(),
          '-l',
          params.pageNumber.toString(),
          ...sizeArgs,
          '-png',
          '-singlefile',
          inputPath,
          outputPrefix,
        ],
        {
          maxBuffer: 1024 * 1024 * 10,
        },
      );

      const bytes = await readFile(outputPath);
      const dimensions = this.readPngDimensions(bytes);

      this.logger.log(
        `Rasterized PDF page ${params.pageNumber} (${dimensions.width}x${dimensions.height}, ${bytes.byteLength} bytes)${
          params.documentId ? ` for document ${params.documentId}` : ''
        }`,
      );

      return {
        pageNumber: params.pageNumber,
        ...dimensions,
        contentType: 'image/png',
        bytes,
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  private readPngDimensions(bytes: Uint8Array): {
    width: number;
    height: number;
  } {
    if (
      bytes.length < 24 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47
    ) {
      throw new Error('Rasterized page is not a valid PNG.');
    }

    return {
      width: this.readUInt32BE(bytes, 16),
      height: this.readUInt32BE(bytes, 20),
    };
  }

  private readUInt32BE(bytes: Uint8Array, offset: number): number {
    return (
      bytes[offset] * 2 ** 24 +
      bytes[offset + 1] * 2 ** 16 +
      bytes[offset + 2] * 2 ** 8 +
      bytes[offset + 3]
    );
  }
}
