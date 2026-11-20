import { Module } from '@nestjs/common';
import { OverPickingController } from './over-picking.controller';
import { OverPickingService } from './over-picking.service';

@Module({
  controllers: [OverPickingController],
  providers: [OverPickingService],
  exports: [OverPickingService],
})
export class OverPickingModule {}
