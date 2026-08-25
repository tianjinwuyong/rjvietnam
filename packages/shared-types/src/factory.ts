// [Header: Keep documentation conventions but update code structure]

export type Locale = "zh-CN" | "vi-VN" | "en-US";

// ── Core shared types ────────────────────────────────────────────────────────

export type StatusTone = "ok" | "warning" | "danger" | "info" | "muted" | "idle";

/** Multilingual text with Chinese, English, and Vietnamese variants. */
export interface MultilingualText {
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
}

// ── IQC / WMS ───────────────────────────────────────────────────────────────

/**
 * IQC status — lowercase to match DB column values.
 * Flow: pending → hold (failed IQC) → released → rejected (scrapped)
 */
export type IqcStatus = "pending" | "hold" | "released" | "rejected";

/**
 * All valid WMS inventory actions matching inventory_transactions.action column.
 */
export type InventoryAction =
  | "RECEIVE" | "IQC_HOLD" | "IQC_RELEASE" | "IQC_REJECT"
  | "PUT_AWAY" | "RESERVE" | "PICK"
  | "ISSUE_TO_LINE" | "RETURN_FROM_LINE" | "SCRAP"
  | "ADJUST";

/**
 * MaterialLot — shape used by WMS UI components.
 * Fields `id`, `materialCode`, `qty`, `locationCode`, `name_zh/en/vi` are used by the frontend.
 * Fields `materialId`, `supplierCode`, `receivedQty`, `reservedQty` are used by the backend/inventory service.
 */
export interface MaterialLot {
  id?: number | string;
  materialId?: string;
  materialCode: string;
  supplierCode?: string;
  lotNo: string;
  /** Physical roll QR/SN registered by WMS (label_id). */
  labelId?: string;
  rollQr?: string;
  receivedQty?: number;
  qty?: number;
  availableQty?: number;
  iqcStatus: IqcStatus;
  reservedQty?: number;
  locationCode?: string | null;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
  createdAt?: string;
  /** 物料单位 */
  uom?: string;
  /** 生产日期 */
  manufacturingDate?: string;
  /** 失效日期 */
  expiryDate?: string;
  /** 收货日期（创建时间） */
  receivedDate?: string;
  /** 批次状态 */
  lotStatus?: string;
  lifecycleStatus?: string;
  /** PO单号 */
  poNo?: string;
}

export type AlertLevel = "EXPIRED" | "RED_L3" | "BLUE_L2" | "YELLOW_L1" | "NORMAL";

export interface LifecycleResult {
  expiryDate: string;
  usedMonths: number;
  remainingMonths: number;
  remainingDays: number;
  alertLevel: AlertLevel;
  statusLabel: string;
  statusColor: string;
}

export interface LifecycleLot extends MaterialLot {
  /** 生产日期 */
  manufacturingDate?: string;
  /** 封存有效期(月) — from materials.shelf_life_days / 30.44 */
  shelfLifeMonths: number;
  lifecycle: LifecycleResult;
}

export interface LifecycleAlertSummary {
  expired: number;
  redL3: number;
  blueL2: number;
  yellowL1: number;
  normal: number;
  total: number;
}

export interface StorageLocation {
  id: number | string;
  code: string;
  shelfCode?: string;
  area: string;
  status: string;
  locationType?: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
}

export interface InventoryTransaction {
  id?: number | string;
  txNo: string;
  action: InventoryAction;
  qty: number;
  txStatus?: "completed" | "voided" | "pending";
  materialLotId?: number | string;
  materialCode?: string;
  lotNo?: string;
  fromLocation?: string;
  toLocation?: string;
  workOrderCode?: string;
  operator?: string;
  referenceType?: string;
  referenceNo?: string;
  occurredAt: string;
  lots?: { lotNo: string }[];
}

export interface PickOrder {
  id: number | string;
  orderNo: string;
  workOrderCode: string;
  lineCode?: string;
  status: "pending" | "in_progress" | "completed" | "cancelled" | "issued" | "picking";
  operator?: string;
  createdAt: string;
  completedAt?: string;
  items: PickOrderItem[];
}

export interface PickOrderItem {
  id: number | string;
  pickOrderId?: number | string;
  materialCode: string;
  materialName?: MultilingualText | string;
  requiredQty: number;
  pickedQty?: number;
  lotNo?: string;
  locationCode?: string;
  status?: string;
}

export interface IssueLineItem {
  materialCode: string;
  materialName?: { name_zh?: string; name_en?: string } | string;
  lotNo: string;
  locationCode: string;
  requiredQty: number;
  pickedQty?: number;
  availableQty?: number;
}

export interface DashboardMetric {
  id: string;
  value: string;
  tone: StatusTone;
  trend: string;
}

// ── Production / MES ────────────────────────────────────────────────────────

export type StationSection = "smt" | "post_smt" | "packaging" | "oqc" | "auxiliary";

export type StationKey =
  | "printer" | "spi" | "ai1" | "ai2"
  | "mount1" | "mount2" | "reflow" | "smt_aoi" | "pcba_load" | "pda_load"
  | "ws_aoi" | "ict" | "fct" | "pcba_divide" | "pcba_link"
  | "ate1" | "ultrasonic" | "bi_loading" | "burn_in" | "hi_pot" | "ate2" | "code_link"
  | "packing" | "pallet_label"
  | "oqc_hi_pot" | "oqc_ate2" | "oqc_cosmetic" | "oqc_replace" | "oqc_report"
  | "barcode_convert" | "decoding" | "pcba_bake" | "visual_defect_upload" | "repair_report";

export interface StationDef {
  key: StationKey;
  name: MultilingualText;
  section: StationSection;
  integration: "hardware" | "software";
  description: MultilingualText;
}

export interface LineStationState {
  stationKey: StationKey;
  status: StatusTone;
  output?: number;
  cycleTime?: number;
  defectRate?: number;
}

export interface FactoryLine {
  id: string;
  lineCode: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  status: "running" | "changeover" | "down" | "idle";
  currentWorkOrderCode?: string;
  oee?: number;
  outputToday?: number;
  targetToday?: number;
}

// ── BOM / Product ─────────────────────────────────────────────────────────

export interface BomLine {
  id: number | string;
  bomId?: number | string;
  materialId?: string;
  materialCode: string;
  chinaMaterialCode?: string;
  materialCategory?: string;
  materialNameZh?: string;
  materialNameEn?: string;
  materialNameVi?: string;
  spec?: string;
  unit?: string;
  qtyPer?: number;
  lossRate?: number;
  referenceDesignators?: string[];
  position?: string;
}

export interface Bom {
  id: number | string;
  productId?: string;
  productCode?: string;
  productNameZh?: string;
  productNameEn?: string;
  productNameVi?: string;
  revision?: string;
  status?: "draft" | "active" | "obsolete";
  materialCount?: number;
  lineCount?: number;
  lines?: BomLine[];
}

export type BomEditAction = "CREATE" | "EDIT" | "IMPORT" | "DELETE";
export type BomEditSource = "FORM" | "EXCEL" | "API";

export interface BomEditHistoryEntry {
  id: number | string;
  bomId: number | string;
  action: BomEditAction;
  operatorId?: number | string;
  operatorName: string;
  operatedAt: string; // ISO timestamptz
  source: BomEditSource;
  snapshot: Bom; // full BOM state at time of action
  changeSummary?: string;
}

// ── Work Orders / PMC ─────────────────────────────────────────────────────

export interface WorkOrder {
  id: string;
  code: string;
  poNumber?: string;
  type?: 1 | 2 | 3; // 1=mass, 2=sample/trial, 3=rework
  lineCode?: string;
  productCode?: string;
  plannedQty?: number;
  completedQty?: number;
  status?: "draft" | "released" | "running" | "hold" | "closed" | "voided";
  materialReady?: number;
  bomId?: number | string;
  bomRevision?: string;
  firstArticle?: string;
  relatedWorkOrderCode?: string;
}

// ── Sales / Customer ────────────────────────────────────────────────────────

export interface CustomerPo {
  id: string;
  poNumber: string;
  customerCode?: string;
  productCode?: string;
  quantity?: number;
  dueDate?: string;
  risk?: string;
}

export interface SalesOrder {
  id: string;
  code?: string;
  soNo?: string;
  poNumber?: string;
  quoteNo?: string;
  customerCode?: string;
  currency?: string;
  totalAmount?: number;
  fulfilledPercent?: number;
  status?: string;
  type?: 1 | 2 | 3;
  lineCode?: string;
  productCode?: string;
  plannedQty?: number;
  completedQty?: number;
  materialReady?: number;
  firstArticle?: string;
  relatedWorkOrderCode?: string;
  lines?: {
    productCode?: string;
    productName?: MultilingualText | string;
    qty?: number;
    fulfilledQty?: number;
    unitPrice?: number;
    plannedDelivery?: string;
    workOrderCodes?: string[];
  }[];
  createdAt?: string;
  [key: string]: unknown;
}

export interface SalesQuote {
  id: string;
  quoteNo?: string;
  soNo?: string;
  poNo?: string;
  customerCode?: string;
  contactName?: string;
  currency?: string;
  totalAmount?: number;
  fulfilledPercent?: number;
  status?: string;
  validUntil?: string;
  acceptedAt?: string;
  workOrderCodes?: string[];
  lines?: {
    productCode?: string;
    productName?: MultilingualText | string;
    qty?: number;
    unitPrice?: number;
    leadTimeDays?: number;
    notes?: string;
  }[];
  createdAt?: string;
  [key: string]: unknown;
}

export interface ServiceTicket {
  id: string;
  ticketNumber?: string;
  ticketNo?: string;
  status?: string;
  customerCode?: string;
  category?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  subject?: string;
  slaDueAt?: string;
  assignee?: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  [key: string]: unknown;
}

export interface RmaRequest {
  id: string;
  rmaNumber?: string;
  customerCode?: string;
  productCode?: string;
  serialNo?: string;
  qty?: number;
  reasonCode?: string;
  customerComplaint?: string;
  receivedAt?: string;
  inspectionResult?: string;
  disposition?: string;
  status?: string;
  createdAt?: string;
}

export interface RmaRepairRecord {
  id: string;
  repairNumber?: string;
  status?: string;
  [key: string]: unknown;
}

// ── MES Repair Station ───────────────────────────────────────────────────────

export interface RepairRecord {
  id: string;
  sn: string;
  workOrderCode: string;
  stationCode: string;
  defectStationCode: string;
  defectDescription: string;
  repairOperator?: string;
  repairStartTime?: string;
  repairEndTime?: string;
  result?: "repaired" | "scraped" | "pending";
  notes?: string;
}

export interface QuoteConversionRow {
  id?: string;
  quoteId?: string;
  quoteNo?: string;
  customerCode?: string;
  acceptedAt?: string;
  soNo?: string;
  poNo?: string;
  workOrderCodes?: string[];
  status?: string;
  [key: string]: unknown;
}

// ── Finance ────────────────────────────────────────────────────────────────

export interface FinanceInvoiceSummary {
  invoiceId?: string;
  partyCode?: string;
  partyName?: MultilingualText | string;
  invoiceNo?: string;
  totalAmount?: number;
  paidAmount?: number;
  balanceAmount?: number;
  currency?: string;
  invoiceDate?: string;
  dueDate?: string;
  status?: string;
}

export interface PaymentRecord {
  id: string;
  paymentNo?: string;
  direction?: string;
  partyType?: string;
  partyId?: string;
  invoiceId?: string;
  amount?: number;
  currency?: string;
  paidAt?: string;
  method?: string;
  referenceNo?: string;
}

export interface CostSummary {
  workOrderCode?: string;
  productCode?: string;
  productName?: MultilingualText | string;
  materialCost?: number;
  laborCost?: number;
  overheadCost?: number;
  totalCost?: number;
  currency?: string;
  costStatus?: string;
  updatedAt?: string;
}

// ── QC / Quality ─────────────────────────────────────────────────────────

export interface InspectionRecord {
  id: string;
  station?: string;
  workOrderCode?: string;
  pcbSerial?: string;
  result?: "PASS" | "FAIL" | "REPAIRING" | "CLOSED";
  defectCode?: string;
  defectName?: MultilingualText;
  operator?: string;
  occurredAt?: string;
}

export interface IQCInspectionResult {
  id: string;
  lotNo?: string;
  status?: string;
  resultNotes?: string;
  [key: string]: unknown;
}

export interface SupplierKpiEntry {
  id: string;
  supplierCode?: string;
  score?: number;
  onTimeDelivery?: number;
  qualityRate?: number;
  [key: string]: unknown;
}

export interface QualityTrendPoint {
  id: string;
  period?: string;
  defectRate?: number;
  [key: string]: unknown;
}

// ── Supply Chain / WMS extended ──────────────────────────────────────────

export interface PoReceiveItem {
  id: string;
  poNumber?: string;
  materialCode?: string;
  materialName?: MultilingualText | string;
  expectedQty?: number;
  receivedQty?: number;
  unit?: string;
  status?: string;
}

export interface IQCTask {
  id: string;
  materialLotId?: string;
  materialCode?: string;
  lotNo?: string;
  supplierCode?: string;
  qty?: number;
  status?: string;
  priority?: string;
  assignedTo?: string;
  createdAt?: string;
  completedAt?: string;
  resultNotes?: string;
}

export interface ProductionReturn {
  id: string;
  returnNumber?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SupplementaryMaterial {
  id: string;
  workOrderCode?: string;
  materialCode?: string;
  materialName?: MultilingualText | string;
  requiredQty?: number;
  uom?: string;
  reason?: string;
  status?: string;
  requestedBy?: string;
  createdAt?: string;
}

export interface SupplierReturn {
  id: string;
  returnNumber?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SalesReturn {
  id: string;
  returnNumber?: string;
  status?: string;
  [key: string]: unknown;
}

export interface CycleCount {
  id: string;
  countNumber?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ExpiryAlert {
  id: string;
  lotNo?: string;
  materialCode?: string;
  expiryDate?: string;
  daysUntilExpiry?: number;
  status?: string;
}

export interface AgingItem {
  id: string;
  lotNo?: string;
  materialCode?: string;
  agingStatus?: string;
  [key: string]: unknown;
}

// ── MSD (Moisture Sensitive Device) ─────────────────────────────────────

export interface MsdMaterial {
  id: string;
  materialCode?: string;
  msdLevel?: string;
  floorLife?: number;
  [key: string]: unknown;
}

export interface MsdTask {
  id: string;
  materialLotId?: string;
  taskType?: string;
  status?: string;
  [key: string]: unknown;
}

export interface MsdBakingRecord {
  id: string;
  materialLotId?: string;
  bakeStart?: string;
  bakeEnd?: string;
  temperature?: number;
  status?: string;
}

// ── Traceability ──────────────────────────────────────────────────────────

export interface TraceEvent {
  id: string;
  sequence?: number;
  type?: string;
  ref?: string;
  status?: string;
  actor?: string;
  at?: string;
  details?: string;
}

export interface TraceNode {
  id: string;
  traceKey?: string;
  nodeType?: string;
  [key: string]: unknown;
}

// ── Aux Materials ──────────────────────────────────────────────────────────

export interface AuxMaterial {
  id: string;
  materialCode?: string;
  materialName?: MultilingualText | string;
  [key: string]: unknown;
}

export interface AuxLifecycleEvent {
  id: string;
  materialCode?: string;
  eventType?: string;
  occurredAt?: string;
  [key: string]: unknown;
}

// ── HR ───────────────────────────────────────────────────────────────────

export interface LeaveRequest {
  id: string;
  employeeId?: string;
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  totalDays?: number;
  reason?: string;
  status?: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface LeaveBalance {
  id: string;
  employeeId?: string;
  leaveType?: string;
  year?: number;
  totalDays?: number;
  usedDays?: number;
  pendingDays?: number;
  balanceDays?: number;
  availableDays?: number;
}

export interface Shift {
  id: string;
  shiftName?: string;
  startTime?: string;
  endTime?: string;
  durationHours?: number;
  isNightShift?: boolean;
  status?: string;
}

export interface Employee {
  id: string;
  employeeNo?: string;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
  departmentId?: string;
  positionTitle?: string;
  gender?: string;
  phone?: string;
  email?: string;
  joinDate?: string;
  status?: string;
  employmentType?: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId?: string;
  employeeNo?: string;
  employeeName?: MultilingualText | string;
  workDate?: string;
  clockIn?: string;
  clockOut?: string;
  status?: string;
  lateMinutes?: number;
  earlyMinutes?: number;
  otHours?: number;
}

export interface Department {
  id: string;
  code?: string;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
  headCount?: number;
  status?: string;
}

export interface Equipment {
  id: string;
  equipmentNo?: string;
  equipmentType?: string;
  model?: string;
  location?: string;
  installDate?: string;
  status?: string;
  lastMaintenanceDate?: string;
  nextMaintenanceDate?: string;
  responsiblePerson?: string;
  supplier?: string;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
}

export interface MaintenanceRecord {
  id: string;
  equipmentNo?: string;
  type?: string;
  priority?: string;
  status?: string;
  description?: string;
  scheduledDate?: string;
  completedDate?: string;
  operator?: string;
  result?: string;
  cost?: number;
}

// ── Machine Inspection / 点检 ───────────────────────────────────────────────

export interface InspectionTemplate {
  id: string;
  templateCode: string;
  machineType: string;
  templateName: string;
  shiftType: "day" | "night" | "any";
  frequencyType: "shift" | "daily" | "weekly" | "monthly";
  isActive: boolean;
  createdAt?: string;
  items?: InspectionTemplateItem[];
}

export interface InspectionTemplateItem {
  id: string;
  templateId: string;
  itemNo: number;
  checkPoint: string;
  checkMethod?: string;
  passCriteria?: string;
  failAction?: string;
  instrumentRequired?: string;
  isKeyPoint: boolean;
  isCriticalSafety: boolean;
}

export interface InspectionAssignment {
  id: string;
  assignmentNo: string;
  machineId: string;
  machineCode?: string;
  machineType?: string;
  templateId: string;
  templateName?: string;
  shiftDate: string;
  shiftType: "day" | "night";
  assignedTo?: string;
  assignedToName?: string;
  status: "pending" | "in_progress" | "completed" | "skipped" | "voided";
  scheduledStart?: string;
  scheduledEnd?: string;
  createdAt?: string;
}

export interface InspectionRecord {
  id: string;
  recordNo: string;
  assignmentId?: string;
  machineId: string;
  machineCode?: string;
  machineType?: string;
  lineId?: string;
  lineName?: string;
  templateId: string;
  templateName?: string;
  shiftDate: string;
  shiftType: "day" | "night";
  inspectorId: string;
  inspectorName?: string;
  startedAt?: string;
  completedAt?: string;
  overallResult: "pass" | "fail" | "conditional";
  totalItems: number;
  passedItems: number;
  failedItems: number;
  skippedItems: number;
  hasCriticalFail: boolean;
  notes?: string;
  createdAt?: string;
}

export interface InspectionRecordItem {
  id: string;
  recordId: string;
  itemNo: number;
  templateItemId: string;
  checkPoint?: string;
  result: "pass" | "fail" | "na" | "skipped";
  measuredValue?: string;
  notes?: string;
  photoUrl?: string;
  checkedAt?: string;
}

export interface InspectionAbnormal {
  id: string;
  abnormalNo: string;
  recordId?: string;
  recordItemId?: string;
  machineId: string;
  machineCode?: string;
  abnormalityType: "defect" | "hazard" | "critical_wear";
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "reported" | "acknowledged" | "resolved" | "closed";
  reportedBy?: string;
  reportedAt?: string;
  assignedTo?: string;
  resolvedAt?: string;
  resolution?: string;
  maintenanceOrderId?: string;
}

export interface MachineOeeLog {
  id: string;
  logDate: string;
  machineId: string;
  machineCode?: string;
  machineType?: string;
  lineId: string;
  lineName?: string;
  shiftType: "day" | "night";
  plannedProdHours: number;
  actualProdHours: number;
  downtimeMinutes: number;
  outputQty: number;
  defectQty: number;
  oeeAvailability: number;
  oeeQuality: number;
  oeeOverall: number;
  notes?: string;
}

export interface MachineStatusSnapshot {
  id: string;
  machineId: string;
  machineCode?: string;
  machineType?: string;
  status: "idle" | "running" | "maintenance" | "breakdown";
  currentProduct?: string;
  currentWorkOrder?: string;
  outputCounter?: number;
  defectCounter?: number;
  runningHours?: number;
  idleMinutesToday?: number;
  maintenanceMinutesToday?: number;
  breakdownMinutesToday?: number;
  lastUpdated?: string;
}

// ── PM Schedule / 保养计划 ───────────────────────────────────────────────────

export interface PmFrequency {
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  intervalDays: number;
  sortOrder: number;
  status: string;
}

export interface PmTemplate {
  id: string;
  templateCode: string;
  machineType: string;
  frequencyCode: string;
  frequencyName?: string;
  templateName: string;
  estDurationMinutes: number;
  requiresShutdown: boolean;
  requiresEngineer: boolean;
  isActive: boolean;
  createdAt?: string;
  tasks?: PmTemplateTask[];
}

export interface PmTemplateTask {
  id: string;
  templateId: string;
  taskNo: number;
  taskName: string;
  taskType: "check" | "clean" | "replace" | "calibrate" | "lubricate" | "test";
  description?: string;
  procedureRef?: string;
  requiresTool?: string;
  passCriteria?: string;
  isCritical: boolean;
}

export interface PmScheduleAssignment {
  id: string;
  assetId: string;
  assetCode?: string;
  machineCode?: string;
  machineType?: string;
  templateId: string;
  templateName?: string;
  frequencyCode: string;
  frequencyName?: string;
  nextDueDate: string;
  lastCompletedDate?: string;
  assignedTeam: string;
  isActive: boolean;
  createdAt?: string;
}

export interface PmExecutionLog {
  id: string;
  logNo: string;
  assignmentId?: string;
  maintenanceOrderId?: string;
  templateId: string;
  templateName?: string;
  assetId: string;
  assetCode?: string;
  scheduledDate: string;
  completedDate?: string;
  executedBy?: string;
  executedByName?: string;
  totalTasks: number;
  completedTasks: number;
  passedTasks: number;
  failedTasks: number;
  result: "pending" | "pass" | "conditional" | "fail";
  notes?: string;
  createdAt?: string;
}

// ── Station Integration (label printers, AOI, shift/recipe queries) ────────

/**
 * Scheduled shift for a production line.
 * Matches shift_schedules DB table and GET /api/shifts/:lineCode/:date response.
 */
export interface ShiftSchedule {
  id?: string | number;
  lineCode?: string;
  shiftDate?: string;
  shiftName: string;
  shiftStart: string;
  shiftEnd: string;
  status?: "scheduled" | "active" | "completed" | "cancelled";
  notes?: string | null;
  operators?: string[] | null;
}

/**
 * Machine program / recipe per product revision.
 * Matches recipes DB table and GET /api/recipes/:productCode/:revision response.
 */
export interface Recipe {
  id?: string | number;
  productCode?: string;
  revision: string;
  machineType: string;
  programData: Record<string, unknown>;
  feederPositions: FeederPosition[];
  status?: "active" | "inactive" | "draft";
  createdAt?: string;
  updatedAt?: string;
}

export interface FeederPosition {
  feederNo?: string;
  materialCode?: string;
  materialName?: string;
  lotNo?: string;
  slotPosition?: string;
}

/**
 * Per-product label template and barcode configuration.
 * Matches product_configs DB table and label printer config.
 */
export interface ProductConfig {
  id?: string | number;
  productCode?: string;
  revision?: string;
  labelTemplate: LabelTemplate;
  barcodeFormat: "CODE128" | "QR" | "DATA_MATRIX";
  status?: "active" | "inactive";
}

export interface LabelTemplate {
  templateName?: string;
  fields: LabelField[];
  logoUrl?: string | null;
}

export interface LabelField {
  key: string;
  label: string;
  font_size?: number;
  width?: number | string;
}

// ── Feeder ────────────────────────────────────────────────────────────────

export interface FeederBinding {
  id: string;
  workOrderCode?: string;
  lineCode?: string;
  machineCode?: string;
  feederNo?: string;
  materialCode?: string;
  reelCode?: string;
  operator?: string;
  boundAt?: string;
}

// ── Auth / RBAC ─────────────────────────────────────────────────────────

export type RoleKey =
  | "management" | "pmc" | "warehouse" | "iqc"
  | "smt_operator" | "engineering" | "quality" | "admin";

export type FactoryPermissionKey =
  | "dashboard.view"
  | "erp.view"
  | "pmc.view" | "pmc.manage"
  | "bom.view" | "bom.edit"
  | "wms.view" | "wms.receive" | "wms.iqc" | "wms.issue" | "wms.execute"
  | "mes.view" | "mes.execute"
  | "quality.view" | "quality.review"
  | "traceability.view" | "reports.view"
  | "finance.view" | "finance.manage"
  | "sales.view" | "sales.manage"
  | "service.view" | "service.manage"
  | "admin.view" | "admin.users.manage" | "admin.roles.manage"
  | "admin.audit.read" | "admin.settings.manage"
  | "auth.session.read" | "auth.session.manage"
  | "hr.employee.view" | "hr.employee.create" | "hr.employee.edit" | "hr.employee.delete"
  | "hr.attendance.view" | "hr.attendance.edit"
  | "hr.leave.view" | "hr.leave.approve"
  | "hr.report.view"   | "hr.department.manage"
  | "maintenance.view" | "maintenance.manage";

export type RolePermissionMatrix = Record<RoleKey, string[]>;

export type AuthUserStatus = "active" | "disabled";

export type AuthAuditSource = "api" | "station" | "web";

export type AuthAuditEventType =
  | "login_success" | "login_failure"
  | "password_reset_required" | "permission_denied"
  | "session_created" | "session_revoked";

export interface AuthAuditEvent {
  id: string;
  eventType: AuthAuditEventType;
  status: "success" | "failure";
  source: AuthAuditSource;
  actor: string;
  occurredAt: string;
  username?: string;
  userId?: string;
  roleKey?: RoleKey;
  sessionId?: string;
  permissionKey?: FactoryPermissionKey;
  reason?: string;
  details?: string;
}

export interface AuthDirectoryRecord {
  id: string;
  username: string;
  displayName: string;
  locale: Locale;
  roleKey: RoleKey;
  roleName: MultilingualText;
  status: AuthUserStatus;
}

export interface AuthSession {
  sessionId: string;
  accessToken: string;
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  rememberMe: boolean;
  user: AuthUserProfile;
}

export interface AuthUserProfile {
  id: string;
  username: string;
  displayName: string;
  locale: Locale;
  status: AuthUserStatus;
  role: {
    roleKey: RoleKey;
    roleName: MultilingualText;
  };
  permissions: readonly FactoryPermissionKey[];
}

export interface AuthCurrentUserResponse {
  user: AuthUserProfile;
  session: Pick<AuthSession, "sessionId" | "issuedAt" | "expiresAt" | "lastSeenAt" | "rememberMe">;
  permissions: readonly FactoryPermissionKey[];
}

export interface AuthLoginRequest {
  username: string;
  password: string;
  rememberMe?: boolean;
  deviceLabel?: string;
}

export interface AuthLoginResponse {
  session: AuthSession;
  auditEvent: AuthAuditEvent;
}


// ── Report System Types ─────────────────────────────────────────────────

export type ReportKey =
  | "work-order-progress"
  | "inventory-ledger"
  | "material-movement"
  | "iqc-summary"
  | "oee-by-line"
  | "defect-analysis"
  | "material-balance"
  | "delivery-risk";

export type ReportFilter = {
  dateFrom?: string;
  dateTo?: string;
  lineCode?: string;
  workOrderCode?: string;
  materialCode?: string;
  supplierCode?: string;
  iqcStatus?: IqcStatus;
  locale?: Locale;
};

export type ReportRow = Record<string, unknown>;

export type ReportResult = {
  key: ReportKey;
  title: MultilingualText;
  columns: { key: string; label: MultilingualText; format?: string }[];
  rows: ReportRow[];
  meta: {
    generatedAt: string;
    filter: ReportFilter;
    totalRows: number;
  };
};

export type WorkOrderProgressRow = {
  workOrderCode: string;
  productCode: string;
  lineCode: string;
  type: number;
  plannedQty: number;
  completedQty: number;
  progressPct: number;
  status: string;
  releasedAt: string | null;
  closedAt: string | null;
  customerName: MultilingualText;
  dueDate: string;
  materialReadyPct: number;
  firstArticle: string;
};

export type InventoryLedgerRow = {
  materialCode: string;
  materialName: MultilingualText;
  supplierCode: string;
  supplierName: MultilingualText;
  lotNo: string;
  iqcStatus: IqcStatus;
  initialQty: number;
  currentQty: number;
  locationCode: string;
  receivedAt: string;
  lastMovementAt: string | null;
  msdLevel: string | null;
  shelfLifeDays: number | null;
  reservedQty: number;
};

export type MaterialMovementRow = {
  txNo: string;
  action: string;
  materialCode: string;
  materialName: MultilingualText;
  lotNo: string;
  workOrderCode: string | null;
  qty: number;
  fromLocationCode: string | null;
  toLocationCode: string | null;
  operatorName: string;
  occurredAt: string;
};

export type IqcSummaryRow = {
  materialCode: string;
  materialName: MultilingualText;
  supplierCode: string;
  supplierName: MultilingualText;
  totalLots: number;
  pendingLots: number;
  releasedLots: number;
  holdLots: number;
  rejectedLots: number;
  totalQty: number;
  pendingQty: number;
  lastReceivedAt: string | null;
};

export type OeeByLineRow = {
  lineCode: string;
  lineName: MultilingualText;
  date: string;
  plannedMinutes: number;
  downtimeMinutes: number;
  idealCycleMinutes: number;
  totalOutput: number;
  defectCount: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
};

export type DefectAnalysisRow = {
  defectCode: string;
  defectName: MultilingualText;
  severity: string;
  stationType: string;
  count: number;
  percentage: number;
  avgRepairMinutes: number | null;
  topWorkOrderCode: string | null;
};

export type MaterialBalanceRow = {
  materialCode: string;
  materialName: MultilingualText;
  uom: string;
  totalReceived: number;
  totalIssued: number;
  totalScrapped: number;
  totalReturned: number;
  currentBalance: number;
  locationBreakdown: { locationCode: string; qty: number }[];
};

export type DeliveryRiskRow = {
  poNumber: string;
  customerName: MultilingualText;
  productCode: string;
  orderQty: number;
  deliveredQty: number;
  balanceQty: number;
  dueDate: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  workOrderCodes: string[];
  lineCode: string | null;
  daysRemaining: number;
};

// ── Business-rule validators ─────────────────────────────────────────────

/**
 * 核心业务函数：工厂的IQC状态机校验器。
 * 该函数用于在任何交易执行前，强制判断当前动作是否符合材料批次的状态流转规则。
 */
export function validateIQCWorkflowTransition(
  currentStatus: IqcStatus,
  requestedAction: string,
): { isValid: boolean; reason?: string } {
  switch (currentStatus) {
    case "pending":
      if (requestedAction === "IQC_HOLD") return { isValid: true };
      return { isValid: false, reason: `状态 ${currentStatus} 只允许 IQC_HOLD 拦截，当前动作 ${requestedAction} 被拒绝` };

    case "hold":
      if (requestedAction === "IQC_RELEASE" || requestedAction === "ADJUST") return { isValid: true };
      if (requestedAction === "SCRAP") return { isValid: true };
      return { isValid: false, reason: `状态 ${currentStatus} 只允许 IQC_RELEASE/ADJUST 放行或 SCRAP，当前动作 ${requestedAction} 被拒绝` };

    case "released":
      const standardOps = ["PUT_AWAY", "RESERVE", "PICK", "ISSUE_TO_LINE", "RETURN_FROM_LINE"];
      if (standardOps.includes(requestedAction)) return { isValid: true };
      return { isValid: false, reason: `状态 ${currentStatus} 只允许标准作业流操作，当前动作 ${requestedAction} 被拒绝` };

    case "rejected":
      if (requestedAction === "SCRAP") return { isValid: true };
      return { isValid: false, reason: `状态 ${currentStatus} 只能执行 SCRAP，当前动作 ${requestedAction} 被拒绝` };

    default:
      return { isValid: false, reason: `未定义的状态: ${currentStatus}` };
  }
}

// ── Spare Parts Warehouse ─────────────────────────────────────────────────────

export interface SparePart {
  id: string;
  partNo: string;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
  equipmentModel?: string;
  equipmentType?: string;
  currentStock: number;
  minStock: number;
  unit: string;
  locationCode?: string;
  supplier?: string;
  unitCost?: number;
  leadTimeDays?: number;
  status: "active" | "discontinued" | "on_order";
  lowStock?: boolean;
}

export interface PartsWearSchedule {
  id: string;
  partId: string;
  partNo?: string;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
  equipmentId: string;
  equipmentNo?: string;
  equipmentStatus?: string;
  installedAt?: string;
  runningHours: number;
  replaceIntervalHours: number;
  nextReplaceDue?: string;
  lastReplacedAt?: string;
  wearStatus: "normal" | "warning" | "critical" | "overdue";
  wearPct?: number;
}

export interface PartsConsumptionLog {
  id: string;
  partId: string;
  partNo?: string;
  name_zh?: string;
  name_en?: string;
  equipmentId?: string;
  workOrderCode?: string;
  quantity: number;
  reason: "corrective" | "preventive" | "preventive_scheduled" | "breakdown" | "adjustment";
  operatorName?: string;
  consumedAt: string;
}

export interface PartsWearAlert {
  id: string;
  partId: string;
  partNo?: string;
  name_zh?: string;
  name_en?: string;
  equipmentId?: string;
  alertType: "low_stock" | "wear_warning" | "wear_critical" | "overdue" | "consumption_spike";
  severity: "info" | "warning" | "critical";
  message: string;
  currentStock?: number;
  minStock?: number;
  runningHours?: number;
  replaceIntervalHours?: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt: string;
}

// ── Maintenance Work Orders ─────────────────────────────────────────────────

export interface MaintenanceWorkOrder {
  id: string;
  woNo: string;
  equipmentId: string;
  equipmentCode?: string;
  equipmentNameZh?: string;
  lineId?: string;
  lineName?: string;
  issueTime: string;
  issuePerson: string;
  issuePhone?: string;
  faultDescription: string;
  faultCategory: "mechanical" | "electrical" | "software" | "wear" | "leak" | "sensor" | "other";
  priority: "low" | "medium" | "high" | "critical";
  assignedTechnician?: string;
  assignedAt?: string;
  status: "waiting_to_process" | "received" | "in_processing" | "fixed" | "hanging" | "handover_to_other" | "closed";
  receivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  realCause?: string;
  resolutionNotes?: string;
  hangingReason?: string;
  handoverTo?: string;
  handoverAt?: string;
  handoverNote?: string;
  partsUsed?: { partId: string; partName: string; quantity: number }[];
  downtimeMinutes?: number;
  photoUrls?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

// ── Equipment Checking Checklists ───────────────────────────────────────────

export interface ChecklistTemplate {
  id: string;
  templateCode: string;
  templateName: string;
  equipmentType: string;
  frequency: "shift" | "daily" | "weekly" | "monthly" | "quarterly";
  isActive: boolean;
  version: number;
  items?: ChecklistItem[];
  createdBy?: string;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  templateId: string;
  itemOrder: number;
  checkPoint: string;
  checkMethod?: string;
  standardValue?: string;
  resultType: "pass_fail" | "numeric" | "text";
  unit?: string;
  lowerLimit?: number;
  upperLimit?: number;
  isOptional: boolean;
  category: "safety" | "operation" | "cleanliness" | "lubrication" | "temperature" | "pressure" | "electrical" | "mechanical" | "other";
  failurePriority: "low" | "medium" | "high" | "critical";
}

export interface CheckingRecord {
  id: string;
  recordNo: string;
  templateId: string;
  equipmentId: string;
  equipmentCode?: string;
  equipmentNameZh?: string;
  lineId?: string;
  lineName?: string;
  frequency?: string;
  shiftType: "day" | "night" | "mid";
  checkDate: string;
  checkTime?: string;
  inspectorName: string;
  totalItems: number;
  passedItems: number;
  failedItems: number;
  skippedItems: number;
  overallResult: "pass" | "conditional_pass" | "fail";
  notes?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  workOrderIds?: string[];
  details?: CheckingRecordDetail[];
  createdAt: string;
}

export interface CheckingRecordDetail {
  id: string;
  recordId: string;
  itemId: string;
  itemOrder: number;
  checkPoint?: string;
  result: "pass" | "fail" | "na" | "skip";
  numericValue?: number;
  notes?: string;
  photoUrl?: string;
  createdAt: string;
}

export interface ChecklistSchedule {
  id: string;
  equipmentId: string;
  templateId: string;
  frequency: string;
  scheduledDate: string;
  shiftType: string;
  assignedInspector?: string;
  status: "pending" | "completed" | "missed" | "overridden";
  recordId?: string;
  completedAt?: string;
  overriddenBy?: string;
  overrideReason?: string;
}

export interface ComplianceSummary {
  totalScheduled: number;
  completed: number;
  missed: number;
  overridden: number;
  complianceRate: number;
  onTimeRate: number;
  skipRate: number;
  verificationRate: number;
  period: { from: string; to: string };
}

export interface ComplianceByEquipment {
  equipmentId: string;
  equipmentCode: string;
  equipmentNameZh: string;
  scheduled: number;
  completed: number;
  missed: number;
  complianceRate: number;
}

export interface ComplianceByInspector {
  inspectorName: string;
  assigned: number;
  completed: number;
  missed: number;
  skipRate: number;
  complianceRate: number;
}
