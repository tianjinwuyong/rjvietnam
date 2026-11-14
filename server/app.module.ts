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
import { SalesModule } from './modules/sales/sales.module';
import { HrModule } from './modules/hr/hr.module';

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
    SalesModule,
    HrModule,
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: OperationLogInterceptor,
    },
  ],
})
export class AppModule {}
