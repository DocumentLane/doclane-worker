export interface PdfMetadataPageResult {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  hasTextLayer: boolean;
}

export interface PdfMetadataPreviewResult {
  pageNumber: number;
  storageBucket: string;
  objectKey: string;
  contentType: 'image/png';
  width: number;
  height: number;
  sizeBytes: number;
}

export interface PdfMetadataLinearizationResult {
  status: 'READY' | 'UNAVAILABLE' | 'FAILED';
  objectKey?: string;
  sizeBytes?: number;
  errorMessage?: string;
}

export interface PdfMetadataSuccessResultPayload {
  jobId: string;
  documentId: string;
  status: 'completed';
  pageCount: number;
  hasTextLayer: boolean;
  pages: PdfMetadataPageResult[];
  linearization?: PdfMetadataLinearizationResult;
  preview?: PdfMetadataPreviewResult;
}

export interface PdfMetadataProgressResultPayload {
  jobId: string;
  documentId: string;
  status: 'progress';
  currentPageNumber: number;
  completedPages: number;
  totalPages: number;
  progressPercent: number;
}

export interface PdfMetadataFailedResultPayload {
  jobId: string;
  documentId: string;
  status: 'failed';
  errorCode: string;
  errorMessage: string;
}

export type PdfMetadataResultPayload =
  | PdfMetadataSuccessResultPayload
  | PdfMetadataProgressResultPayload
  | PdfMetadataFailedResultPayload;
