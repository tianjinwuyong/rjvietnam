import { authModule } from "./modules/auth";
import { adminModule } from "./modules/admin";
import { dashboardModule } from "./modules/dashboard";
import { erpModule } from "./modules/erp";
import { hrModule } from "./modules/hr";
import { serviceModule } from "./modules/service";
import { maintenanceModule } from "./modules/maintenance";
import { metaModule } from "./modules/meta";
import { mesModule } from "./modules/mes";
import { pmcModule } from "./modules/pmc";
import { qualityModule } from "./modules/quality";
import { reportsModule } from "./modules/reports";
import { traceabilityModule } from "./modules/traceability";
import { wmsModule } from "./modules/wms";
import { sparepartsModule } from "./modules/spareparts";
import { equipmentSuppliersModule } from "./modules/equipment-suppliers";
import { partsSuppliersModule } from "./modules/parts-suppliers";
import { partsPricingModule } from "./modules/parts-pricing";
import { equipmentArchivesModule } from "./modules/equipment-archives";
import { pdaModule } from "./modules/pda";
import { salesModule } from "./modules/sales";

export const apiModules = [
  authModule,
  metaModule,
  dashboardModule,
  erpModule,
  pmcModule,
  wmsModule,
  mesModule,
  qualityModule,
  traceabilityModule,
  reportsModule,
  adminModule,
  hrModule,
  serviceModule,
  maintenanceModule,
  sparepartsModule,
  equipmentSuppliersModule,
  partsSuppliersModule,
  partsPricingModule,
  equipmentArchivesModule,
  pdaModule,
  salesModule,
];

export function listApiRoutes() {
  return apiModules.flatMap((module) =>
    module.routes.map((route) => ({
      module: module.key,
      ...route,
    })),
  );
}
