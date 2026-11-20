import { Module } from '@nestjs/common';
import { SupplierReturnService } from './supplier-return.service';
import { SupplierReturnController } from './supplier-return.controller';
import { MrbModule } from '../mrb/mrb.module';

@Module({
  imports: [MrbModule],
  providers: [SupplierReturnService],
  controllers: [SupplierReturnController],
  exports: [SupplierReturnService],
})
export class SupplierReturnModule {}
