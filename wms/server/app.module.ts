import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Module } from '@nestjs/common';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { OperationLogInterceptor } from './common/interceptors/operation-log.interceptor';
import { DatabaseModule } from './database/database.module';
import { ViewModule } from './modules/view/view.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { MaterialModule } from './modules/material/material.module';
import { ReceiptModule } from './modules/receipt/receipt.module';
import { IqcModule } from './modules/iqc/iqc.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { BomModule } from './modules/bom/bom.module';
import { WorkorderModule } from './modules/workorder/workorder.module';
import { OaIntegrationModule } from './modules/oa-integration/oa-integration.module';
import { MrbModule } from './modules/mrb/mrb.module';
import { OverPickingModule } from './modules/over-picking/over-picking.module';
import { SystemModule } from './modules/system/system.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DefectiveMoveModule } from './modules/defective-move/defective-move.module';
import { SupplierDebtModule } from './modules/supplier-debt/supplier-debt.module';
import { StockTakeModule } from './modules/stock-take/stock-take.module';
import { SupplierReturnModule } from './modules/supplier-return/supplier-return.module';
import { ReworkModule } from './modules/rework/rework.module';
import { NoticeModule } from './modules/notice/notice.module';
import { MesApiModule } from './modules/mes-api/mes-api.module';
import { MesSyncModule } from './modules/mes-sync/mes-sync.module';

@Module({
  imports: [
    DatabaseModule,
    WarehouseModule,
    MaterialModule,
    ReceiptModule,
    IqcModule,
    InventoryModule,
    BomModule,
    WorkorderModule,
    OaIntegrationModule,
    MrbModule,
    OverPickingModule,
    SystemModule,
    DashboardModule,
    SupplierDebtModule,
    StockTakeModule,
    DefectiveMoveModule,
    SupplierReturnModule,
    ReworkModule,
    NoticeModule,
    MesApiModule,
    MesSyncModule,
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // 全局鉴权守卫（默认拒绝）：所有控制器路由默认需要登录，
    // 仅 @Public() 标注的路由（登录、运行时配置、SPA 兜底页）放行。
    // 此前为「逐控制器 opt-in @NeedLogin()」，defective-move 模块因此整体漏挂，
    // 未登录即可读写库存；改为全局守卫后从机制上杜绝同类遗漏。
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // 敏感操作审计（task #117 / BUG-006）：按路由映射表自动写入 operation_log。
    // 全局注册的意义与守卫同理——逐个 service 里手动调 createOperationLog 会持续漏埋，
    // 且新增接口时没人会记得补。这里在框架层统一兜住。
    // 埋点范围见 common/interceptors/operation-log.rules.ts；写日志失败不影响主业务。
    {
      provide: APP_INTERCEPTOR,
      useClass: OperationLogInterceptor,
    },
  ],
})
export class AppModule {}
