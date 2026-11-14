import { Module } from '@nestjs/common';

import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { SystemModule } from '../system/system.module';

@Module({
  imports: [SystemModule],
  controllers: [WarehouseController],
  providers: [WarehouseService],
})
export class WarehouseModule {}
