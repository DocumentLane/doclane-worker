import Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().integer().min(1).default(6379),
  REDIS_USERNAME: Joi.string().optional(),
  REDIS_PASSWORD: Joi.string().optional(),
  REDIS_DB: Joi.number().integer().min(0).default(0),
  S3_REGION: Joi.string().optional(),
  S3_ACCESS_KEY_ID: Joi.string().optional(),
  S3_SECRET_ACCESS_KEY: Joi.string().optional(),
  S3_ENDPOINT: Joi.string().uri().optional(),
  S3_FORCE_PATH_STYLE: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  PDF_LINEARIZATION_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
  PDF_LINEARIZATION_REQUIRED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  PDF_LINEARIZATION_QPDF_PATH: Joi.string().default('qpdf'),
  PDF_RASTERIZATION_PDFTOPPM_PATH: Joi.string().default('pdftoppm'),
  PDF_METADATA_PDFINFO_PATH: Joi.string().default('pdfinfo'),
  PDF_METADATA_PDFTOTEXT_PATH: Joi.string().default('pdftotext'),
  PDF_OCR_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  PDF_OCR_LANGUAGE: Joi.string().default('eng'),
  PDF_OCR_TESSERACT_PATH: Joi.string().default('tesseract'),
  PDF_OCR_TARGET_WIDTH: Joi.number().integer().min(1).default(1800),
  PDF_OCR_DPI: Joi.number().integer().min(1).default(300),
  PDF_OCR_PSM: Joi.number().integer().min(0).max(13).default(6),
  PDF_OCR_PDF_OUTPUT_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
  PDF_OCR_OCRMYPDF_PATH: Joi.string().default('ocrmypdf'),
});
