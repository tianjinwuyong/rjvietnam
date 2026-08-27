import type { FactoryPermissionKey } from "../../../../../packages/shared-types/src/factory";

export type FactoryModuleKey =
  | "auth"
  | "meta"
  | "dashboard"
  | "erp"
  | "pmc"
  | "wms"
  | "mes"
  | "quality"
  | "traceability"
  | "reports"
  | "admin"
  | "hr"
  | "maintenance"
  | "service"
  | "spare-parts"
  | "equipment-suppliers"
  | "parts-suppliers"
  | "parts-pricing"
  | "equipment-archives"
  | "pda"
  | "sales";

export type ModuleRoute = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  requiredPermissions?: FactoryPermissionKey[];
  public?: boolean;
};

export type FactoryModule = {
  key: FactoryModuleKey;
  name: string;
  owns: string[];
  routes: ModuleRoute[];
};
