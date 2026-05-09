import { PdfMetadataPageResult } from './pdf-metadata-result-payload.interface';

export interface ExtractedPdfMetadata {
  pageCount: number;
  hasTextLayer: boolean;
  pages: PdfMetadataPageResult[];
}
