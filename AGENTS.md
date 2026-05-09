# Doclane Worker Agent Instructions

## Worker Conventions

- Do not set up Prisma in this repository.
- Do not add direct database connections in this repository.
- Worker processes connect to Redis/BullMQ queues only.
- Database updates are owned by the backend API or a future explicitly approved DB integration.
- Environment validation must use `ConfigModule.validationSchema` with Joi, not a custom class-validator env DTO.
- Environment variables must be aliased through `registerAs` config factories under `src/config/configs`.
- Application code should read config aliases such as `redis.host`, not raw env keys such as `REDIS_HOST`.
- Raw `process.env` access is allowed only inside config factories and tests.
- HTTP request DTOs must use `class-validator` and `class-transformer`.
- Keep the global `ValidationPipe` enabled with `transform`, `whitelist`, and `forbidNonWhitelisted`.
- Responses that need transformation must use response DTOs with class-transformer and Nest `SerializeOptions`.
- Keep `ClassSerializerInterceptor` registered globally.

## Queues

- Use `@nestjs/bullmq` for queue processors.
- Register queues in the feature module that owns the processor.
- Keep queue payload contracts in `interfaces/*.interface.ts`.
- The initial queue is `pdf-metadata`.
- Uploaded PDFs should be linearized before metadata extraction when qpdf is available.
- Keep PDF processing options behind the `pdfProcessing.*` config alias.
- Do not read `PDF_LINEARIZATION_*` env values outside config factories.

## Storage

- S3 access must support custom endpoints for self-hosted S3-compatible storage.
- Keep endpoint and path-style behavior configurable through environment variables.
- Object storage should remain private; expose document access through short-lived signed URLs.

## File Layout

- `*.controller.ts`, `*.service.ts`, and `*.module.ts` stay directly under the feature folder.
- Other feature files must live in typed subfolders:
  - `dto/*.dto.ts`
  - `interfaces/*.interface.ts`
  - `types/*.type.ts`
  - `specs/*.spec.ts`
- Do not place DTOs, interfaces, types, or specs at the feature folder root.
- Do not add `entities/*.entity.ts`; API response contracts are DTOs.

## Type Safety

- Prefer DTO validation and explicit contracts over ad hoc runtime type checks.
- Minimize `typeof` and similar runtime checks.
- When runtime checks are unavoidable for external input or provider claims, keep them narrow and local.

## Verification

- After worker changes, run:
  - `pnpm build`
  - `pnpm lint`
  - relevant tests when behavior is changed
