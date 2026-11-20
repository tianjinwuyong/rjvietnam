import { Module } from '@nestjs/common';
import { ReceiptController } from './receipt.controller';
import { ReceiptService } from './receipt.service';
import { ProductionReturnReceiptController } from './production-return-receipt.controller';
import { ProductionReturnReceiptService } from './production-return-receipt.service';

@Module({
  controllers: [ReceiptController, ProductionReturnReceiptController],
  providers: [ReceiptService, ProductionReturnReceiptService],
})
export class ReceiptModule {}
