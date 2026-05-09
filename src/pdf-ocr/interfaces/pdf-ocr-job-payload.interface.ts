export interface PdfOcrJobPage {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PdfOcrJobOptions {
  language: string;
  dpi: number;
  psm: number;
  pdfOutputEnabled: boolean;
}

export interface PdfOcrJobPayload {
  documentId: string;
  objectKey: string;
  storageBucket: string;
  language?: string;
  ocrOptions?: PdfOcrJobOptions;
  pages: PdfOcrJobPage[];
}
