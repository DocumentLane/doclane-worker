import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PdfLinearizationResult } from '../pdf-linearization/interfaces/pdf-linearization-result.interface';
import { PdfLinearizationService } from '../pdf-linearization/pdf-linearization.service';
import { PdfRasterizationService } from '../pdf-rasterization/pdf-rasterization.service';
import { S3Service } from '../s3/s3.service';
import { PdfMetadataJobPayload } from './interfaces/pdf-metadata-job-payload.interface';
import {
  PdfMetadataLinearizationResult,
  PdfMetadataPreviewResult,
  PdfMetadataResultPayload,
} from './interfaces/pdf-metadata-result-payload.interface';
import { PdfMetadataService } from './pdf-metadata.service';

@Injectable()
@Processor('pdf-metadata')
export class PdfMetadataProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfMetadataProcessor.name);

  constructor(
    @InjectQueue('pdf-metadata-result')
    private readonly resultQueue: Queue<PdfMetadataResultPayload>,
    private readonly s3Service: S3Service,
    private readonly pdfLinearizationService: PdfLinearizationService,
    private readonly pdfRasterizationService: PdfRasterizationService,
    private readonly pdfMetadataService: PdfMetadataService,
  ) {
    super();
  }

  async process(job: Job<PdfMetadataJobPayload>): Promise<void> {
    this.logger.log(
      `Received pdf metadata job ${job.id} for document ${job.data.documentId}`,
    );
    await job.updateProgress(0);

    try {
      const pdfBytes = await this.s3Service.getObjectBytes(
        job.data.storageBucket,
        job.data.objectKey,
      );
      await job.updateProgress(20);

      const linearizationResult = await this.tryLinearize(pdfBytes);
      await job.updateProgress(40);

      let linearization: PdfMetadataLinearizationResult;
      if (linearizationResult.linearized) {
        const objectKey = this.createLinearizedObjectKey(job.data.documentId);

        await this.s3Service.putObjectBytes({
          bucket: job.data.storageBucket,
          key: objectKey,
          body: linearizationResult.bytes,
          contentType: 'application/pdf',
        });
        linearization = {
          status: 'READY',
          objectKey,
          sizeBytes: linearizationResult.sizeBytes,
        };
      } else {
        linearization = {
          status: 'UNAVAILABLE',
          errorMessage: linearizationResult.errorMessage,
        };
      }
      await job.updateProgress(50);

      const metadata = await this.pdfMetadataService.extract(
        linearizationResult.bytes,
        {
          documentId: job.data.documentId,
          onPageComplete: async ({ pageNumber, pageCount }) => {
            const progressPercent = this.createProgress(
              50,
              40,
              pageNumber,
              pageCount,
            );

            await job.updateProgress(progressPercent);
            await this.resultQueue.add(
              'metadata-progress',
              {
                jobId: job.id?.toString() ?? job.data.documentId,
                documentId: job.data.documentId,
                status: 'progress',
                currentPageNumber: pageNumber,
                completedPages: pageNumber,
                totalPages: pageCount,
                progressPercent,
              },
              this.createProgressJobOptions(job, pageNumber),
            );
          },
        },
      );
      await job.updateProgress(90);

      const preview =
        metadata.pageCount > 0
          ? await this.createPreview(job, linearizationResult.bytes)
          : undefined;
      await job.updateProgress(95);
      await job.updateProgress(100);

      await this.resultQueue.add(
        'metadata-completed',
        {
          jobId: job.id?.toString() ?? job.data.documentId,
          documentId: job.data.documentId,
          status: 'completed',
          progressPercent: 100,
          pageCount: metadata.pageCount,
          hasTextLayer: metadata.hasTextLayer,
          pages: metadata.pages,
          linearization,
          preview,
        },
        this.createResultJobOptions(job),
      );
      return;
    } catch (error) {
      const errorMessage = this.createErrorMessage(error);

      this.logger.error(errorMessage, error);
      await this.resultQueue.add(
        'metadata-failed',
        {
          jobId: job.id?.toString() ?? job.data.documentId,
          documentId: job.data.documentId,
          status: 'failed',
          errorCode: 'PDF_METADATA_FAILED',
          errorMessage,
        },
        this.createResultJobOptions(job),
      );
    }
  }

  private createResultJobOptions(job: Job<PdfMetadataJobPayload>) {
    return {
      jobId: `${job.id?.toString() ?? job.data.documentId}-result`,
      removeOnComplete: false,
      removeOnFail: false,
    };
  }

  private createProgressJobOptions(
    job: Job<PdfMetadataJobPayload>,
    completedPages: number,
  ) {
    return {
      jobId: `${job.id?.toString() ?? job.data.documentId}-progress-${completedPages}`,
      removeOnComplete: true,
      removeOnFail: true,
    };
  }

  private createErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return `PDF metadata extraction failed. ${error.message}`;
    }

    return 'PDF metadata extraction failed.';
  }

  private async tryLinearize(
    pdfBytes: Uint8Array,
  ): Promise<PdfLinearizationResult> {
    try {
      return await this.pdfLinearizationService.linearize(pdfBytes);
    } catch (error) {
      const errorMessage = this.createLinearizationErrorMessage(error);

      this.logger.warn(`PDF linearization unavailable. ${errorMessage}`);

      return {
        bytes: pdfBytes,
        linearized: false,
        errorMessage,
        sizeBytes: pdfBytes.byteLength,
      };
    }
  }

  private createLinearizationErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown linearization error.';
  }

  private async createPreview(
    job: Job<PdfMetadataJobPayload>,
    pdfBytes: Uint8Array,
  ): Promise<PdfMetadataPreviewResult | undefined> {
    try {
      const pageNumber = 1;
      const preview = await this.pdfRasterizationService.rasterizePage({
        documentId: job.data.documentId,
        pdfBytes,
        pageNumber,
        targetWidth: 640,
      });
      const objectKey = this.createPreviewObjectKey(
        job.data.documentId,
        pageNumber,
      );

      await this.s3Service.putObjectBytes({
        bucket: job.data.storageBucket,
        key: objectKey,
        body: preview.bytes,
        contentType: preview.contentType,
      });
      this.logger.log(
        `Generated pdf preview for document ${job.data.documentId} page ${pageNumber} (${preview.width}x${preview.height}, ${preview.bytes.byteLength} bytes)`,
      );

      return {
        pageNumber,
        storageBucket: job.data.storageBucket,
        objectKey,
        contentType: preview.contentType,
        width: preview.width,
        height: preview.height,
        sizeBytes: preview.bytes.byteLength,
      };
    } catch (error) {
      this.logger.warn(
        `PDF preview generation skipped for document ${job.data.documentId}. ${this.describeError(error)}`,
      );

      return undefined;
    }
  }

  private createPreviewObjectKey(
    documentId: string,
    pageNumber: number,
  ): string {
    return `documents/${documentId}/previews/page-${pageNumber
      .toString()
      .padStart(4, '0')}.png`;
  }

  private createLinearizedObjectKey(documentId: string): string {
    return `documents/${documentId}/linearized.pdf`;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown error.';
  }

  private createProgress(
    base: number,
    span: number,
    completed: number,
    total: number,
  ): number {
    return Math.min(99, Math.round(base + (span * completed) / total));
  }
}
