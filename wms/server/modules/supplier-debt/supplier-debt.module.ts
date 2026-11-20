import { Module } from '@nestjs/common';
import { SupplierDebtService } from './supplier-debt.service';
import { SupplierDebtController } from './supplier-debt.controller';

@Module({
  controllers: [SupplierDebtController],
  providers: [SupplierDebtService],
  exports: [SupplierDebtService],
})
export class SupplierDebtModule {}
