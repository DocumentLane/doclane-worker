# Doclane Worker

NestJS worker process for Doclane PDF jobs. The app connects to Redis/BullMQ queues and S3-compatible object storage; it does not connect directly to the database.

## Requirements

- Node.js 22
- pnpm
- Redis
- S3-compatible object storage
- PDF/OCR command line tools:
  - `qpdf`
  - `fix-qdf`
  - `pdfinfo`
  - `pdftotext`
  - `pdftoppm`
  - `tesseract`
  - `ocrmypdf`

## Environment

Copy `.env.example` to `.env` and adjust the values for your Redis and S3-compatible storage.

```bash
cp .env.example .env
```

Application code reads environment values through config aliases such as `redis.host`, `s3.endpoint`, and `pdfProcessing.ocr.enabled`.

## Local Development

```bash
pnpm install
pnpm start:dev
```

## Dockerfile

Build the worker image:

```bash
docker build -t doclane-worker .
```

The worker container includes the PDF and OCR binaries needed by the configured processing pipeline.

## Verification

After worker changes, run:

```bash
pnpm build
pnpm lint
pnpm test
```
