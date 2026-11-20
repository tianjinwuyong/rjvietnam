import { Module } from '@nestjs/common';
import { DefectiveMoveService } from './defective-move.service';
import { DefectiveMoveController } from './defective-move.controller';
import { NoticeModule } from '../notice/notice.module';

@Module({
  imports: [NoticeModule],
  providers: [DefectiveMoveService],
  controllers: [DefectiveMoveController],
  exports: [DefectiveMoveService],
})
export class DefectiveMoveModule {}
