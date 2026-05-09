export interface PdfOcrResultItem {
  pageNumber: number;
  text: string;
  language: string;
  confidence?: number;
}

export interface PdfOcrResultPdf {
  objectKey: string;
  sizeBytes: number;
  checksumSha256: string;
  contentType: 'application/pdf';
  linearized: boolean;
}

export interface PdfOcrSuccessResultPayload {
  jobId: string;
  documentId: string;
  status: 'completed';
  pages: PdfOcrResultItem[];
  ocrPdf?: PdfOcrResultPdf;
}

export interface PdfOcrProgressResultPayload {
  jobId: string;
  documentId: string;
  status: 'progress';
  currentPageNumber: number;
  completedPages: number;
  totalPages: number;
  progressPercent: number;
}

export interface PdfOcrFailedResultPayload {
  jobId: string;
  documentId: string;
  status: 'failed';
  errorCode: string;
  errorMessage: string;
}

export type PdfOcrResultPayload =
  | PdfOcrSuccessResultPayload
  | PdfOcrProgressResultPayload
  | PdfOcrFailedResultPayload;
