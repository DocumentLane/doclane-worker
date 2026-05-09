export interface RasterizedPdfPage {
  pageNumber: number;
  width: number;
  height: number;
  contentType: 'image/png';
  bytes: Buffer;
}
