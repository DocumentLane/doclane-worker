import { registerAs } from '@nestjs/config';

export const pdfProcessingConfig = registerAs('pdfProcessing', () => ({
  linearization: {
    enabled: process.env.PDF_LINEARIZATION_ENABLED !== 'false',
    required: process.env.PDF_LINEARIZATION_REQUIRED === 'true',
    qpdfPath: process.env.PDF_LINEARIZATION_QPDF_PATH ?? 'qpdf',
    fixQdfPath: process.env.PDF_LINEARIZATION_FIX_QDF_PATH ?? 'fix-qdf',
    rebalancePageTreeEnabled:
      process.env.PDF_LINEARIZATION_REBALANCE_PAGE_TREE_ENABLED !== 'false',
    pageTreeGroupSize: Number(
      process.env.PDF_LINEARIZATION_PAGE_TREE_GROUP_SIZE ?? 32,
    ),
  },
  rasterization: {
    pdftoppmPath: process.env.PDF_RASTERIZATION_PDFTOPPM_PATH ?? 'pdftoppm',
  },
  metadata: {
    pdfinfoPath: process.env.PDF_METADATA_PDFINFO_PATH ?? 'pdfinfo',
    pdftotextPath: process.env.PDF_METADATA_PDFTOTEXT_PATH ?? 'pdftotext',
  },
  ocr: {
    enabled: process.env.PDF_OCR_ENABLED !== 'false',
    language: process.env.PDF_OCR_LANGUAGE ?? 'eng',
    tesseractPath: process.env.PDF_OCR_TESSERACT_PATH ?? 'tesseract',
    targetWidth: Number(process.env.PDF_OCR_TARGET_WIDTH ?? 1800),
    dpi: Number(process.env.PDF_OCR_DPI ?? 300),
    psm: Number(process.env.PDF_OCR_PSM ?? 6),
    pdfOutputEnabled: process.env.PDF_OCR_PDF_OUTPUT_ENABLED !== 'false',
    ocrmypdfPath: process.env.PDF_OCR_OCRMYPDF_PATH ?? 'ocrmypdf',
  },
}));
