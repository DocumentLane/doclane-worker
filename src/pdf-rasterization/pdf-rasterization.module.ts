import { Module } from '@nestjs/common';
import { PdfRasterizationService } from './pdf-rasterization.service';

@Module({
  providers: [PdfRasterizationService],
  exports: [PdfRasterizationService],
})
export class PdfRasterizationModule {}
