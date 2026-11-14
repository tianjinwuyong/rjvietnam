import { Module } from '@nestjs/common';
import { StockTakeController } from './stock-take.controller';
import { StockTakeService } from './stock-take.service';

@Module({
  controllers: [StockTakeController],
  providers: [StockTakeService],
  exports: [StockTakeService],
})
export class StockTakeModule {}
