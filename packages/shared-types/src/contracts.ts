import type { Locale, MultilingualText } from "./factory";

export type ApiListQuery = {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  lineCode?: string;
  workOrderCode?: string;
  traceKey?: string;
  page?: number;
  pageSize?: number;
};

export type ApiPageResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type ApiMutationResponse<T> = {
  data: T;
  message?: string;
  warnings?: string[];
  traceKey?: string;
};

export type InventoryAction =
  | "RECEIVE"
  | "IQC_RELEASE"
  | "PUT_AWAY"
  | "RESERVE"
  | "PICK"
  | "ISSUE_TO_LINE"
  | "RETURN_FROM_LINE"
  | "SCRAP"
  | "ADJUST";

export type WorkOrderType = 1 | 2 | 3;

export type UserDto = {
  id: string;
  username: string;
  displayName: string;
  roleId: string;
  roleCode: string;
  roleName: MultilingualText;
  locale: Locale;
  status: "active" | "disabled";
};

export type PermissionDto = {
  key: string;
  name: MultilingualText;
  scope: "menu" | "action" | "api";
};

export type RoleDto = MultilingualText & {
  id: string;
  code: string;
  permissions: string[];
  status: "active" | "inactive";
};

export type CustomerDto = MultilingualText & {
  id: string;
  code: string;
  status: "active" | "inactive";
};

export type SupplierDto = MultilingualText & {
  id: string;
  code: string;
  status: "active" | "inactive";
};

export type ProductDto = MultilingualText & {
  id: string;
  code: string;
  revision: string;
  status: "active" | "inactive";
};

export type ProductIdentifierType = "PCBA_SN" | "SHELL_SN" | "OTHER";
export type ProductLifecycleState =
  | "IDENTITY_INCOMPLETE" | "IN_PRODUCTION" | "HOLD"
  | "COMPLETED" | "SCRAPPED" | "DESTROYED" | "CANCELLED";
export type ProductGateState = "ALLOW" | "HOLD" | "REJECT" | "REPAIR_ROUTE" | "COMPLETED";

export type ProductIdentifierDto = {
  identityId: string;
  identityType: ProductIdentifierType;
  value: string;
  status: "ACTIVE" | "REPLACED" | "REVOKED";
  effectiveFrom: string;
  effectiveTo?: string;
};

export type ProductUnitDto = {
  productId: string;
  workOrderCode: string;
  productCode: string;
  lineCode: string;
  lifecycleState: ProductLifecycleState;
  identifiers: ProductIdentifierDto[];
  currentStationCode?: string;
  expectedStationCode?: string;
  routeRevision: string;
  activeNgCaseIds: string[];
  createdAt: string;
};

export type ProductGateRequest = {
  identifier: string;
  identifierType?: ProductIdentifierType;
  stationCode: string;
  workOrderCode?: string;
  operatorId: string;
  agentId: string;
  hostIp: string;
  occurredAt: string;
  idempotencyKey: string;
};

export type ProductGateDecisionDto = {
  decisionId: string;
  productId?: string;
  gateState: ProductGateState;
  allowed: boolean;
  reasonCode: string;
  nextAction: string;
  destinationStationCode?: string;
  missingStationCodes?: string[];
  missingIdentityTypes?: ProductIdentifierType[];
  authorizationId?: string;
  routeRevision?: string;
  decidedAt: string;
};

export type MaterialDto = MultilingualText & {
  id: string;
  code: string;
  uom: string;
  materialType: string;
  status: "active" | "inactive";
};

export type BomLineDto = {
  id: string;
  bomId: string;
  materialId: string;
  materialCode: string;
  chinaMaterialCode?: string;
  qtyPer: number;
  lossRate: number;
  referenceDesignators?: string;
};

export type BomDto = {
  id: string;
  productId: string;
  productCode: string;
  revision: string;
  status: "draft" | "active" | "obsolete";
  lines: BomLineDto[];
};

export type ProductionLineDto = MultilingualText & {
  id: string;
  internalCode: string;
  lineCode: string;
  status: "running" | "changeover" | "down" | "idle";
};

export type StationDto = MultilingualText & {
  id: string;
  lineId: string;
  code: string;
  stationType: string;
};

export type MachineDto = {
  id: string;
  lineId: string;
  code: string;
  machineType: string;
  status: "ready" | "down" | "maintenance";
};

export type StorageLocationDto = MultilingualText & {
  id: string;
  code: string;
  area: string;
  status: "active" | "inactive";
};

export type CustomerPoDto = {
  id: string;
  poNumber: string;
  customerId: string;
  customerCode: string;
  customerName: MultilingualText;
  productId: string;
  productCode: string;
  productName: MultilingualText;
  orderQty: number;
  dueDate: string;
  status: "confirmed" | "released" | "closed" | "cancelled";
};

export type CreateCustomerPoRequest = {
  poNumber: string;
  customerCode: string;
  productCode: string;
  orderQty: number;
  dueDate: string;
  status?: "confirmed" | "released";
};

export type WorkOrderDto = {
  id: string;
  code: string;
  customerPoId: string;
  poNumber: string;
  customerCode: string;
  productId: string;
  productCode: string;
  lineId: string;
  lineCode: string;
  workOrderType: WorkOrderType;
  plannedQty: number;
  completedQty: number;
  status: "draft" | "released" | "running" | "hold" | "closed" | "cancelled" | "voided";
  releasedAt?: string;
  closedAt?: string;
  firstArticleStatus: "pending" | "passed" | "failed";
  materialReadyPct?: number;
};

export type CreateWorkOrderRequest = {
  customerPoNumber: string;
  productCode: string;
  lineCode: string;
  workOrderType: WorkOrderType;
  plannedQty: number;
};

export type ReleaseWorkOrderRequest = {
  workOrderCode: string;
  releasedBy: string;
  releasedAt?: string;
};

export type MaterialLotDto = MultilingualText & {
  id: string;
  materialId: string;
  materialCode: string;
  supplierId: string;
  supplierCode: string;
  lotNo: string;
  receivedQty: number;
  iqcStatus: "pending" | "hold" | "released" | "rejected";
  currentLocationId?: string;
  currentLocationCode?: string;
  qtyOnHand?: number;
  reservedQty?: number;
};

export type ReceiveMaterialRequest = {
  materialCode: string;
  supplierCode: string;
  lotNo: string;
  receivedQty: number;
  operator: string;
  receivingLocationCode?: string;
};

export type PutAwayRequest = {
  lotNo: string;
  quantity: number;
  toLocationCode: string;
  operator: string;
};

export type ReserveMaterialRequest = {
  lotNo: string;
  workOrderCode: string;
  quantity: number;
  operator: string;
};

export type PickMaterialRequest = {
  lotNo: string;
  workOrderCode: string;
  quantity: number;
  operator: string;
};

export type IssueToLineRequest = {
  lotNo: string;
  workOrderCode: string;
  quantity: number;
  fromLocationCode?: string;
  toLocationCode?: string;
  operator: string;
};

export type ReturnFromLineRequest = {
  lotNo: string;
  workOrderCode: string;
  quantity: number;
  fromLocationCode?: string;
  toLocationCode?: string;
  operator: string;
};

export type ScrapMaterialRequest = {
  lotNo: string;
  workOrderCode?: string;
  quantity: number;
  reasonCode?: string;
  operator: string;
};

export type InventoryTransactionDto = {
  id: string;
  txNo: string;
  action: InventoryAction;
  materialLotId: string;
  lotNo: string;
  workOrderId?: string;
  workOrderCode?: string;
  qty: number;
  fromLocationId?: string;
  fromLocationCode?: string;
  toLocationId?: string;
  toLocationCode?: string;
  operatorId: string;
  operatorName?: string;
  occurredAt: string;
  status?: "posted" | "voided";
};

export type FeederBindingDto = {
  id: string;
  workOrderId: string;
  workOrderCode: string;
  lineId: string;
  lineCode: string;
  machineId: string;
  machineCode: string;
  materialLotId: string;
  lotNo: string;
  feederNo: string;
  reelCode: string;
  operatorId: string;
  operatorName?: string;
  boundAt: string;
  unboundAt?: string;
};

export type BindFeederRequest = {
  workOrderCode: string;
  lineCode: string;
  machineCode: string;
  lotNo: string;
  feederNo: string;
  reelCode: string;
  operator: string;
};

export type PcbSerialDto = {
  id: string;
  serialNo: string;
  workOrderId: string;
  workOrderCode: string;
  status: "wip" | "passed" | "failed" | "scrapped" | "closed";
  createdAt: string;
};

export type StationEventDto = {
  id: string;
  pcbSerialId: string;
  pcbSerial: string;
  stationId: string;
  stationCode: string;
  stationType: string;
  machineId?: string;
  machineCode?: string;
  operatorId?: string;
  operatorName?: string;
  eventType: string;
  result: "PASS" | "FAIL" | "REPAIRING" | "CLOSED";
  occurredAt: string;
};

export type CreateStationEventRequest = {
  pcbSerial: string;
  stationCode: string;
  machineCode?: string;
  operator?: string;
  eventType: string;
  result: "PASS" | "FAIL" | "REPAIRING" | "CLOSED";
  occurredAt?: string;
};

export type ProcessRouteDto = {
  id: string;
  code: string;
  revision: string;
  status: "draft" | "active" | "superseded";
  productId: string;
  productCode: string;
  createdAt: string;
};

export type ProcessRouteStepDto = {
  stepNo: number;
  stationType: string;
  stationId?: string;
  stationCode?: string;
  requiredScan: boolean;
  requiredInspection: boolean;
  outputRule: "pass_through" | "route_fail_to_repair" | "close_work_order";
};

export type ProcessRouteDetailDto = ProcessRouteDto & {
  productNameZh?: string;
  productNameEn?: string;
  productNameVi?: string;
  steps: ProcessRouteStepDto[];
};

export type MesRunDto = {
  id: string;
  workOrderCode: string;
  workOrderType: WorkOrderType;
  productCode: string;
  lineCode: string;
  lineNameZh?: string;
  status: "draft" | "released" | "running" | "hold" | "closed" | "cancelled" | "voided";
  plannedQty: number;
  completedQty: number;
  oee?: number;
  currentStations?: number;
  downtimeMinutes?: number;
  startedAt?: string;
  closedAt?: string;
};

export type CreatePcbSerialRequest = {
  serialNo: string;
  workOrderCode: string;
};

export type DowntimeDto = {
  id: string;
  downtimeNo: string;
  lineCode?: string;
  stationCode?: string;
  reasonCode?: string;
  reasonDetail?: string;
  startAt: string;
  endAt?: string;
  status: "open" | "closed" | "voided";
  operatorId?: string;
  operatorName?: string;
  closedAt?: string;
};

export type CreateDowntimeRequest = {
  lineCode: string;
  stationCode?: string;
  reasonCode: string;
  reasonDetail?: string;
  operator: string;
};

export type CloseDowntimeRequest = {
  actionTaken: string;
  operator: string;
};

export type MesRunCloseRequest = {
  reason?: string;
  operator?: string;
};

export type QualityInspectionDto = {
  id: string;
  inspectionNo: string;
  workOrderId?: string;
  workOrderCode?: string;
  pcbSerialId?: string;
  pcbSerial?: string;
  stationType: "IQC" | "SPI" | "AOI" | "ICT" | "VISUAL";
  result: "PASS" | "FAIL" | "REPAIRING" | "CLOSED";
  defectCode?: string;
  defectName?: MultilingualText;
  operatorId: string;
  operatorName?: string;
  occurredAt: string;
};

export type CreateInspectionRequest = {
  stationType: "IQC" | "SPI" | "AOI" | "ICT" | "VISUAL";
  workOrderCode?: string;
  pcbSerial?: string;
  inspectionNo?: string;
  result: "PASS" | "FAIL" | "REPAIRING" | "CLOSED";
  defectCode?: string;
  operator: string;
  occurredAt?: string;
};

export type RepairRecordDto = {
  id: string;
  repairNo: string;
  inspectionId: string;
  inspectionNo: string;
  defectCodeId: string;
  defectCode: string;
  actionTaken: string;
  result: "open" | "closed" | "rework";
  operatorId: string;
  operatorName?: string;
  closedAt?: string;
};

export type CreateRepairRequest = {
  inspectionNo: string;
  defectCode: string;
  actionTaken: string;
  result: "closed" | "rework";
  operator: string;
};

export type TraceEventDto = {
  id: string;
  traceKey: string;
  eventType: string;
  referenceNo: string;
  status: string;
  actor: string;
  eventPayload: Record<string, unknown>;
  occurredAt: string;
};

export type TraceabilityQueryResponse = {
  traceKey: string;
  rootType: "po" | "work_order" | "pcb_serial" | "material_lot" | "shipment";
  summary: string;
  events: TraceEventDto[];
};

export type TraceabilityQueryRequest = {
  traceKey: string;
};

export type ReportQueryRequest = {
  from: string;
  to: string;
  lineCode?: string;
  workOrderCode?: string;
  customerCode?: string;
  productCode?: string;
};

export type ReportCardDto = {
  key: string;
  value: string;
  tone: "ok" | "warning" | "danger" | "info" | "muted";
  trend: string;
};

export type CreateUserRequest = {
  username: string;
  displayName: string;
  roleCode: string;
  locale?: Locale;
  status?: "active" | "disabled";
};

export type UpsertRoleRequest = {
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  permissions: string[];
  status?: "active" | "inactive";
};
