import { RecognizedPdfPage } from './recognized-pdf-page.interface';

export interface RecognizedPdfDocument {
  pages: RecognizedPdfPage[];
  ocrPdfBytes?: Uint8Array;
}
