import { Module, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { MasterDataClearService } from './master-data-clear.service';

@Module({
  controllers: [SystemController],
  providers: [SystemService, MasterDataClearService],
  exports: [SystemService, MasterDataClearService],
})
export class SystemModule implements OnModuleInit {
  private readonly logger = new Logger(SystemModule.name);

  constructor(@Inject(SystemService) private readonly systemService: SystemService) {}

  async onModuleInit() {
    // 初始化时间基点必须最先载入：鉴权守卫靠它作废「上一次系统初始化之前」
    // 签发的登录令牌，漏载会让旧令牌短暂可用。
    try {
      await this.systemService.loadSystemEpoch();
    } catch (err) {
      this.logger.error('load system epoch failed: ' + JSON.stringify(err));
    }

    try {
      await this.systemService.initRolesIfEmpty();
      await this.systemService.syncRolePermissions();
      await this.systemService.syncAccountWorkSections();
      await this.systemService.syncAccountPlatformUserIds();
      await this.systemService.initAdminIfEmpty();
    } catch (err) {
      this.logger.error('init roles/admin failed: ' + JSON.stringify(err));
    }
  }
}
