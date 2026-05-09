export interface RecognizedPdfPage {
  pageNumber: number;
  text: string;
  language: string;
  confidence?: number;
}
