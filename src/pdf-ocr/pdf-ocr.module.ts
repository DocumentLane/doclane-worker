import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PdfLinearizationModule } from '../pdf-linearization/pdf-linearization.module';
import { PdfRasterizationModule } from '../pdf-rasterization/pdf-rasterization.module';
import { S3Module } from '../s3/s3.module';
import { PdfOcrProcessor } from './pdf-ocr.processor';
import { PdfOcrService } from './pdf-ocr.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'pdf-ocr',
    }),
    BullModule.registerQueue({
      name: 'pdf-ocr-result',
    }),
    PdfLinearizationModule,
    PdfRasterizationModule,
    S3Module,
  ],
  providers: [PdfOcrProcessor, PdfOcrService],
})
export class PdfOcrModule {}
