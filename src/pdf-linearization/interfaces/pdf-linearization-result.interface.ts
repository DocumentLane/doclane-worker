export interface PdfLinearizationResult {
  bytes: Uint8Array;
  linearized: boolean;
  errorMessage?: string;
  sizeBytes: number;
}
