import { Module } from '@nestjs/common';
import { WorkorderController } from './workorder.controller';
import { WorkorderService } from './workorder.service';
import { OaIntegrationModule } from '../oa-integration/oa-integration.module';
import { ProductionReturnController } from './production-return.controller';
import { ProductionReturnService } from './production-return.service';

@Module({
  imports: [OaIntegrationModule],
  controllers: [WorkorderController, ProductionReturnController],
  providers: [WorkorderService, ProductionReturnService],
})
export class WorkorderModule {}
