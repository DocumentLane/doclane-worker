import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PdfLinearizationModule } from '../pdf-linearization/pdf-linearization.module';
import { PdfRasterizationModule } from '../pdf-rasterization/pdf-rasterization.module';
import { S3Module } from '../s3/s3.module';
import { PdfMetadataProcessor } from './pdf-metadata.processor';
import { PdfMetadataService } from './pdf-metadata.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'pdf-metadata',
    }),
    BullModule.registerQueue({
      name: 'pdf-metadata-result',
    }),
    PdfLinearizationModule,
    PdfRasterizationModule,
    S3Module,
  ],
  providers: [PdfMetadataProcessor, PdfMetadataService],
})
export class PdfMetadataModule {}
