import { Module } from '@nestjs/common';

import { MesApiController } from './mes-api.controller';
import { MesApiService } from './mes-api.service';

/**
 * MES / 第三方开放接口
 * 独立模块：不依赖任何业务 service，只读数据库，注册与否不影响主流程。
 */
@Module({
  controllers: [MesApiController],
  providers: [MesApiService],
})
export class MesApiModule {}
