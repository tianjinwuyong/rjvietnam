import { Module } from '@nestjs/common';
import { ReworkService } from './rework.service';
import { ReworkController } from './rework.controller';
import { MrbModule } from '../mrb/mrb.module';
import { NoticeModule } from '../notice/notice.module';

@Module({
  // 返工模块依赖 MRB：复检完成要回写处置明细、收敛 MRB 执行状态；
  // 依赖消息模块：SQE 确认完工后要通知 IQC 复检，复检结论要回执 SQE。
  imports: [MrbModule, NoticeModule],
  providers: [ReworkService],
  controllers: [ReworkController],
  exports: [ReworkService],
})
export class ReworkModule {}
