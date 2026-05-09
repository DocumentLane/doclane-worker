import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PdfLinearizationService } from './pdf-linearization/pdf-linearization.service';
import { PdfMetadataProcessor } from './pdf-metadata/pdf-metadata.processor';
import { PdfMetadataService } from './pdf-metadata/pdf-metadata.service';
import { PdfRasterizationService } from './pdf-rasterization/pdf-rasterization.service';
import { PdfOcrJobPage } from './pdf-ocr/interfaces/pdf-ocr-job-payload.interface';
import { PdfOcrProcessor } from './pdf-ocr/pdf-ocr.processor';
import { PdfOcrService } from './pdf-ocr/pdf-ocr.service';
import { S3Service } from './s3/s3.service';

describe('PdfMetadataProcessor', () => {
  let processor: PdfMetadataProcessor;
  let resultQueue: { add: jest.Mock };
  let s3Service: { getObjectBytes: jest.Mock; putObjectBytes: jest.Mock };
  let pdfLinearizationService: { linearize: jest.Mock };
  let pdfRasterizationService: { rasterizePage: jest.Mock };
  let pdfMetadataService: { extract: jest.Mock };

  beforeEach(async () => {
    resultQueue = {
      add: jest.fn(),
    };
    s3Service = {
      getObjectBytes: jest.fn(),
      putObjectBytes: jest.fn(),
    };
    pdfLinearizationService = {
      linearize: jest.fn(),
    };
    pdfRasterizationService = {
      rasterizePage: jest.fn(),
    };
    pdfMetadataService = {
      extract: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      providers: [
        PdfMetadataProcessor,
        {
          provide: getQueueToken('pdf-metadata-result'),
          useValue: resultQueue,
        },
        {
          provide: S3Service,
          useValue: s3Service,
        },
        {
          provide: PdfLinearizationService,
          useValue: pdfLinearizationService,
        },
        {
          provide: PdfRasterizationService,
          useValue: pdfRasterizationService,
        },
        {
          provide: PdfMetadataService,
          useValue: pdfMetadataService,
        },
      ],
    }).compile();

    processor = app.get<PdfMetadataProcessor>(PdfMetadataProcessor);
  });

  describe('process', () => {
    it('is defined', () => {
      expect(processor).toBeDefined();
    });

    it('publishes metadata progress while pages are extracted', async () => {
      const pdfBytes = Buffer.from('%PDF original');
      const linearizedBytes = Buffer.from('%PDF linearized');

      s3Service.getObjectBytes.mockResolvedValue(pdfBytes);
      pdfLinearizationService.linearize.mockResolvedValue({
        bytes: linearizedBytes,
        linearized: true,
        sizeBytes: linearizedBytes.byteLength,
      });
      pdfRasterizationService.rasterizePage.mockResolvedValue({
        pageNumber: 1,
        width: 640,
        height: 900,
        contentType: 'image/png',
        bytes: Buffer.from('preview-png'),
      });
      pdfMetadataService.extract.mockImplementation(
        async (
          _pdfBytes: Uint8Array,
          options: {
            onPageComplete: (params: {
              pageNumber: number;
              pageCount: number;
            }) => Promise<void>;
          },
        ) => {
          await options.onPageComplete({
            pageNumber: 1,
            pageCount: 2,
          });

          return {
            pageCount: 2,
            hasTextLayer: true,
            pages: [
              {
                pageNumber: 1,
                width: 100,
                height: 100,
                rotation: 0,
                hasTextLayer: true,
              },
              {
                pageNumber: 2,
                width: 100,
                height: 100,
                rotation: 0,
                hasTextLayer: false,
              },
            ],
          };
        },
      );

      await processor.process({
        id: 'job-1',
        data: {
          documentId: 'document-1',
          objectKey: 'documents/user-1/document-1/original.pdf',
          storageBucket: 'documents',
        },
        updateProgress: jest.fn(),
      } as never);

      expect(resultQueue.add).toHaveBeenCalledWith(
        'metadata-progress',
        {
          jobId: 'job-1',
          documentId: 'document-1',
          status: 'progress',
          currentPageNumber: 1,
          completedPages: 1,
          totalPages: 2,
          progressPercent: 70,
        },
        {
          jobId: 'job-1-progress-1',
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      expect(resultQueue.add).toHaveBeenCalledWith(
        'metadata-completed',
        {
          jobId: 'job-1',
          documentId: 'document-1',
          status: 'completed',
          pageCount: 2,
          hasTextLayer: true,
          pages: [
            {
              pageNumber: 1,
              width: 100,
              height: 100,
              rotation: 0,
              hasTextLayer: true,
            },
            {
              pageNumber: 2,
              width: 100,
              height: 100,
              rotation: 0,
              hasTextLayer: false,
            },
          ],
          linearization: {
            status: 'READY',
            objectKey: 'documents/document-1/linearized.pdf',
            sizeBytes: linearizedBytes.byteLength,
          },
          preview: {
            pageNumber: 1,
            storageBucket: 'documents',
            objectKey: 'documents/document-1/previews/page-0001.png',
            contentType: 'image/png',
            width: 640,
            height: 900,
            sizeBytes: Buffer.from('preview-png').byteLength,
          },
        },
        {
          jobId: 'job-1-result',
          removeOnComplete: false,
          removeOnFail: false,
        },
      );
      expect(pdfRasterizationService.rasterizePage).toHaveBeenCalledWith({
        documentId: 'document-1',
        pdfBytes: linearizedBytes,
        pageNumber: 1,
        targetWidth: 640,
      });
      expect(s3Service.putObjectBytes).toHaveBeenCalledWith({
        bucket: 'documents',
        key: 'documents/document-1/linearized.pdf',
        body: linearizedBytes,
        contentType: 'application/pdf',
      });
      expect(s3Service.putObjectBytes).toHaveBeenCalledWith({
        bucket: 'documents',
        key: 'documents/document-1/previews/page-0001.png',
        body: Buffer.from('preview-png'),
        contentType: 'image/png',
      });
    });
  });
});

describe('PdfOcrProcessor', () => {
  let processor: PdfOcrProcessor;
  let resultQueue: { add: jest.Mock };
  let s3Service: { getObjectBytes: jest.Mock; putObjectBytes: jest.Mock };
  let pdfLinearizationService: { linearize: jest.Mock };
  let pdfOcrService: { recognize: jest.Mock };

  beforeEach(async () => {
    resultQueue = {
      add: jest.fn(),
    };
    s3Service = {
      getObjectBytes: jest.fn(),
      putObjectBytes: jest.fn(),
    };
    pdfLinearizationService = {
      linearize: jest.fn(),
    };
    pdfOcrService = {
      recognize: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      providers: [
        PdfOcrProcessor,
        {
          provide: getQueueToken('pdf-ocr-result'),
          useValue: resultQueue,
        },
        {
          provide: S3Service,
          useValue: s3Service,
        },
        {
          provide: PdfLinearizationService,
          useValue: pdfLinearizationService,
        },
        {
          provide: PdfOcrService,
          useValue: pdfOcrService,
        },
      ],
    }).compile();

    processor = app.get<PdfOcrProcessor>(PdfOcrProcessor);
  });

  describe('process', () => {
    it('is defined', () => {
      expect(processor).toBeDefined();
    });

    it('uploads OCR PDF and includes its metadata in the result payload', async () => {
      const pdfBytes = Buffer.from('%PDF original');
      const ocrPdfBytes = Buffer.from('%PDF ocr');
      const linearizedOcrPdfBytes = Buffer.from('%PDF ocr linearized');
      s3Service.getObjectBytes.mockResolvedValue(pdfBytes);
      pdfLinearizationService.linearize.mockResolvedValue({
        bytes: linearizedOcrPdfBytes,
        linearized: true,
        sizeBytes: linearizedOcrPdfBytes.byteLength,
      });
      pdfOcrService.recognize.mockImplementation(
        async (
          _pdfBytes: Uint8Array,
          options: {
            onPageComplete: (params: {
              completed: number;
              total: number;
              pageNumber: number;
            }) => Promise<void>;
            pages: PdfOcrJobPage[];
          },
        ) => {
          await options.onPageComplete({
            completed: 1,
            total: 1,
            pageNumber: 1,
          });

          return {
            pages: [
              {
                pageNumber: 1,
                text: 'Recognized text',
                language: 'eng',
                confidence: 99,
              },
            ],
            ocrPdfBytes,
          };
        },
      );

      await processor.process({
        id: 'job-1',
        data: {
          documentId: 'document-1',
          objectKey: 'documents/user-1/document-1/original.pdf',
          storageBucket: 'documents',
          ocrOptions: {
            language: 'kor',
            dpi: 300,
            psm: 6,
            pdfOutputEnabled: true,
          },
          pages: [
            {
              pageNumber: 1,
              width: 100,
              height: 100,
              rotation: 0,
            },
          ],
        },
        updateProgress: jest.fn(),
      } as never);

      expect(pdfOcrService.recognize).toHaveBeenCalledWith(pdfBytes, {
        documentId: 'document-1',
        language: undefined,
        ocrOptions: {
          language: 'kor',
          dpi: 300,
          psm: 6,
          pdfOutputEnabled: true,
        },
        pages: [
          {
            pageNumber: 1,
            width: 100,
            height: 100,
            rotation: 0,
          },
        ],
        onPageComplete: expect.any(Function) as (
          params: unknown,
        ) => Promise<void>,
      });
      expect(s3Service.putObjectBytes).toHaveBeenCalledWith({
        bucket: 'documents',
        key: 'documents/document-1/ocr/job-1.pdf',
        body: linearizedOcrPdfBytes,
        contentType: 'application/pdf',
      });
      expect(resultQueue.add).toHaveBeenCalledWith(
        'ocr-progress',
        {
          jobId: 'job-1',
          documentId: 'document-1',
          status: 'progress',
          currentPageNumber: 1,
          completedPages: 1,
          totalPages: 1,
          progressPercent: 90,
        },
        {
          jobId: 'job-1-progress-1',
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      expect(resultQueue.add).toHaveBeenCalledWith(
        'ocr-completed',
        {
          jobId: 'job-1',
          documentId: 'document-1',
          status: 'completed',
          pages: [
            {
              pageNumber: 1,
              text: 'Recognized text',
              language: 'eng',
              confidence: 99,
            },
          ],
          ocrPdf: {
            objectKey: 'documents/document-1/ocr/job-1.pdf',
            sizeBytes: linearizedOcrPdfBytes.byteLength,
            checksumSha256:
              'e03060ccbd1e3a1380f8eff91e30496ac01d831d7c16c45e64720d100d1fd7f9',
            contentType: 'application/pdf',
            linearized: true,
          },
        },
        {
          jobId: 'job-1-result',
          removeOnComplete: false,
          removeOnFail: false,
        },
      );
    });
  });
});
