import { Module } from '@nestjs/common';
import { PdfLinearizationService } from './pdf-linearization.service';

@Module({
  providers: [PdfLinearizationService],
  exports: [PdfLinearizationService],
})
export class PdfLinearizationModule {}
