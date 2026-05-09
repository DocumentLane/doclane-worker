import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { PdfLinearizationService } from '../pdf-linearization/pdf-linearization.service';
import { S3Service } from '../s3/s3.service';
import { PdfOcrJobPayload } from './interfaces/pdf-ocr-job-payload.interface';
import {
  PdfOcrResultPayload,
  PdfOcrResultPdf,
} from './interfaces/pdf-ocr-result-payload.interface';
import { PdfOcrService } from './pdf-ocr.service';

@Injectable()
@Processor('pdf-ocr')
export class PdfOcrProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfOcrProcessor.name);

  constructor(
    @InjectQueue('pdf-ocr-result')
    private readonly resultQueue: Queue<PdfOcrResultPayload>,
    private readonly s3Service: S3Service,
    private readonly pdfLinearizationService: PdfLinearizationService,
    private readonly pdfOcrService: PdfOcrService,
  ) {
    super();
  }

  async process(job: Job<PdfOcrJobPayload>): Promise<void> {
    this.logger.log(
      `Received pdf OCR job ${job.id} for document ${job.data.documentId}`,
    );
    await job.updateProgress(0);

    try {
      const pdfBytes = await this.s3Service.getObjectBytes(
        job.data.storageBucket,
        job.data.objectKey,
      );
      await job.updateProgress(20);

      const recognized = await this.pdfOcrService.recognize(pdfBytes, {
        documentId: job.data.documentId,
        language: job.data.language,
        ocrOptions: job.data.ocrOptions,
        pages: job.data.pages,
        onPageComplete: async ({ completed, total, pageNumber }) => {
          const progressPercent = this.createProgress(20, 70, completed, total);

          await job.updateProgress(progressPercent);
          await this.resultQueue.add(
            'ocr-progress',
            {
              jobId: job.id?.toString() ?? job.data.documentId,
              documentId: job.data.documentId,
              status: 'progress',
              currentPageNumber: pageNumber,
              completedPages: completed,
              totalPages: total,
              progressPercent,
            },
            this.createProgressJobOptions(job, completed),
          );
        },
      });
      await job.updateProgress(90);

      const ocrPdf = recognized.ocrPdfBytes
        ? await this.uploadOcrPdf(job, recognized.ocrPdfBytes)
        : undefined;

      await this.resultQueue.add(
        'ocr-completed',
        {
          jobId: job.id?.toString() ?? job.data.documentId,
          documentId: job.data.documentId,
          status: 'completed',
          pages: recognized.pages,
          ocrPdf,
        },
        this.createResultJobOptions(job),
      );
      await job.updateProgress(100);
      return;
    } catch (error) {
      const errorMessage = this.createErrorMessage(error);

      this.logger.error(errorMessage, error);
      await this.resultQueue.add(
        'ocr-failed',
        {
          jobId: job.id?.toString() ?? job.data.documentId,
          documentId: job.data.documentId,
          status: 'failed',
          errorCode: 'PDF_OCR_FAILED',
          errorMessage,
        },
        this.createResultJobOptions(job),
      );
    }
  }

  private createResultJobOptions(job: Job<PdfOcrJobPayload>) {
    return {
      jobId: `${job.id?.toString() ?? job.data.documentId}-result`,
      removeOnComplete: false,
      removeOnFail: false,
    };
  }

  private createProgressJobOptions(
    job: Job<PdfOcrJobPayload>,
    completedPages: number,
  ) {
    return {
      jobId: `${job.id?.toString() ?? job.data.documentId}-progress-${completedPages}`,
      removeOnComplete: true,
      removeOnFail: true,
    };
  }

  private async uploadOcrPdf(
    job: Job<PdfOcrJobPayload>,
    bytes: Uint8Array,
  ): Promise<PdfOcrResultPdf> {
    const objectKey = this.createOcrObjectKey(job);
    const linearizationResult =
      await this.pdfLinearizationService.linearize(bytes);
    const uploadBytes = linearizationResult.bytes;
    const checksumSha256 = createHash('sha256')
      .update(uploadBytes)
      .digest('hex');

    this.logger.log(
      `Uploading OCR PDF for document ${job.data.documentId} to ${objectKey} (${uploadBytes.byteLength} bytes)`,
    );
    await this.s3Service.putObjectBytes({
      bucket: job.data.storageBucket,
      key: objectKey,
      body: uploadBytes,
      contentType: 'application/pdf',
    });

    return {
      objectKey,
      sizeBytes: uploadBytes.byteLength,
      checksumSha256,
      contentType: 'application/pdf',
      linearized: linearizationResult.linearized,
    };
  }

  private createOcrObjectKey(job: Job<PdfOcrJobPayload>): string {
    const jobId = job.id?.toString() ?? job.data.documentId;

    return `documents/${job.data.documentId}/ocr/${jobId}.pdf`;
  }

  private createErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return `PDF OCR failed. ${error.message}`;
    }

    return 'PDF OCR failed.';
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
