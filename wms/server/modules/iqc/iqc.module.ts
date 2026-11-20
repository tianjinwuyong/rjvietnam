import { Module } from '@nestjs/common';
import { IqcController } from './iqc.controller';
import { IqcService } from './iqc.service';
import { IqcTemplateService } from './iqc-template.service';
import { IqcStandardItemService } from './iqc-standard-item.service';
import { SamplingPlanService } from './sampling-plan.service';
import { StrictnessService } from './strictness.service';
import { ProductionReturnIqcController } from './production-return-iqc.controller';
import { OaIqcController } from './oa-iqc.controller';
import { OaIqcService } from './oa-iqc.service';
import { OaOutboxService } from './oa-outbox.service';
import { OaMrbController } from './oa-mrb.controller';
import { OaSamplingController } from './oa-sampling.controller';
import { OaMrbService } from './oa-mrb.service';
import { ExpiryScanService } from './expiry-scan.service';
import { ProductionReturnIqcService } from './production-return-iqc.service';
import { MrbModule } from '../mrb/mrb.module';
import { SupplierDebtModule } from '../supplier-debt/supplier-debt.module';

@Module({
  imports: [MrbModule, SupplierDebtModule],
  controllers: [IqcController, ProductionReturnIqcController, OaIqcController, OaMrbController, OaSamplingController],
  providers: [IqcService, IqcTemplateService, IqcStandardItemService, SamplingPlanService, StrictnessService, ProductionReturnIqcService, OaIqcService, OaOutboxService, OaMrbService, ExpiryScanService],
  exports: [StrictnessService, SamplingPlanService],
})
export class IqcModule {}
