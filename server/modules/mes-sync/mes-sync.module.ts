import { Module } from '@nestjs/common';

import { MesSyncController } from './mes-sync.controller';
import { MesSyncService } from './mes-sync.service';

/**
 * MES 接入模块：负责「拉」MES 的工单与用料，并在 WMS 侧生成领料单。
 * 与 mes-api 模块方向相反 —— mes-api 是 WMS 对外提供只读查询，本模块是 WMS 主动调 MES。
 */
@Module({
  controllers: [MesSyncController],
  providers: [MesSyncService],
  exports: [MesSyncService],
})
export class MesSyncModule {}
