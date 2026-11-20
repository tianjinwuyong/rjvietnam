import { Module } from '@nestjs/common';
import { MrbController } from './mrb.controller';
import { MrbService } from './mrb.service';
import { SupplierDebtModule } from '../supplier-debt/supplier-debt.module';
import { NoticeModule } from '../notice/notice.module';

@Module({
  // MRB 判退货 / 报废 / 否决时要写供应商欠料台账，故依赖欠料模块；
  // 终审后要给 IQC / 仓库 / 计划 / 生产抄送站内消息，故依赖消息模块。
  imports: [SupplierDebtModule, NoticeModule],
  controllers: [MrbController],
  providers: [MrbService],
  exports: [MrbService],
})
export class MrbModule {}
