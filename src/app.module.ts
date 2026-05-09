import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { pdfProcessingConfig } from './config/configs/pdf-processing.config';
import { redisConfig } from './config/configs/redis.config';
import { s3Config } from './config/configs/s3.config';
import { environmentValidationSchema } from './config/schemas/env.validation-schema';
import { PdfMetadataModule } from './pdf-metadata/pdf-metadata.module';
import { PdfOcrModule } from './pdf-ocr/pdf-ocr.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [redisConfig, s3Config, pdfProcessingConfig],
      validationSchema: environmentValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('redis.host'),
          port: configService.getOrThrow<number>('redis.port'),
          username: configService.get<string>('redis.username'),
          password: configService.get<string>('redis.password'),
          db: configService.getOrThrow<number>('redis.db'),
        },
      }),
    }),
    PdfMetadataModule,
    PdfOcrModule,
  ],
})
export class AppModule {}
