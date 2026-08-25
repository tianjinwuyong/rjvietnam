import type { FactoryPermissionKey, Locale, RoleKey } from "../../../../packages/shared-types/src/factory";
import { pdaModule } from "../modules/pda";

export type ApiModuleKey =
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
  | "service"
  | "maintenance"
  | "spare-parts"
  | "equipment-suppliers"
  | "parts-suppliers"
  | "parts-pricing"
  | "equipment-archives"
  | "pda";

export type ApiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiPageQuery = {
  q?: string;
  locale?: Locale;
  page?: number;
  pageSize?: number;
  cursor?: string;
  sort?: string;
  fields?: string;
  include?: string;
};

export type ApiEnvelope<T> = {
  data: T;
  meta?: {
    requestId?: string;
    serverTime?: string;
    locale?: Locale;
    warnings?: string[];
  };
};

export type ApiListEnvelope<T> = ApiEnvelope<{
  items: T[];
  page?: number;
  pageSize?: number;
  total?: number;
  nextCursor?: string | null;
}>;

export type ApiMutationEnvelope<T> = ApiEnvelope<{
  item: T;
  auditEventId?: string;
}>;

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
  };
  meta?: {
    requestId?: string;
    serverTime?: string;
  };
};

export type ApiEndpointSpec = {
  method: ApiHttpMethod;
  path: string;
  summary: string;
  request?: string;
  response?: string;
  query?: string;
  notes?: string;
};

export type ApiModuleSpec = {
  key: ApiModuleKey;
  name: string;
  purpose: string;
  endpoints: ApiEndpointSpec[];
};

export type LoginRequestShape = {
  username: string;
  password: string;
  locale?: Locale;
  rememberMe?: boolean;
  deviceLabel?: string;
};

export type SessionUserShape = {
  id: string;
  username: string;
  displayName: string;
  locale: Locale;
  roleKey: RoleKey;
  permissions: FactoryPermissionKey[];
};

export type SessionShape = {
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  rememberMe: boolean;
  user: SessionUserShape;
};

export type BootstrapShape = {
  session: SessionShape;
  locale: Locale;
  locales: Locale[];
  visibleModules: ApiModuleKey[];
  permissions: FactoryPermissionKey[];
  ui: {
    navigationVersion: string;
    dictionaryVersion: string;
  };
};

export type CommandContext = {
  operator: string;
  workstationId?: string;
  deviceLabel?: string;
  locale?: Locale;
  comment?: string;
};

export type ActionEnvelope<TAction extends string, TPayload> = {
  action: TAction;
  payload: TPayload;
  context: CommandContext;
};

export const apiModuleCatalog: ApiModuleSpec[] = [
  {
    key: "auth",
    name: "Shared auth and sessions",
    purpose: "Login, current session, and session lifecycle control for all module entry points.",
    endpoints: [
      {
        method: "POST",
        path: "/auth/login",
        summary: "Authenticate a user and issue a session",
        request: "LoginRequestShape",
        response: "ApiMutationEnvelope<{ session: SessionShape; auditEventId: string }>",
      },
      {
        method: "GET",
        path: "/auth/session",
        summary: "Return the current session and user permissions",
        response: "ApiEnvelope<{ session: SessionShape; permissions: FactoryPermissionKey[] }>",
      },
      {
        method: "GET",
        path: "/auth/sessions",
        summary: "List active sessions for the current user or an admin viewer",
        query: "ApiPageQuery",
        response: "ApiListEnvelope<SessionShape>",
      },
      {
        method: "POST",
        path: "/auth/logout",
        summary: "Invalidate the current session",
        response: "ApiEnvelope<{ revoked: true }>",
      },
      {
        method: "DELETE",
        path: "/auth/sessions/{sessionId}",
        summary: "Revoke a specific session",
        response: "ApiEnvelope<{ revoked: true }>",
      },
      {
        method: "GET",
        path: "/auth/audit-events",
        summary: "Search audit-friendly authentication events",
        query: "eventType, status, fromDate, toDate, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "meta",
    name: "Bootstrap and i18n access",
    purpose: "Shared lookup and locale access for the web shell and contract workers.",
    endpoints: [
      {
        method: "GET",
        path: "/meta/bootstrap",
        summary: "Return session, locale, permissions, visible modules, and UI dictionary versions",
        query: "locale?",
        response: "ApiEnvelope<BootstrapShape>",
      },
      {
        method: "GET",
        path: "/meta/i18n/{locale}",
        summary: "Return the full dictionary bundle for a locale",
        response: "ApiEnvelope<{ locale: Locale; dictionaryVersion: string; entries: Record<string, string> }>",
      },
      {
        method: "GET",
        path: "/meta/lookups",
        summary: "Return shared lookup sets such as status codes, locales, modules, and command enums",
        query: "locale?, include?",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "dashboard",
    name: "Factory dashboard",
    purpose: "Cross-module operational summary for management and line supervision.",
    endpoints: [
      {
        method: "GET",
        path: "/dashboard/summary",
        summary: "Return factory KPI cards, live line state, and open alerts",
        query: "locale?, include?",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "erp",
    name: "ERP and commercial master data",
    purpose: "Customer demand, product master, supplier master, BOM revisions, and delivery plan headers.",
    endpoints: [
      {
        method: "GET",
        path: "/erp/products",
        summary: "List product master data and active BOM revisions",
        query: "q, status, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/erp/customers",
        summary: "List customer master records",
        query: "q, status, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/erp/suppliers",
        summary: "List supplier master records",
        query: "q, status, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/erp/materials",
        summary: "List material master records",
        query: "q, status, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/erp/boms",
        summary: "List BOM headers and revisions",
        query: "q, status, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/erp/boms/:id",
        summary: "Get a single BOM with all lines",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/erp/boms/product/:code",
        summary: "Get latest active BOM for a product code",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/erp/boms",
        summary: "Create BOM with material lines",
        request: "ActionEnvelope<'create', { bom: Record<string, unknown>; lines: Record<string, unknown>[] }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      
      {
        method: "DELETE",
        path: "/erp/boms/:id",
        summary: "Delete a BOM and its lines",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/erp/boms/import",
        summary: "Import BOM from parsed Excel data",
        request: "ActionEnvelope<'import', { rows: Record<string, unknown>[] }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/erp/boms/:id/history",
        summary: "Get BOM edit history",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/erp/boms/:id/history",
        summary: "Record a BOM edit history entry",
        request: "ActionEnvelope<'record', { entry: Record<string, unknown> }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/erp/master-data",
        summary: "List shared master records across customers, suppliers, products, materials, BOMs, and delivery plans",
        query: "entity, q, status, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/erp/master-data",
        summary: "Create or update a master-data record using an entity discriminator",
        request: "ActionEnvelope<'upsert', { entity: string; record: Record<string, unknown> }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/erp/customer-pos",
        summary: "List customer purchase orders and delivery risk",
        query: "q, customerCode, dueFrom, dueTo, status, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/erp/customer-pos",
        summary: "Create or confirm a customer purchase order",
        request: "ActionEnvelope<'upsert', { customerPo: Record<string, unknown> }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "pmc",
    name: "Production planning and control",
    purpose: "Work order generation, release, schedule lookup, and execution readiness.",
    endpoints: [
      {
        method: "GET",
        path: "/pmc/work-orders",
        summary: "List work orders with material readiness and execution status",
        query: "q, status, poNumber, lineCode, dueFrom, dueTo, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/pmc/work-orders",
        summary: "Create a work order and allocate the next preserved 11 digit code",
        request: "ActionEnvelope<'create', { workOrder: Record<string, unknown> }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PATCH",
        path: "/pmc/work-orders/{code}",
        summary: "Change work-order lifecycle state such as release, hold, close, or cancel",
        request: "ActionEnvelope<'transition', { status: string; reason?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/pmc/schedules",
        summary: "Return production schedule by line, date range, or priority",
        query: "lineCode, dueFrom, dueTo, status, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "wms",
    name: "Warehouse material control",
    purpose: "Receiving, IQC state, storage, picking, stock view, and inventory transaction history.",
    endpoints: [
      {
        method: "GET",
        path: "/wms/material-lots",
        summary: "List material lots with IQC status, reserve state, and location",
        query: "materialCode, lotNo, locationCode, iqcStatus, q, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/wms/storage-locations",
        summary: "List storage locations and hold locations",
        query: "areaCode, status, q, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/wms/stock",
        summary: "Return derived stock balances by material, location, and IQC status",
        query: "materialCode, locationCode, workOrderCode, iqcStatus, q, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/wms/inventory-transactions",
        summary: "List the auditable inventory ledger",
        query: "action, materialLotId, workOrderCode, locationCode, fromDate, toDate, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/wms/transactions",
        summary: "Append a material movement command such as receive, put-away, reserve, pick, issue, return, scrap, or adjust",
        request: "ActionEnvelope<'receive' | 'iqc_release' | 'iqc_hold' | 'iqc_reject' | 'put_away' | 'reserve' | 'pick' | 'issue_to_line' | 'return' | 'scrap' | 'adjust', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/wms/shelf/status",
        summary: "Smart shelf overall status — occupied cells, label counts, and connection state per rack",
        response: "ApiEnvelope<{ shelves: ShelfStatus[]; totalShelves: number }>",
      },
      {
        method: "GET",
        path: "/wms/shelf/list",
        summary: "List all smart shelves with occupancy summary for the PDA dashboard",
        response: "ApiEnvelope<{ shelves: ShelfSummary[]; summary: RackSummary }>",
      },
      {
        method: "GET",
        path: "/wms/shelf/{shelfCode}",
        summary: "Cell-level detail for a single rack — material code, lot, label, and qty per cell",
        response: "ApiEnvelope<{ shelf: ShelfStatus; cells: ShelfCell[] }>",
      },
      {
        method: "POST",
        path: "/wms/shelf/light-on",
        summary: "Turn shelf cell lights on for visual pick indication (proxies to shelf controller)",
        request: "{ shelfCode: string; color: number }",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/wms/shelf/shelf-in",
        summary: "Record material lot put-away into a smart shelf cell (proxies to shelf controller)",
        request: "{ shelfCode: string; labelId: string }",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/wms/shelf/shelf-out",
        summary: "Record material pick-out from smart shelf cells (proxies to shelf controller)",
        request: "{ labelIdList?: string[]; labelIdListJson?: string; color?: number }",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/wms/shelf/remove-label",
        summary: "Remove a label registration from a smart shelf cell (proxies to shelf controller)",
        request: "{ labelId: string }",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "mes",
    name: "SMT production execution",
    purpose: "Lines, stations, process routes, runs, feeder bindings, PCB serials, station events, and downtime capture for the factory floor.",
    endpoints: [
      // Lines
      {
        method: "GET",
        path: "/mes/lines",
        summary: "List production lines with current run and OEE snapshot",
        query: "status, locale, page, pageSize, sort",
        response: "ApiListEnvelope<ProductionLineDto>",
      },
      {
        method: "GET",
        path: "/mes/lines/{lineCode}",
        summary: "Get a single line plus its current run, OEE, and recent events",
        response: "ApiEnvelope<{ line: ProductionLineDto; currentRun?: MesRunDto; recentEvents: StationEventDto[] }>",
      },
      // Stations
      {
        method: "GET",
        path: "/mes/stations",
        summary: "List stations filtered by line or station type",
        query: "lineCode, stationType, locale, page, pageSize, sort",
        response: "ApiListEnvelope<StationDto>",
      },
      {
        method: "GET",
        path: "/mes/stations/{code}",
        summary: "Get a station with its 20 most recent events",
        response: "ApiEnvelope<{ station: StationDto; recentEvents: StationEventDto[] }>",
      },
      {
        method: "GET",
        path: "/mes/station-query",
        summary: "Unified read-only query for NG, station history, station status, and WIP used by Web, PDA, and station agents",
        query: "sn, station, status, workOrder, boxQr, shipmentId, query, from, to",
        response: "ApiEnvelope<{ source: 'MES'; rows: Record<string, unknown>[]; generatedAt: string }>",
      },
      {
        method: "PATCH",
        path: "/mes/stations/{code}/ip",
        summary: "Register the current station IP address",
        request: "{ ipAddress: string }",
        response: "ApiEnvelope<StationDto>",
      },
      // Process routes
      {
        method: "GET",
        path: "/mes/process-routes",
        summary: "List active process routes, optionally filtered by product code",
        query: "productCode, locale, page, pageSize, sort",
        response: "ApiListEnvelope<ProcessRouteDto>",
      },
      {
        method: "GET",
        path: "/mes/process-routes/{id}",
        summary: "Get a process route with its full ordered step list",
        response: "ApiEnvelope<ProcessRouteDetailDto>",
      },
      {
        method: "GET",
        path: "/mes/process-routes/{id}/steps",
        summary: "List the steps of a process route in order",
        response: "ApiListEnvelope<ProcessRouteStepDto>",
      },
      // Runs
      {
        method: "GET",
        path: "/mes/runs",
        summary: "List work-order runs filtered by line, work order, or status",
        query: "lineCode, workOrderCode, status, fromDate, toDate, page, pageSize, sort",
        response: "ApiListEnvelope<MesRunDto>",
      },
      {
        method: "POST",
        path: "/mes/runs",
        summary: "Start or stop a run for a work order",
        request: "ActionEnvelope<'start' | 'stop', { lineCode: string; workOrderCode: string; reason?: string }>",
        response: "ApiMutationEnvelope<MesRunDto>",
      },
      {
        method: "GET",
        path: "/mes/runs/{id}",
        summary: "Get a run with its current OEE, downtime minutes, and station progress",
        response: "ApiEnvelope<MesRunDto & { recentEvents: StationEventDto[]; openDowntimes: DowntimeDto[] }>",
      },
      {
        method: "POST",
        path: "/mes/runs/{id}/close",
        summary: "Close a run and mark the work order as closed",
        request: "ActionEnvelope<'close', MesRunCloseRequest>",
        response: "ApiMutationEnvelope<MesRunDto>",
      },
      // Feeder bindings
      {
        method: "GET",
        path: "/mes/feeder-bindings",
        summary: "List feeder bindings filtered by work order, line, or machine",
        query: "workOrderCode, lineCode, machineCode, bound, page, pageSize, sort",
        response: "ApiListEnvelope<FeederBindingDto>",
      },
      {
        method: "POST",
        path: "/mes/feeder-bindings",
        summary: "Bind a material lot to a feeder slot on a machine",
        request: "ActionEnvelope<'bind', BindFeederRequest>",
        response: "ApiMutationEnvelope<FeederBindingDto>",
      },
      {
        method: "PATCH",
        path: "/mes/feeder-bindings/{id}",
        summary: "Update a feeder binding (e.g. release or unbind)",
        request: "ActionEnvelope<'release' | 'unbind', { reason?: string }>",
        response: "ApiMutationEnvelope<FeederBindingDto>",
      },
      {
        method: "DELETE",
        path: "/mes/feeder-bindings/{id}",
        summary: "Remove a feeder binding and return the slot to unbound state",
        response: "ApiMutationEnvelope<FeederBindingDto>",
      },
      // PCB serials
      {
        method: "GET",
        path: "/mes/pcb-serials",
        summary: "List PCB serials filtered by work order, line, or status",
        query: "workOrderCode, lineCode, status, page, pageSize, sort",
        response: "ApiListEnvelope<PcbSerialDto>",
      },
      {
        method: "POST",
        path: "/mes/pcb-serials",
        summary: "Register a new PCB serial against a work order",
        request: "ActionEnvelope<'register', CreatePcbSerialRequest>",
        response: "ApiMutationEnvelope<PcbSerialDto>",
      },
      {
        method: "GET",
        path: "/mes/pcb-serials/{serialNo}",
        summary: "Get a PCB serial with its full station-event history",
        response: "ApiEnvelope<{ pcb: PcbSerialDto; events: StationEventDto[] }>",
      },
      // Station events
      {
        method: "GET",
        path: "/mes/events",
        summary: "List station events filtered by type, line, work order, or PCB serial",
        query: "lineCode, workOrderCode, pcbSerial, eventType, fromDate, toDate, page, pageSize, sort",
        response: "ApiListEnvelope<StationEventDto>",
      },
      {
        method: "POST",
        path: "/mes/events",
        summary: "Append a station event (scan-in, scan-out, output, defect)",
        request: "ActionEnvelope<'feeder_bind' | 'station_scan' | 'output' | 'downtime', CreateStationEventRequest>",
        response: "ApiMutationEnvelope<StationEventDto>",
      },
      // Downtime
      {
        method: "GET",
        path: "/mes/downtimes",
        summary: "List downtime events filtered by line, status, or date range",
        query: "lineCode, status, fromDate, toDate, page, pageSize, sort",
        response: "ApiListEnvelope<DowntimeDto>",
      },
      {
        method: "POST",
        path: "/mes/downtimes",
        summary: "Open a new downtime event for a line",
        request: "ActionEnvelope<'open', CreateDowntimeRequest>",
        response: "ApiMutationEnvelope<DowntimeDto>",
      },
      {
        method: "PATCH",
        path: "/mes/downtimes/{id}",
        summary: "Close an open downtime event with action taken and operator",
        request: "ActionEnvelope<'close', CloseDowntimeRequest>",
        response: "ApiMutationEnvelope<DowntimeDto>",
      },
      // Cross-cutting
      {
        method: "GET",
        path: "/mes/trace/{serialNo}",
        summary: "Return the end-to-end trace for a PCB serial: events + material bindings",
        response: "ApiEnvelope<{ pcb: PcbSerialDto; events: StationEventDto[]; materialBindings: FeederBindingDto[] }>",
      },
      // Stagnation tracking
      {
        method: "GET",
        path: "/mes/stagnation",
        summary: "List product stagnation logs with filters",
        query: "customer, model, fromStation, toStation, poNumber, lineCode, overdueMonths, status, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/mes/stagnation/check",
        summary: "Re-calculate dwell time from station flow records and sync product stagnation logs",
        response: "ApiEnvelope<{ synced: number }>",
      },
      {
        method: "GET",
        path: "/mes/stagnation/thresholds",
        summary: "Get stagnation thresholds per station",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/mes/stagnation/thresholds",
        summary: "Upsert a stagnation threshold entry",
        request: "ActionEnvelope<'upsert', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PATCH",
        path: "/mes/stagnation/{id}/resolve",
        summary: "Mark a stagnation log as resolved",
        request: "ActionEnvelope<'resolve', { resolution?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "quality",
    name: "Quality inspection and closure",
    purpose: "Inspection records, defect capture, repair, re-inspection, and abnormal closure.",
    endpoints: [
      {
        method: "GET",
        path: "/quality/records",
        summary: "List inspection, defect, and repair records across stations",
        query: "station, workOrderCode, pcbSerial, result, defectCode, fromDate, toDate, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/quality/records",
        summary: "Create an inspection, defect, or repair record",
        request: "ActionEnvelope<'inspection' | 'repair' | 'reinspect', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PATCH",
        path: "/quality/records/{id}",
        summary: "Update a quality record state such as close, void, or reopen",
        request: "ActionEnvelope<'transition', { status: string; reason?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/quality/defect-pareto",
        summary: "Summarize defect loss by station and defect code",
        query: "station, workOrderCode, fromDate, toDate, locale",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "traceability",
    name: "End to end traceability",
    purpose: "Read model for PO to shipment chains plus the append-only event feed that powers it.",
    endpoints: [
      {
        method: "GET",
        path: "/traceability/{traceKey}",
        summary: "Return the full trace chain for a PO, work order, PCB serial, reel, lot, or shipment",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/traceability/events",
        summary: "List trace events for audit and troubleshooting",
        query: "traceKey, eventType, fromDate, toDate, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/traceability/events",
        summary: "Append a trace event from a normal business transaction or external import",
        request: "ActionEnvelope<'append', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "reports",
    name: "Management reports",
    purpose: "Parameter-driven reporting for execution, inventory, quality, and delivery risk.",
    endpoints: [
      {
        method: "GET",
        path: "/reports",
        summary: "List report definitions available to the current role",
        query: "locale",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/work-order-progress",
        summary: "R1 — Work order progress: planned vs completed qty, status, material readiness",
        query: "fromDate, toDate, lineCode, workOrderCode, status, page, pageSize",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/inventory-ledger",
        summary: "R2 — Inventory ledger: current stock per material lot with location",
        query: "materialCode, locationCode, fromDate, toDate, page, pageSize",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/material-movement",
        summary: "R3 — Material movement: full inventory transaction log",
        query: "materialCode, workOrderCode, action, fromDate, toDate, page, pageSize",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/iqc-summary",
        summary: "R4 — IQC summary: lot counts and qty by status per material and supplier",
        query: "supplierCode, materialCode, fromDate, toDate, page, pageSize",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/oee-by-line",
        summary: "R5 — OEE by line: daily availability, performance, quality per line",
        query: "lineCode, fromDate, toDate, page, pageSize",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/defect-analysis",
        summary: "R6 — Defect analysis: fail counts by defect code and station",
        query: "station, workOrderCode, fromDate, toDate, page, pageSize",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/material-balance",
        summary: "R7 — Material balance: received, issued, scrapped, and balance per material",
        query: "materialCode, supplierCode, fromDate, toDate, page, pageSize",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/delivery-risk",
        summary: "R8 — Delivery risk: open POs with balance qty and risk level",
        query: "customerCode, fromDate, toDate, page, pageSize",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/{reportKey}",
        summary: "Run a named report with a shared filter model",
        query: "locale, fromDate, toDate, lineCode, workOrderCode, materialCode, supplierCode, customerCode, status, page, pageSize, sort",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/reports/{reportKey}/export",
        summary: "Export a named report in a downloadable format",
        query: "locale, fromDate, toDate, lineCode, workOrderCode, format",
        response: "ApiEnvelope<{ downloadUrl: string }>",
      },
    ],
  },
  {
    key: "admin",
    name: "Security and factory settings",
    purpose: "Users, roles, permissions, audit logs, and shared operational settings.",
    endpoints: [
      {
        method: "GET",
        path: "/admin/users",
        summary: "List factory users, roles, status, and locale",
        query: "q, roleKey, status, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/admin/users",
        summary: "Create a factory user",
        request: "ActionEnvelope<'create', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PATCH",
        path: "/admin/users/{userId}",
        summary: "Update user profile, role, locale, or status",
        request: "ActionEnvelope<'update', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/admin/roles",
        summary: "List role and menu permission matrix",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "PATCH",
        path: "/admin/roles/{roleKey}",
        summary: "Update a role permission set",
        request: "ActionEnvelope<'update', { permissions: FactoryPermissionKey[] }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/admin/audit-logs",
        summary: "Search auditable user and system actions",
        query: "actor, eventType, status, fromDate, toDate, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/admin/settings",
        summary: "Read factory-wide settings such as shifts, calendars, and code rules",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "PATCH",
        path: "/admin/settings",
        summary: "Update factory-wide settings",
        request: "ActionEnvelope<'update', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "hr",
    name: "Human Resources",
    purpose: "Employee records, shift scheduling, attendance clock-in/out, daily and monthly attendance views, leave balances, departments.",
    endpoints: [
      {
        method: "GET",
        path: "/hr/departments",
        summary: "List departments with manager",
        query: "q, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/hr/employees",
        summary: "List employees with department and position",
        query: "q, departmentId, status, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/hr/employees/{id}",
        summary: "Get a single employee",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/hr/shifts",
        summary: "List active shifts",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/hr/shift-schedules",
        summary: "Get shift schedules by date, employee, or department",
        query: "date, employeeId, departmentId, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/hr/shift-schedules",
        summary: "Assign an employee to a shift on a date",
        request: "ActionEnvelope<'assign', { employeeId: string; shiftId: string; date: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PATCH",
        path: "/hr/shift-schedules/{id}",
        summary: "Swap a shift assignment",
        request: "ActionEnvelope<'swap', { shiftId: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "DELETE",
        path: "/hr/shift-schedules/{id}",
        summary: "Delete a shift assignment",
        response: "ApiEnvelope<{ deleted: true }>",
      },
      {
        method: "POST",
        path: "/hr/attendance/clock-in",
        summary: "Employee clock-in",
        request: "ActionEnvelope<'clock-in', { employeeId: string; workstationId?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/hr/attendance/clock-out",
        summary: "Employee clock-out",
        request: "ActionEnvelope<'clock-out', { employeeId: string; workstationId?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/hr/attendance/daily",
        summary: "Daily attendance list",
        query: "date, lineCode, departmentId, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/hr/attendance/sync",
        summary: "Batch sync punch records from attendance machine",
        request: "ActionEnvelope<'sync', { records: Record<string, unknown>[] }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/hr/attendance/monthly/{employeeId}",
        summary: "Monthly attendance for one employee",
        query: "year, month",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/hr/attendance/shift-summary",
        summary: "Daily attendance summary grouped by shift",
        query: "date",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/hr/leave-balances/{employeeId}",
        summary: "Leave balances for current year",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "service",
    name: "Customer Service Agents",
    purpose: "AI-powered customer service agents for virtual customer support.",
    endpoints: [
      {
        method: "GET",
        path: "/service/agents",
        summary: "List all available customer service agent IDs and names",
        response: "ApiEnvelope<{ agents: { id: string; name: string; persona: string }[] }>",
      },
      {
        method: "POST",
        path: "/service/chat/{agentId}",
        summary: "Chat with a specific customer service agent",
        request: "ActionEnvelope<'chat', { message: string; history?: Record<string, unknown>[] }>",
        response: "ApiEnvelope<{ reply: string; agentId: string }>",
      },
    ],
  },
  {
    key: "maintenance",
    name: "Equipment maintenance and facilities management",
    purpose: "Equipment master, maintenance orders, inspection records, calibration, and facilities monitoring.",
    endpoints: [
      {
        method: "GET",
        path: "/maintenance/dashboard",
        summary: "Aggregated equipment and maintenance KPIs",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/equipment",
        summary: "List equipment assets with status filter",
        query: "status, q, locale, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/equipment/{id}",
        summary: "Single equipment detail",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/records",
        summary: "List maintenance orders with status and type filters",
        query: "status, type, equipmentNo, fromDate, toDate, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/maintenance/records",
        summary: "Create a new maintenance or work order",
        request: "ActionEnvelope<'create', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PATCH",
        path: "/maintenance/records/{id}",
        summary: "Update maintenance record status, result, cost",
        request: "ActionEnvelope<'update', { status?: string; result?: string; cost?: number }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },

      // ── Work Orders ─────────────────────────────────────────────────────
      {
        method: "GET",
        path: "/maintenance/work-orders",
        summary: "List work orders with status/priority/equipment filters",
        query: "status, priority, equipmentId, fromDate, toDate, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/work-orders/stats/summary",
        summary: "Work order dashboard metrics",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/work-orders/stats/technician",
        summary: "Per-technician workload statistics",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/work-orders/{id}",
        summary: "Single work order detail",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/maintenance/work-orders",
        summary: "Create a new work order",
        request: "ActionEnvelope<'create', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PUT",
        path: "/maintenance/work-orders/{id}/status",
        summary: "Transition work order status with reason/notes",
        request: "ActionEnvelope<'transition', { status: string; reason?: string; notes?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PUT",
        path: "/maintenance/work-orders/{id}/assign",
        summary: "Assign technician to work order",
        request: "ActionEnvelope<'assign', { technician: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PUT",
        path: "/maintenance/work-orders/{id}/parts",
        summary: "Record parts used in work order",
        request: "ActionEnvelope<'parts', { parts: Record<string, unknown>[] }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "DELETE",
        path: "/maintenance/work-orders/{id}",
        summary: "Cancel/void a work order",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },

      // ── Checking Lists ──────────────────────────────────────────────────
      {
        method: "GET",
        path: "/maintenance/checklists/templates",
        summary: "List checklist templates",
        query: "equipmentType, frequency, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/checklists/templates/{id}",
        summary: "Single template with items",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/maintenance/checklists/templates",
        summary: "Create template + items",
        request: "ActionEnvelope<'create', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PUT",
        path: "/maintenance/checklists/templates/{id}",
        summary: "Update template",
        request: "ActionEnvelope<'update', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "DELETE",
        path: "/maintenance/checklists/templates/{id}",
        summary: "Deactivate template",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/checklists/records",
        summary: "List checking records",
        query: "equipmentId, templateId, checkDate, inspectorName, shiftType, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/checklists/records/{id}",
        summary: "Single record with details",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/maintenance/checklists/records",
        summary: "Create checking record",
        request: "ActionEnvelope<'create', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PUT",
        path: "/maintenance/checklists/records/{id}/items",
        summary: "Update item result",
        request: "ActionEnvelope<'item-result', { itemId: string; result: string; numericValue?: number; notes?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PUT",
        path: "/maintenance/checklists/records/{id}/complete",
        summary: "Complete record, auto-calc, create WOs",
        request: "ActionEnvelope<'complete', { notes?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PUT",
        path: "/maintenance/checklists/records/{id}/verify",
        summary: "Supervisor verify",
        request: "ActionEnvelope<'verify', { verifiedBy: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/checklists/compliance/daily",
        summary: "Today's compliance summary",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/checklists/compliance/missed",
        summary: "Missed checklists",
        query: "fromDate, toDate, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/checklists/compliance/by-equipment",
        summary: "Per-equipment compliance stats",
        query: "fromDate, toDate",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/maintenance/checklists/schedule",
        summary: "View schedule for date/equipment",
        query: "date, equipmentId, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/maintenance/checklists/schedule/generate",
        summary: "Generate schedule from templates",
        request: "ActionEnvelope<'generate', { from: string; to: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "spare-parts",
    name: "Spare Parts Warehouse & Wear Management",
    purpose: "Spare parts inventory, wear schedule, consumption logging, low-stock alerts, and supplier communications.",
    endpoints: [
      {
        method: "GET",
        path: "/spare-parts",
        summary: "List all spare parts with optional filters",
        query: "q, equipmentModel, status, minStock, page, pageSize, sort",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/spare-parts/low-stock",
        summary: "Parts where current_stock < min_stock",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/spare-parts/wear-alerts",
        summary: "Active parts wear alerts",
        query: "acknowledged, severity, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/spare-parts/wear-schedule",
        summary: "Parts wear schedule per equipment",
        query: "equipmentId, wearStatus, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/spare-parts/consumption",
        summary: "Parts consumption history",
        query: "partId, from, to, page, pageSize",
        response: "ApiListEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/spare-parts/stats/summary",
        summary: "KPI summary for spare parts dashboard",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/spare-parts/:id",
        summary: "Single spare part detail",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/spare-parts",
        summary: "Create a new spare part",
        request: "ActionEnvelope<'create', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PUT",
        path: "/spare-parts/:id",
        summary: "Update spare part",
        request: "ActionEnvelope<'update', Record<string, unknown>>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/spare-parts/:id/consume",
        summary: "Record parts consumption",
        request: "ActionEnvelope<'consume', { quantity: number; equipmentId?: string; workOrderCode?: string; reason: string; operatorName?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "PUT",
        path: "/spare-parts/:id/replace",
        summary: "Record part replacement and update wear schedule",
        request: "ActionEnvelope<'replace', { equipmentId: string; installedAt?: string; runningHours?: number; replaceIntervalHours?: number; nextReplaceDue?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/spare-parts/:id/acknowledge",
        summary: "Acknowledge a wear alert",
        request: "ActionEnvelope<'acknowledge', { alertId: string; operatorName?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "POST",
        path: "/spare-parts/:id/adjust-stock",
        summary: "Manual stock adjustment",
        request: "ActionEnvelope<'adjust', { adjustment: number; reason?: string; operatorName?: string }>",
        response: "ApiMutationEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/spare-parts/lifespan",
        summary: "All parts with real-time wear percentage and life remaining",
        response: "ApiEnvelope<{ items: Record<string, unknown>[]; fleetSummary: Record<string, unknown> }>",
      },
      {
        method: "GET",
        path: "/spare-parts/lifespan/summary",
        summary: "Fleet-wide lifespan summary statistics",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
      {
        method: "GET",
        path: "/spare-parts/lifespan/overdue",
        summary: "Parts overdue for replacement",
        response: "ApiEnvelope<{ items: Record<string, unknown>[]; total: number }>",
      },
      {
        method: "GET",
        path: "/spare-parts/lifespan/:id",
        summary: "Single part lifespan detail with timeline",
        response: "ApiEnvelope<Record<string, unknown>>",
      },
    ],
  },
  {
    key: "equipment-suppliers",
    name: "Equipment Supplier Communications",
    purpose: "Equipment OEM/ODM supplier records and communication logs.",
    endpoints: [
      { method: "GET", path: "/equipment-suppliers", summary: "List all equipment suppliers", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "POST", path: "/equipment-suppliers", summary: "Create equipment supplier", request: "ActionEnvelope<'create', Record<string, unknown>>", response: "ApiMutationEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/equipment-supplier-comms", summary: "List equipment supplier communications", query: "supplier_id, status, comm_type", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "POST", path: "/equipment-supplier-comms", summary: "Log equipment supplier communication", request: "ActionEnvelope<'log', Record<string, unknown>>", response: "ApiMutationEnvelope<Record<string, unknown>>" },
    ],
  },
  {
    key: "parts-suppliers",
    name: "Parts Supplier Communications",
    purpose: "Spare parts supplier records and communication logs.",
    endpoints: [
      { method: "GET", path: "/parts-suppliers", summary: "List all parts suppliers", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/parts-supplier-comms", summary: "List parts supplier communications", query: "supplier_id, part_id, status", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "POST", path: "/parts-supplier-comms", summary: "Log parts supplier communication", request: "ActionEnvelope<'log', Record<string, unknown>>", response: "ApiMutationEnvelope<Record<string, unknown>>" },
    ],
  },
  {
    key: "parts-pricing",
    name: "Parts Pricing Management",
    purpose: "Spare parts pricing history, supplier quotes, and stale price detection.",
    endpoints: [
      { method: "GET", path: "/parts-pricing", summary: "Current prices for all parts", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/parts-pricing/:partId/history", summary: "Price history for a part", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "POST", path: "/parts-pricing", summary: "Record a new price entry", request: "ActionEnvelope<'record', Record<string, unknown>>", response: "ApiMutationEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/parts-pricing/stale", summary: "Parts with stale pricing (>90 days)", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/supplier-quotes", summary: "List supplier quotes", query: "part_id, supplier_id, status", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "POST", path: "/supplier-quotes", summary: "Record a supplier quote", request: "ActionEnvelope<'record', Record<string, unknown>>", response: "ApiMutationEnvelope<Record<string, unknown>>" },
    ],
  },
  {
    key: "equipment-archives",
    name: "Equipment Archives",
    purpose: "Per-equipment archival record: running hours, status history, wear history, maintenance log.",
    endpoints: [
      { method: "GET", path: "/equipment-archives", summary: "List all equipment archives", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/equipment-archives/stats/summary", summary: "Fleet-wide equipment statistics", response: "ApiEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/equipment-archives/:id", summary: "Single equipment archive", response: "ApiEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/equipment-archives/:id/status-history", summary: "Status change history for equipment", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/equipment-archives/:id/hours-log", summary: "Running hours log for equipment", response: "ApiListEnvelope<Record<string, unknown>>" },
      { method: "GET", path: "/equipment-archives/:id/wear-history", summary: "Wear history for equipment", response: "ApiListEnvelope<Record<string, unknown>>" },
    ],
  },
  {
    key: "pda",
    name: "PDA Device Management",
    purpose: "PDA devices, assignments, repairs, managed applications, heartbeats and immutable operational audit.",
    endpoints: pdaModule.routes.map(({ method, path, summary }) => ({
      method,
      path,
      summary,
      response: "ApiEnvelope<Record<string, unknown>>",
    })),
  },
];
