import type {
  AttendanceRecord,
  AuthDirectoryRecord,
  CostSummary,
  CustomerPo,
  DashboardMetric,
  Department,
  Employee,
  Equipment,
  FactoryLine,
  FeederBinding,
  FinanceInvoiceSummary,
  InspectionRecord,
  MaintenanceRecord,
  MaterialLot,
  PaymentRecord,
  QuoteConversionRow,
  RoleKey,
  RmaRepairRecord,
  RmaRequest,
  SalesOrder,
  SalesQuote,
  ServiceTicket,
  SupplementaryMaterial,
  TraceEvent,
  WorkOrder,
  StorageLocation,
  PoReceiveItem,
  IQCTask,
  InventoryTransaction,
  PickOrder,
  ProductionReturn,
  SupplierReturn,
  SalesReturn,
  CycleCount,
  ExpiryAlert,
  AgingItem,
  MsdMaterial,
  MsdTask,
  MsdBakingRecord,
  InspectionTemplate,
  IQCInspectionResult,
  SupplierKpiEntry,
  QualityTrendPoint,
  TraceNode,
  AuxMaterial,
  AuxLifecycleEvent,
  StationDef,
  StationKey,
  LineStationState,
  InspectionAssignment,
  InspectionRecord as InspRec,
  InspectionAbnormal,
  MachineOeeLog,
  MachineStatusSnapshot,
  PmTemplate,
  PmScheduleAssignment,
  PmExecutionLog,
  SparePart,
  PartsWearSchedule,
  PartsConsumptionLog,
  PartsWearAlert,
} from "../../../packages/shared-types/src/factory";

export const metrics: DashboardMetric[] = [
  { id: "metric.output", value: "18,420 PCS", tone: "ok", trend: "+12.6%" },
  { id: "metric.oee", value: "82.4%", tone: "info", trend: "+3.1%" },
  { id: "metric.inventory", value: "96.8%", tone: "ok", trend: "2 lots hold" },
  { id: "metric.yield", value: "98.7%", tone: "ok", trend: "+0.4%" },
  { id: "metric.delivery", value: "3 WO", tone: "warning", trend: "48h watch" },
];

export const lines: FactoryLine[] = [
  {
    id: "line-smt-01",
    lineCode: "01",
    name_zh: "SMT线",
    name_en: "SMT Line",
    name_vi: "Dây chuyền SMT",
    status: "running",
    currentWorkOrderCode: "26061010008",
    oee: 86,
    outputToday: 8420,
    targetToday: 9600,
  },
  {
    id: "line-semi-auto-02",
    lineCode: "02",
    name_zh: "半自动线",
    name_en: "Semi-auto Line",
    name_vi: "Dây chuyền bán tự động",
    status: "changeover",
    currentWorkOrderCode: "26061020003",
    oee: 71,
    outputToday: 5280,
    targetToday: 7200,
  },
  {
    id: "line-pkg-03",
    lineCode: "03",
    name_zh: "包装线",
    name_en: "Packaging Line",
    name_vi: "Dây chuyền đóng gói",
    status: "idle",
    currentWorkOrderCode: undefined,
    oee: 0,
    outputToday: 0,
    targetToday: 0,
  },
  {
    id: "line-manual-04",
    lineCode: "04",
    name_zh: "手动线",
    name_en: "Manual Line",
    name_vi: "Dây chuyền thủ công",
    status: "idle",
    currentWorkOrderCode: undefined,
    oee: 0,
    outputToday: 0,
    targetToday: 0,
  },
  {
    id: "line-rework-99",
    lineCode: "99",
    name_zh: "返工线",
    name_en: "Rework Line",
    name_vi: "Dây chuyền sửa lỗi",
    status: "down",
    currentWorkOrderCode: "26063990003",
    oee: 0,
    outputToday: 118,
    targetToday: 650,
  },
];

export const customerPos: CustomerPo[] = [
  {
    id: "po-20260616-001",
    poNumber: "RJ-VN-PO-240611",
    customerCode: "CUST-HANOI-01",
    productCode: "PCBA-AURORA-CTRL",
    quantity: 24000,
    dueDate: "2026-06-24",
    risk: "low",
  },
  {
    id: "po-20260616-002",
    poNumber: "RJ-VN-PO-240612",
    customerCode: "CUST-SGN-02",
    productCode: "PCBA-MOTOR-IO",
    quantity: 12000,
    dueDate: "2026-06-20",
    risk: "high",
  },
];

export const workOrders: WorkOrder[] = [
  {
    id: "wo-26061010008",
    code: "26061010008",
    poNumber: "RJ-VN-PO-240611",
    type: 1,
    lineCode: "01",
    productCode: "PCBA-AURORA-CTRL",
    plannedQty: 9600,
    completedQty: 8420,
    status: "running",
    materialReady: 98,
    firstArticle: "passed",
    // SMT order, linked to assembly WO-26061020005 (rule 6.4)
    relatedWorkOrderCode: "26061020005",
  },
  {
    id: "wo-26061020005",
    code: "26061020005",
    poNumber: "RJ-VN-PO-240611",
    type: 1,
    lineCode: "04",
    productCode: "PCBA-AURORA-CTRL",
    plannedQty: 9600,
    completedQty: 0,
    status: "draft",
    materialReady: 80,
    firstArticle: "pending",
    // Assembly order, linked from SMT WO-26061010008 (rule 6.4)
    relatedWorkOrderCode: "26061010008",
  },
  {
    id: "wo-26061020003",
    code: "26061020003",
    poNumber: "RJ-VN-PO-240612",
    type: 1,
    lineCode: "02",
    productCode: "PCBA-MOTOR-IO",
    plannedQty: 7200,
    completedQty: 5280,
    status: "released",
    materialReady: 88,
    firstArticle: "pending",
  },
  {
    id: "wo-26063990003",
    code: "26063990003",
    poNumber: "RJ-VN-PO-240611",
    type: 3,
    lineCode: "99",
    productCode: "PCBA-AURORA-CTRL",
    plannedQty: 650,
    completedQty: 118,
    status: "running",
    materialReady: 100,
    firstArticle: "failed",
    // Rework order on the rework line (rule 4.3 type 3)
  },
  {
    id: "wo-26064010001",
    code: "26064010001",
    poNumber: "RJ-VN-PO-240613",
    type: 1,
    lineCode: "04",
    productCode: "PCBA-MOTOR-IO",
    plannedQty: 2400,
    completedQty: 0,
    status: "voided",
    materialReady: 0,
    firstArticle: "pending",
    // Example voided order — code retained, not reused (rule 3.2.5)
  },
];

// ── 补料单 demo data (rule 6.3) ─────────────────────────────────────

export const supplementaryMaterials: SupplementaryMaterial[] = [
  {
    id: "sup-001",
    workOrderCode: "26061010008",
    materialCode: "R-0603-10K-1",
    materialName: { name_zh: "贴片电阻 0603 10K", name_en: "Chip resistor 0603 10K", name_vi: "Điện trở dán 0603 10K" },
    requiredQty: 5000,
    uom: "PCS",
    reason: "SMT 生产损耗超预期，需补料",
    status: "pending",
    requestedBy: "PMC_VN_02",
    createdAt: "2026-06-16 14:30",
  },
  {
    id: "sup-002",
    workOrderCode: "26061010008",
    materialCode: "IC-MCU-RJ32",
    materialName: { name_zh: "主控 MCU", name_en: "Main control MCU", name_vi: "MCU điều khiển chính" },
    requiredQty: 200,
    uom: "PCS",
    reason: "IQC 待判定批次不可用，需补料替代",
    status: "approved",
    requestedBy: "PMC_VN_02",
    createdAt: "2026-06-16 15:00",
  },
];

export const materialLots: MaterialLot[] = [
  {
    id: "lot-r-06016",
    materialCode: "R-0603-10K-1",
    lotNo: "VN-R240616-01",
    supplierCode: "SUP-TPE-RES",
    iqcStatus: "released",
    locationCode: "A01-02-03",
    qty: 238000,
    reservedQty: 96000,
    name_zh: "贴片电阻 0603 10K",
    name_en: "Chip resistor 0603 10K",
    name_vi: "Điện trở dán 0603 10K",
  },
  {
    id: "lot-ic-240616",
    materialCode: "IC-MCU-RJ32",
    lotNo: "VN-IC240616-07",
    supplierCode: "SUP-SZ-IC",
    iqcStatus: "hold",
    locationCode: "IQC-HOLD-01",
    qty: 5200,
    reservedQty: 0,
    name_zh: "主控 MCU",
    name_en: "Main control MCU",
    name_vi: "MCU điều khiển chính",
  },
  {
    id: "lot-pcb-240616",
    materialCode: "PCB-AURORA-CTRL",
    lotNo: "VN-PCB240616-03",
    supplierCode: "SUP-HN-PCB",
    iqcStatus: "released",
    locationCode: "B02-01-01",
    qty: 12000,
    reservedQty: 9600,
    name_zh: "Aurora 控制板裸板",
    name_en: "Aurora controller bare PCB",
    name_vi: "PCB trần bộ điều khiển Aurora",
  },
  {
    id: "lot-cap-001",
    materialCode: "CAP-0805-100N",
    lotNo: "VN-CAP240617-01",
    supplierCode: "SUP-SH-CAP",
    iqcStatus: "pending",
    locationCode: "IQC-HOLD-01",
    qty: 150000,
    reservedQty: 0,
    name_zh: "贴片电容 0805 100nF",
    name_en: "MLCC 0805 100nF",
    name_vi: "Tụ dán 0805 100nF",
  },
  {
    id: "lot-conn-001",
    materialCode: "CONN-USB-C-30P",
    lotNo: "VN-CONN240617-02",
    supplierCode: "SUP-DG-CONN",
    iqcStatus: "hold",
    locationCode: "IQC-HOLD-01",
    qty: 8000,
    reservedQty: 0,
    name_zh: "USB-C 连接器 30P",
    name_en: "USB-C connector 30P",
    name_vi: "Đầu nối USB-C 30P",
  },
];

export const feederBindings: FeederBinding[] = [
  {
    id: "fb-001",
    workOrderCode: "26061010008",
    lineCode: "01",
    machineCode: "NXT-01",
    feederNo: "F12",
    materialCode: "R-0603-10K-1",
    reelCode: "REEL-R240616-0008",
    operator: "VN_OP_013",
    boundAt: "2026-06-16 08:11",
  },
  {
    id: "fb-002",
    workOrderCode: "26061010008",
    lineCode: "01",
    machineCode: "NXT-01",
    feederNo: "F23",
    materialCode: "IC-MCU-RJ32",
    reelCode: "REEL-IC240616-0019",
    operator: "VN_OP_017",
    boundAt: "2026-06-16 08:18",
  },
];

export const inspections = [
  {
    id: "insp-spi-001",
    station: "SPI",
    workOrderCode: "26061010008",
    pcbSerial: "PCB2606160100084218",
    result: "PASS",
    operator: "VN_QA_005",
    occurredAt: "2026-06-16 10:42",
  },
  {
    id: "insp-aoi-018",
    station: "AOI",
    workOrderCode: "26061010008",
    pcbSerial: "PCB2606160100084172",
    result: "FAIL",
    defectCode: "AOI-SOLDER-BRIDGE",
    defectName: {
      name_zh: "连锡",
      name_en: "Solder bridge",
      name_vi: "Cầu thiếc",
    },
    operator: "VN_QA_006",
    occurredAt: "2026-06-16 10:58",
  },
  {
    id: "insp-repair-018",
    station: "VISUAL",
    workOrderCode: "26061010008",
    pcbSerial: "PCB2606160100084172",
    result: "CLOSED",
    defectCode: "AOI-SOLDER-BRIDGE",
    defectName: {
      name_zh: "连锡已返修",
      name_en: "Solder bridge repaired",
      name_vi: "Đã sửa cầu thiếc",
    },
    operator: "VN_REPAIR_002",
    occurredAt: "2026-06-16 11:21",
  },
];

export const traceEvents: TraceEvent[] = [
  { id: "t01", sequence: 1, type: "po", ref: "RJ-VN-PO-240611", status: "confirmed", actor: "PMC_CN_01", at: "2026-06-11 09:00", details: "Customer demand accepted" },
  { id: "t02", sequence: 2, type: "work_order", ref: "26061010008", status: "released", actor: "PMC_VN_02", at: "2026-06-15 17:30", details: "11 digit code generated and preserved" },
  { id: "t03", sequence: 3, type: "receiving", ref: "VN-PCB240616-03", status: "received", actor: "VN_WH_004", at: "2026-06-16 07:42", details: "PCB lot received with supplier certificate" },
  { id: "t04", sequence: 4, type: "iqc", ref: "IQC-VN-240616-12", status: "released", actor: "VN_IQC_003", at: "2026-06-16 08:04", details: "Sample passed, lot released" },
  { id: "t05", sequence: 5, type: "storage", ref: "B02-01-01", status: "stored", actor: "VN_WH_004", at: "2026-06-16 08:09", details: "Put-away transaction created" },
  { id: "t06", sequence: 6, type: "picking", ref: "PICK-26061010008-01", status: "picked", actor: "VN_WH_010", at: "2026-06-16 08:32", details: "Reserved by work order" },
  { id: "t07", sequence: 7, type: "line_issue", ref: "ISSUE-SMT01-008", status: "issued", actor: "VN_WH_010", at: "2026-06-16 08:44", details: "Material responsibility transferred to SMT line" },
  { id: "t08", sequence: 8, type: "feeder_binding", ref: "REEL-R240616-0008", status: "bound", actor: "VN_OP_013", at: "2026-06-16 08:51", details: "Machine NXT-01 feeder F12" },
  { id: "t09", sequence: 9, type: "station", ref: "PCB2606160100084172", status: "mounted", actor: "NXT-01", at: "2026-06-16 10:31", details: "Station event recorded" },
  { id: "t10", sequence: 10, type: "inspection", ref: "AOI-SOLDER-BRIDGE", status: "fail", actor: "AOI-01", at: "2026-06-16 10:58", details: "Defect opened" },
  { id: "t11", sequence: 11, type: "repair", ref: "REPAIR-240616-018", status: "closed", actor: "VN_REPAIR_002", at: "2026-06-16 11:21", details: "Repair completed and re-inspected" },
  { id: "t12", sequence: 12, type: "finished_goods", ref: "FG-26061010008-01", status: "packed", actor: "VN_WH_012", at: "2026-06-16 12:10", details: "Finished goods inventory created" },
];

// Admin has every permission in the system — full read + full action
export const ALL_PERMISSIONS: string[] = [
  "dashboard.view", "erp.view", "pmc.view", "pmc.manage",
  "wms.view", "wms.receive", "wms.iqc", "wms.issue",
  "mes.view", "mes.execute",
  "quality.view", "quality.review",
  "traceability.view", "reports.view",
  "finance.view", "finance.manage",
  "sales.view", "sales.manage",
  "service.view", "service.manage",
  "admin.view", "admin.users.manage", "admin.roles.manage",
  "admin.audit.read", "admin.settings.manage",
  "auth.session.read", "auth.session.manage",
  // Lifecycle management
  "lifecycle.view", "lifecycle.edit", "lifecycle.approve",
];

export const roleMatrix: Record<RoleKey, string[]> = {
  management: [
    "dashboard.view", "reports.view", "traceability.view",
    "pmc.view", "pmc.manage", "wms.view", "quality.view",
    "finance.view", "sales.view", "service.view",
    "maintenance.view",
  ],
  pmc: ["pmc.view", "pmc.manage", "wms.view", "traceability.view", "sales.view"],
  warehouse: ["wms.view", "wms.receive", "wms.iqc", "wms.issue", "inventory", "lifecycle.view", "lifecycle.edit"],
  iqc: ["wms.view", "wms.iqc", "quality.view", "supplier_quality", "hold_release", "service.view"],
  smt_operator: ["mes.view", "mes.execute", "pda.view", "line_start", "feeder_scan", "pcb_scan", "output", "downtime"],
  engineering: ["mes.view", "process_route", "first_article", "abnormal_analysis", "quality.review", "maintenance.view", "maintenance.manage"],
  quality: ["quality.view", "quality.review", "spi", "aoi", "ict", "repair", "capa", "service.view", "lifecycle.view", "lifecycle.edit", "lifecycle.approve"],
  admin: ALL_PERMISSIONS,
};

// ── WMS demo data ──────────────────────────────────────────────────

export const storageLocations: StorageLocation[] = [
  { id: "loc-a01-01", code: "A01-01-01", area: "A区-货架1", shelfCode: "A01-01", status: "active", name_zh: "A区-01-01", name_en: "Zone A-01-01", name_vi: "Khu A-01-01" },
  { id: "loc-a01-02", code: "A01-01-02", area: "A区-货架1", shelfCode: "A01-01", status: "active", name_zh: "A区-01-02", name_en: "Zone A-01-02", name_vi: "Khu A-01-02" },
  { id: "loc-a01-03", code: "A01-01-03", area: "A区-货架1", shelfCode: "A01-01", status: "full", name_zh: "A区-01-03", name_en: "Zone A-01-03", name_vi: "Khu A-01-03" },
  { id: "loc-a02-01", code: "A02-01-01", area: "A区-货架2", shelfCode: "A02-01", status: "active", name_zh: "A区-02-01", name_en: "Zone A-02-01", name_vi: "Khu A-02-01" },
  { id: "loc-b01-01", code: "B01-01-01", area: "B区-货架1", shelfCode: "B01-01", status: "active", name_zh: "B区-01-01", name_en: "Zone B-01-01", name_vi: "Khu B-01-01" },
  { id: "loc-b02-01", code: "B02-01-01", area: "B区-货架2", shelfCode: "B02-01", status: "active", name_zh: "B区-02-01", name_en: "Zone B-02-01", name_vi: "Khu B-02-01" },
  { id: "loc-iqc-hold", code: "IQC-HOLD-01", area: "IQC待检区", shelfCode: "IQC-HOLD", status: "active", name_zh: "IQC待检区", name_en: "IQC Hold Area", name_vi: "Khu vực IQC tạm giữ" },
  { id: "loc-reject", code: "REJECT-01", area: "不良品区", shelfCode: "REJECT", status: "active", name_zh: "不良品区", name_en: "Reject Area", name_vi: "Khu vực từ chối" },
  { id: "loc-frozen", code: "FROZEN-01", area: "冷冻库", shelfCode: "FROZEN", status: "active", name_zh: "冷冻库", name_en: "Freezer", name_vi: "Kho đông lạnh" },
  { id: "loc-a01-02-03", code: "A01-02-03", area: "A区-货架1", shelfCode: "A01-02", status: "active", name_zh: "A区-02-03", name_en: "Zone A-02-03", name_vi: "Khu A-02-03" },
];

export const poReceiveItems: PoReceiveItem[] = [
  { id: "po-rec-001", poNumber: "PO-2026-06-001", materialCode: "R-0603-10K-1", materialName: { name_zh: "贴片电阻 0603 10K", name_en: "Chip resistor 0603 10K", name_vi: "Điện trở dán 0603 10K" }, expectedQty: 500000, receivedQty: 0, unit: "PCS", status: "pending" },
  { id: "po-rec-002", poNumber: "PO-2026-06-001", materialCode: "IC-MCU-RJ32", materialName: { name_zh: "主控 MCU", name_en: "Main control MCU", name_vi: "MCU điều khiển chính" }, expectedQty: 10000, receivedQty: 5200, unit: "PCS", status: "partial" },
  { id: "po-rec-003", poNumber: "PO-2026-06-002", materialCode: "PCB-AURORA-CTRL", materialName: { name_zh: "Aurora 控制板裸板", name_en: "Aurora controller bare PCB", name_vi: "PCB trần bộ điều khiển Aurora" }, expectedQty: 15000, receivedQty: 15000, unit: "PCS", status: "complete" },
  { id: "po-rec-004", poNumber: "PO-2026-06-003", materialCode: "CAP-0805-100N", materialName: { name_zh: "贴片电容 0805 100nF", name_en: "MLCC 0805 100nF", name_vi: "Tụ dán 0805 100nF" }, expectedQty: 300000, receivedQty: 0, unit: "PCS", status: "pending" },
];

export const iqcTasks: IQCTask[] = [
  { id: "iqc-001", materialLotId: "lot-ic-240616", materialCode: "IC-MCU-RJ32", lotNo: "VN-IC240616-07", supplierCode: "SUP-SZ-IC", qty: 5200, status: "hold", priority: "urgent", assignedTo: "VN_IQC_003", createdAt: "2026-06-16 07:50", resultNotes: "样品测试中，待判定" },
  { id: "iqc-002", materialLotId: "lot-r-06016", materialCode: "R-0603-10K-1", lotNo: "VN-R240616-01", supplierCode: "SUP-TPE-RES", qty: 238000, status: "passed", priority: "normal", assignedTo: "VN_IQC_003", createdAt: "2026-06-16 07:45", completedAt: "2026-06-16 08:20", resultNotes: "AQL=0.65, 抽样合格" },
  { id: "iqc-003", materialLotId: "lot-pcb-240616", materialCode: "PCB-AURORA-CTRL", lotNo: "VN-PCB240616-03", supplierCode: "SUP-HN-PCB", qty: 12000, status: "passed", priority: "normal", assignedTo: "VN_IQC_003", createdAt: "2026-06-16 08:00", completedAt: "2026-06-16 08:35" },
  { id: "iqc-004", materialLotId: "lot-cap-001", materialCode: "CAP-0805-100N", lotNo: "VN-CAP240617-01", supplierCode: "SUP-SH-CAP", qty: 150000, status: "pending", priority: "urgent", createdAt: "2026-06-17 07:30" },
];

export const inventoryTransactions: InventoryTransaction[] = [
  { id: "tx-001", txNo: "RCV-20260616-001", action: "RECEIVE", materialLotId: "lot-pcb-240616", materialCode: "PCB-AURORA-CTRL", lotNo: "VN-PCB240616-03", qty: 12000, toLocation: "B02-01-01", operator: "VN_WH_004", occurredAt: "2026-06-16 07:42" },
  { id: "tx-002", txNo: "IQC-20260616-001", action: "IQC_RELEASE", materialLotId: "lot-pcb-240616", materialCode: "PCB-AURORA-CTRL", lotNo: "VN-PCB240616-03", qty: 12000, operator: "VN_IQC_003", occurredAt: "2026-06-16 08:04" },
  { id: "tx-003", txNo: "PUT-20260616-001", action: "PUT_AWAY", materialLotId: "lot-pcb-240616", materialCode: "PCB-AURORA-CTRL", lotNo: "VN-PCB240616-03", qty: 12000, fromLocation: "IQC-HOLD-01", toLocation: "B02-01-01", operator: "VN_WH_004", occurredAt: "2026-06-16 08:09" },
  { id: "tx-004", txNo: "PICK-20260616-001", action: "PICK", materialLotId: "lot-pcb-240616", materialCode: "PCB-AURORA-CTRL", lotNo: "VN-PCB240616-03", qty: 9600, fromLocation: "B02-01-01", workOrderCode: "26061010008", operator: "VN_WH_010", occurredAt: "2026-06-16 08:32" },
  { id: "tx-005", txNo: "ISS-20260616-001", action: "ISSUE_TO_LINE", materialLotId: "lot-pcb-240616", materialCode: "PCB-AURORA-CTRL", lotNo: "VN-PCB240616-03", qty: 9600, fromLocation: "B02-01-01", workOrderCode: "26061010008", operator: "VN_WH_010", occurredAt: "2026-06-16 08:44" },
  { id: "tx-006", txNo: "RCV-20260616-002", action: "RECEIVE", materialLotId: "lot-ic-240616", materialCode: "IC-MCU-RJ32", lotNo: "VN-IC240616-07", qty: 5200, toLocation: "IQC-HOLD-01", operator: "VN_WH_004", occurredAt: "2026-06-16 07:50" },
  { id: "tx-007", txNo: "RCV-20260616-003", action: "RECEIVE", materialLotId: "lot-r-06016", materialCode: "R-0603-10K-1", lotNo: "VN-R240616-01", qty: 238000, toLocation: "A01-02-03", operator: "VN_WH_004", occurredAt: "2026-06-16 07:38" },
  { id: "tx-008", txNo: "IQC-20260616-002", action: "IQC_RELEASE", materialLotId: "lot-r-06016", materialCode: "R-0603-10K-1", lotNo: "VN-R240616-01", qty: 238000, operator: "VN_IQC_003", occurredAt: "2026-06-16 08:20" },
];

export const pickOrders: PickOrder[] = [
  {
    id: "pick-26061010008", orderNo: "WO26061010008-PICK", workOrderCode: "26061010008", lineCode: "01", status: "issued",
    items: [
      { id: "pk-001", materialCode: "PCB-AURORA-CTRL", materialName: { name_zh: "Aurora 控制板裸板", name_en: "Aurora controller bare PCB", name_vi: "PCB trần bộ điều khiển Aurora" }, requiredQty: 9600, pickedQty: 9600, lotNo: "VN-PCB240616-03", locationCode: "B02-01-01", status: "picked" },
      { id: "pk-002", materialCode: "R-0603-10K-1", materialName: { name_zh: "贴片电阻 0603 10K", name_en: "Chip resistor 0603 10K", name_vi: "Điện trở dán 0603 10K" }, requiredQty: 96000, pickedQty: 96000, lotNo: "VN-R240616-01", locationCode: "A01-02-03", status: "picked" },
      { id: "pk-003", materialCode: "IC-MCU-RJ32", materialName: { name_zh: "主控 MCU", name_en: "Main control MCU", name_vi: "MCU điều khiển chính" }, requiredQty: 9600, pickedQty: 0, lotNo: "VN-IC240616-07", locationCode: "IQC-HOLD-01", status: "pending" },
    ],
    operator: "VN_WH_010", createdAt: "2026-06-16 08:00", completedAt: "2026-06-16 08:44",
  },
  {
    id: "pick-26061020003", orderNo: "WO26061020003-PICK", workOrderCode: "26061020003", lineCode: "02", status: "picking",
    items: [
      { id: "pk-004", materialCode: "PCB-AURORA-CTRL", materialName: { name_zh: "Aurora 控制板裸板", name_en: "Aurora controller bare PCB", name_vi: "PCB trần bộ điều khiển Aurora" }, requiredQty: 7200, pickedQty: 7200, lotNo: "VN-PCB240616-03", locationCode: "B02-01-01", status: "picked" },
      { id: "pk-005", materialCode: "R-0603-10K-1", materialName: { name_zh: "贴片电阻 0603 10K", name_en: "Chip resistor 0603 10K", name_vi: "Điện trở dán 0603 10K" }, requiredQty: 72000, pickedQty: 48000, lotNo: "VN-R240616-01", locationCode: "A01-02-03", status: "picked" },
    ],
    operator: "VN_WH_010", createdAt: "2026-06-16 09:00",
  },
];

export const demoDirectory: Array<AuthDirectoryRecord & { password: string }> = [
  {
    id: "user-operator-001",
    username: "VN_OP_001",
    displayName: "Operator 01",
    locale: "vi-VN",
    roleKey: "smt_operator",
    roleName: {
      name_zh: "操作员",
      name_en: "Operator",
      name_vi: "Nhân viên vận hành",
    },
    status: "active",
    password: "Factory@123",
  },
  {
    id: "user-management-001",
    username: "MGT_CN_01",
    displayName: "Li Wei",
    locale: "zh-CN",
    roleKey: "management",
    roleName: {
      name_zh: "管理层",
      name_en: "Management",
      name_vi: "Quản lý",
    },
    status: "active",
    password: "Factory@123",
  },
  {
    id: "user-pmc-001",
    username: "PMC_CN_01",
    displayName: "Chen PMC 01",
    locale: "zh-CN",
    roleKey: "pmc",
    roleName: {
      name_zh: "PMC 计划",
      name_en: "PMC Planning",
      name_vi: "Kế hoạch PMC",
    },
    status: "active",
    password: "Factory@123",
  },
  {
    id: "user-warehouse-001",
    username: "VN_WH_001",
    displayName: "Warehouse 01",
    locale: "vi-VN",
    roleKey: "warehouse",
    roleName: {
      name_zh: "仓库",
      name_en: "Warehouse",
      name_vi: "Kho",
    },
    status: "active",
    password: "Factory@123",
  },
  {
    id: "user-quality-001",
    username: "QC_VN_01",
    displayName: "QC Vietnam 01",
    locale: "vi-VN",
    roleKey: "quality",
    roleName: {
      name_zh: "质量",
      name_en: "Quality",
      name_vi: "Chất lượng",
    },
    status: "active",
    password: "Factory@123",
  },
];

// ── HR demo data ────────────────────────────────────────────────────

export const departments: Department[] = [
  { id: "dept-mgmt", code: "MGMT", name_zh: "管理层", name_en: "Management", name_vi: "Quản lý", headCount: 3, status: "active" },
  { id: "dept-pmc", code: "PMC", name_zh: "计划部", name_en: "Planning", name_vi: "Kế hoạch", headCount: 4, status: "active" },
  { id: "dept-wh", code: "WH", name_zh: "仓库部", name_en: "Warehouse", name_vi: "Kho", headCount: 6, status: "active" },
  { id: "dept-iqc", code: "IQC", name_zh: "品质部", name_en: "Quality", name_vi: "Chất lượng", headCount: 5, status: "active" },
  { id: "dept-smt", code: "SMT", name_zh: "SMT 生产部", name_en: "SMT Production", name_vi: "Sản xuất SMT", headCount: 12, status: "active" },
  { id: "dept-eng", code: "ENG", name_zh: "工程部", name_en: "Engineering", name_vi: "Kỹ thuật", headCount: 4, status: "active" },
  { id: "dept-admin", code: "ADMIN", name_zh: "行政部", name_en: "Admin", name_vi: "Hành chính", headCount: 3, status: "active" },
];

export const employees: Employee[] = [
  { id: "emp-001", employeeNo: "VN001", name_zh: "李伟", name_en: "Li Wei", name_vi: "Lý Vĩ", departmentId: "dept-mgmt", positionTitle: "厂长", gender: "M", phone: "+84 90 123 0001", email: "liwei@ruijing.vn", joinDate: "2024-01-15", status: "active", employmentType: "full_time" },
  { id: "emp-002", employeeNo: "VN002", name_zh: "陈计划", name_en: "Chen PMC", name_vi: "Trần Kế Hoạch", departmentId: "dept-pmc", positionTitle: "PMC 主管", gender: "M", phone: "+84 90 123 0002", email: "chen.pmc@ruijing.vn", joinDate: "2024-02-01", status: "active", employmentType: "full_time" },
  { id: "emp-003", employeeNo: "VN003", name_zh: "陈计划员", name_en: "Chen Planner", name_vi: "Trần Kế Hoạch Viên", departmentId: "dept-pmc", positionTitle: "计划员", gender: "F", phone: "+84 90 123 0003", email: "chen.planner@ruijing.vn", joinDate: "2024-03-10", status: "active", employmentType: "full_time" },
  { id: "emp-004", employeeNo: "VN004", name_zh: "陈计划员2", name_en: "Chen Planner II", name_vi: "Trần KH2", departmentId: "dept-pmc", positionTitle: "计划员", gender: "F", phone: "+84 90 123 0004", email: "chen.planner2@ruijing.vn", joinDate: "2024-06-20", status: "active", employmentType: "full_time" },
  { id: "emp-005", employeeNo: "VN005", name_zh: "阮仓库", name_en: "Nguyen Warehouse", name_vi: "Nguyễn Kho", departmentId: "dept-wh", positionTitle: "仓管员", gender: "M", phone: "+84 90 123 0005", email: "nguyen.wh@ruijing.vn", joinDate: "2024-01-20", status: "active", employmentType: "full_time" },
  { id: "emp-006", employeeNo: "VN006", name_zh: "陈氏红", name_en: "Tran Hong", name_vi: "Trần Thị Hồng", departmentId: "dept-wh", positionTitle: "仓管员", gender: "F", phone: "+84 90 123 0006", email: "tran.hong@ruijing.vn", joinDate: "2024-03-05", status: "active", employmentType: "full_time" },
  { id: "emp-007", employeeNo: "VN007", name_zh: "范文龙", name_en: "Pham Van Long", name_vi: "Phạm Văn Long", departmentId: "dept-smt", positionTitle: "SMT 技术员", gender: "M", phone: "+84 90 123 0007", email: "pham.long@ruijing.vn", joinDate: "2024-02-15", status: "active", employmentType: "full_time" },
  { id: "emp-008", employeeNo: "VN008", name_zh: "黎氏梅", name_en: "Le Thi Mai", name_vi: "Lê Thị Mai", departmentId: "dept-smt", positionTitle: "操作员", gender: "F", phone: "+84 90 123 0008", email: "le.mai@ruijing.vn", joinDate: "2024-04-01", status: "active", employmentType: "full_time" },
  { id: "emp-009", employeeNo: "VN009", name_zh: "黄文强", name_en: "Hoang Van Cuong", name_vi: "Hoàng Văn Cường", departmentId: "dept-smt", positionTitle: "操作员", gender: "M", phone: "+84 90 123 0009", email: "hoang.cuong@ruijing.vn", joinDate: "2024-04-01", status: "active", employmentType: "full_time" },
  { id: "emp-010", employeeNo: "VN010", name_zh: "武氏香", name_en: "Vu Thi Huong", name_vi: "Vũ Thị Hương", departmentId: "dept-smt", positionTitle: "操作员", gender: "F", phone: "+84 90 123 0010", email: "vu.huong@ruijing.vn", joinDate: "2024-04-15", status: "active", employmentType: "full_time" },
  { id: "emp-011", employeeNo: "VN011", name_zh: "邓文南", name_en: "Dang Van Nam", name_vi: "Đặng Văn Nam", departmentId: "dept-smt", positionTitle: "操作员", gender: "M", phone: "+84 90 123 0011", email: "dang.nam@ruijing.vn", joinDate: "2024-05-01", status: "active", employmentType: "full_time" },
  { id: "emp-012", employeeNo: "VN012", name_zh: "阮氏云", name_en: "Nguyen Thi Van", name_vi: "Nguyễn Thị Vân", departmentId: "dept-iqc", positionTitle: "IQC 检验员", gender: "F", phone: "+84 90 123 0012", email: "nguyen.van@ruijing.vn", joinDate: "2024-02-20", status: "active", employmentType: "full_time" },
  { id: "emp-013", employeeNo: "VN013", name_zh: "黎工", name_en: "Le Engineer", name_vi: "Lê Kỹ Sư", departmentId: "dept-eng", positionTitle: "工艺工程师", gender: "M", phone: "+84 90 123 0013", email: "le.eng@ruijing.vn", joinDate: "2024-03-01", status: "active", employmentType: "full_time" },
  { id: "emp-014", employeeNo: "VN014", name_zh: "范文全", name_en: "Pham Van Toan", name_vi: "Phạm Văn Toàn", departmentId: "dept-eng", positionTitle: "设备工程师", gender: "M", phone: "+84 90 123 0014", email: "pham.toan@ruijing.vn", joinDate: "2024-05-10", status: "active", employmentType: "full_time" },
  { id: "emp-015", employeeNo: "VN015", name_zh: "行政文", name_en: "Admin Van", name_vi: "Hành Chính Văn", departmentId: "dept-admin", positionTitle: "行政专员", gender: "F", phone: "+84 90 123 0015", email: "admin.van@ruijing.vn", joinDate: "2024-06-01", status: "active", employmentType: "full_time" },
];

export const attendanceRecords: AttendanceRecord[] = [
  { id: "att-001", employeeId: "emp-001", employeeNo: "VN001", employeeName: { name_zh: "李伟", name_en: "Li Wei", name_vi: "Lý Vĩ" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:55:00", clockOut: "2026-06-16T17:05:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-002", employeeId: "emp-002", employeeNo: "VN002", employeeName: { name_zh: "陈计划", name_en: "Chen PMC", name_vi: "Trần Kế Hoạch" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:50:00", clockOut: "2026-06-16T17:10:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-003", employeeId: "emp-003", employeeNo: "VN003", employeeName: { name_zh: "陈计划员", name_en: "Chen Planner", name_vi: "Trần Kế Hoạch Viên" }, workDate: "2026-06-16", clockIn: "2026-06-16T08:05:00", clockOut: "2026-06-16T17:00:00", status: "normal", lateMinutes: 5, earlyMinutes: 0, otHours: 0 },
  { id: "att-004", employeeId: "emp-004", employeeNo: "VN004", employeeName: { name_zh: "陈计划员2", name_en: "Chen Planner II", name_vi: "Trần KH2" }, workDate: "2026-06-16", clockIn: "2026-06-16T08:30:00", clockOut: "2026-06-16T17:15:00", status: "late", lateMinutes: 30, earlyMinutes: 0, otHours: 0 },
  { id: "att-005", employeeId: "emp-005", employeeNo: "VN005", employeeName: { name_zh: "阮仓库", name_en: "Nguyen Warehouse", name_vi: "Nguyễn Kho" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:45:00", clockOut: "2026-06-16T16:55:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-006", employeeId: "emp-006", employeeNo: "VN006", employeeName: { name_zh: "陈氏红", name_en: "Tran Hong", name_vi: "Trần Thị Hồng" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:50:00", clockOut: "2026-06-16T17:00:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-007", employeeId: "emp-007", employeeNo: "VN007", employeeName: { name_zh: "范文龙", name_en: "Pham Van Long", name_vi: "Phạm Văn Long" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:55:00", clockOut: "2026-06-16T17:30:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-008", employeeId: "emp-008", employeeNo: "VN008", employeeName: { name_zh: "黎氏梅", name_en: "Le Thi Mai", name_vi: "Lê Thị Mai" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:40:00", clockOut: "2026-06-16T16:50:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-009", employeeId: "emp-009", employeeNo: "VN009", employeeName: { name_zh: "黄文强", name_en: "Hoang Van Cuong", name_vi: "Hoàng Văn Cường" }, workDate: "2026-06-16", clockIn: "2026-06-16T09:00:00", clockOut: "2026-06-16T17:00:00", status: "late", lateMinutes: 60, earlyMinutes: 0, otHours: 0 },
  { id: "att-010", employeeId: "emp-010", employeeNo: "VN010", employeeName: { name_zh: "武氏香", name_en: "Vu Thi Huong", name_vi: "Vũ Thị Hương" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:50:00", clockOut: "2026-06-16T17:05:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-011", employeeId: "emp-011", employeeNo: "VN011", employeeName: { name_zh: "邓文南", name_en: "Dang Van Nam", name_vi: "Đặng Văn Nam" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:55:00", clockOut: "2026-06-16T17:00:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-012", employeeId: "emp-012", employeeNo: "VN012", employeeName: { name_zh: "阮氏云", name_en: "Nguyen Thi Van", name_vi: "Nguyễn Thị Vân" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:48:00", clockOut: "2026-06-16T17:02:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-013", employeeId: "emp-013", employeeNo: "VN013", employeeName: { name_zh: "黎工", name_en: "Le Engineer", name_vi: "Lê Kỹ Sư" }, workDate: "2026-06-16", clockIn: "2026-06-16T08:15:00", clockOut: "2026-06-16T17:20:00", status: "normal", lateMinutes: 15, earlyMinutes: 0, otHours: 0 },
  { id: "att-014", employeeId: "emp-014", employeeNo: "VN014", employeeName: { name_zh: "范文全", name_en: "Pham Van Toan", name_vi: "Phạm Văn Toàn" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:50:00", clockOut: "2026-06-16T17:10:00", status: "normal", lateMinutes: 0, earlyMinutes: 0, otHours: 0 },
  { id: "att-015", employeeId: "emp-015", employeeNo: "VN015", employeeName: { name_zh: "行政文", name_en: "Admin Van", name_vi: "Hành Chính Văn" }, workDate: "2026-06-16", clockIn: "2026-06-16T07:55:00", clockOut: "2026-06-16T16:45:00", status: "early", lateMinutes: 0, earlyMinutes: 45, otHours: 0 },
];

// ── Maintenance demo data ───────────────────────────────────────────

export const equipmentList: Equipment[] = [
  { id: "eq-001", equipmentNo: "SMT-NXT-01", equipmentType: "SMT贴片机", model: "Fuji NXT III", location: "SMT车间-一线", installDate: "2024-01-15", status: "online", lastMaintenanceDate: "2026-06-01", nextMaintenanceDate: "2026-07-01", responsiblePerson: "Pham Van Long", supplier: "Fuji Asia", name_zh: "富士 NXT III 贴片机", name_en: "Fuji NXT III Mounter", name_vi: "Máy gắp Fuji NXT III" },
  { id: "eq-002", equipmentNo: "SMT-NXT-02", equipmentType: "SMT贴片机", model: "Fuji NXT III", location: "SMT车间-二线", installDate: "2024-02-01", status: "online", lastMaintenanceDate: "2026-05-25", nextMaintenanceDate: "2026-06-25", responsiblePerson: "Dang Van Nam", supplier: "Fuji Asia", name_zh: "富士 NXT III 贴片机2", name_en: "Fuji NXT III Mounter 2", name_vi: "Máy gắp Fuji NXT III 2" },
  { id: "eq-003", equipmentNo: "SPI-VT-01", equipmentType: "SPI检测", model: "Vitronics VT-800", location: "SMT车间-一线", installDate: "2024-01-20", status: "online", lastMaintenanceDate: "2026-06-05", nextMaintenanceDate: "2026-07-05", responsiblePerson: "Le Thi Mai", name_zh: "VT-800 SPI 检测仪", name_en: "VT-800 SPI Inspector", name_vi: "Máy SPI VT-800" },
  { id: "eq-004", equipmentNo: "AOI-CTI-01", equipmentType: "AOI检测", model: "CTI A40", location: "SMT车间-一线", installDate: "2024-01-25", status: "fault", lastMaintenanceDate: "2026-05-10", nextMaintenanceDate: "2026-06-10", responsiblePerson: "Hoang Van Cuong", name_zh: "CTI A40 AOI 检测仪", name_en: "CTI A40 AOI Inspector", name_vi: "Máy AOI CTI A40" },
  { id: "eq-005", equipmentNo: "REF-V8-01", equipmentType: "回流焊", model: "Rehm V8", location: "SMT车间-一线", installDate: "2024-01-10", status: "online", lastMaintenanceDate: "2026-06-08", nextMaintenanceDate: "2026-07-08", responsiblePerson: "Pham Van Toan", name_zh: "Rehm V8 回流焊", name_en: "Rehm V8 Reflow Oven", name_vi: "Lò hàn Rehm V8" },
  { id: "eq-006", equipmentNo: "PRINTER-DEK-01", equipmentType: "印刷机", model: "DEK Horizon 03i", location: "SMT车间-一线", installDate: "2024-01-10", status: "maintenance", lastMaintenanceDate: "2026-06-12", nextMaintenanceDate: "2026-07-12", responsiblePerson: "Pham Van Long", name_zh: "DEK Horizon 印刷机", name_en: "DEK Horizon Printer", name_vi: "Máy in DEK Horizon" },
  { id: "eq-007", equipmentNo: "ICT-AGIL-01", equipmentType: "ICT测试", model: "Agilent 3070", location: "测试区", installDate: "2024-03-01", status: "offline", responsiblePerson: "Le Engineer", name_zh: "Agilent 3070 ICT", name_en: "Agilent 3070 ICT", name_vi: "Máy ICT Agilent 3070" },
  { id: "eq-008", equipmentNo: "OVEN-001", equipmentType: "烘箱", model: "ESPEC-260", location: "物料区", installDate: "2024-06-01", status: "online", responsiblePerson: "Nguyen Warehouse", name_zh: "ESPEC 烘箱", name_en: "ESPEC Oven", name_vi: "Tủ sấy ESPEC" },
];

export const maintenanceRecords: MaintenanceRecord[] = [
  { id: "mt-001", equipmentNo: "SMT-NXT-01", type: "preventive", priority: "medium", status: "completed", description: "季度保养：清洁吸嘴、校准贴装精度", scheduledDate: "2026-06-01", completedDate: "2026-06-01", operator: "Pham Van Long", result: "校准通过，精度达标", cost: 0 },
  { id: "mt-002", equipmentNo: "SMT-NXT-02", type: "preventive", priority: "medium", status: "completed", description: "季度保养：润滑导轨、更换过滤棉", scheduledDate: "2026-05-25", completedDate: "2026-05-25", operator: "Dang Van Nam", result: "运行正常", cost: 250 },
  { id: "mt-003", equipmentNo: "AOI-CTI-01", type: "corrective", priority: "high", status: "in_progress", description: "AOI 误报率过高，需重新校准光学系统", scheduledDate: "2026-06-10", operator: "Hoang Van Cuong", result: "校准中..." },
  { id: "mt-004", equipmentNo: "SPI-VT-01", type: "calibration", priority: "low", status: "pending", description: "年度校准：锡膏厚度测试精度验证", scheduledDate: "2026-07-05", operator: "Le Thi Mai" },
  { id: "mt-005", equipmentNo: "PRINTER-DEK-01", type: "corrective", priority: "urgent", status: "overdue", description: "印刷机刮刀压力异常，需更换刮刀组件", scheduledDate: "2026-06-12", operator: "Pham Van Long", cost: 1200 },
  { id: "mt-006", equipmentNo: "REF-V8-01", type: "inspection", priority: "medium", status: "pending", description: "每周点检：温度曲线验证、链条润滑", scheduledDate: "2026-06-20", operator: "Pham Van Toan" },
  { id: "mt-007", equipmentNo: "AOI-CTI-01", type: "preventive", priority: "high", status: "overdue", description: "AOI 月度清洁：镜头清洁、风扇滤网更换", scheduledDate: "2026-06-10", operator: "Hoang Van Cuong" },
  { id: "mt-008", equipmentNo: "ICT-AGIL-01", type: "inspection", priority: "low", status: "pending", description: "ICT 开机检查：探针磨损检查", scheduledDate: "2026-06-25", operator: "Le Engineer" },
];

// ── Machine Inspection / 点检 ────────────────────────────────────────────────

export const _demoInspectionTemplates = [
  { id: "it-001", templateCode: "TPL-PNP-001", machineType: "mounter", templateName: "贴片机日常点检表", shiftType: "any" as const, frequencyType: "daily" as const, isActive: true },
  { id: "it-002", templateCode: "TPL-PNP-002", machineType: "mounter", templateName: "贴片机周点检表", shiftType: "any" as const, frequencyType: "weekly" as const, isActive: true },
  { id: "it-003", templateCode: "TPL-RFL-001", machineType: "reflow", templateName: "回流焊日常点检表", shiftType: "any" as const, frequencyType: "daily" as const, isActive: true },
  { id: "it-004", templateCode: "TPL-RFL-002", machineType: "reflow", templateName: "回流焊周点检表", shiftType: "any" as const, frequencyType: "weekly" as const, isActive: true },
  { id: "it-005", templateCode: "TPL-PRT-001", machineType: "printer", templateName: "印刷机日常点检表", shiftType: "any" as const, frequencyType: "daily" as const, isActive: true },
  { id: "it-006", templateCode: "TPL-PRT-002", machineType: "printer", templateName: "印刷机周点检表", shiftType: "any" as const, frequencyType: "weekly" as const, isActive: true },
  { id: "it-007", templateCode: "TPL-AOI-001", machineType: "AOI", templateName: "AOI日常点检表", shiftType: "any" as const, frequencyType: "daily" as const, isActive: true },
];

export const _demoInspectionAssignments = [
  { id: "ia-001", assignmentNo: "IA-20260627-001", machineId: "eq-001", machineCode: "SMT-NXT-01", machineType: "mounter", templateId: "it-001", templateName: "贴片机日常点检表", shiftDate: "2026-06-27", shiftType: "day" as const, assignedTo: "op-001", assignedToName: "Nguyen Van A", status: "completed" as const, scheduledStart: "2026-06-27T08:00:00Z", scheduledEnd: "2026-06-27T08:30:00Z" },
  { id: "ia-002", assignmentNo: "IA-20260627-002", machineId: "eq-002", machineCode: "SMT-NXT-02", machineType: "mounter", templateId: "it-001", templateName: "贴片机日常点检表", shiftDate: "2026-06-27", shiftType: "day" as const, assignedTo: "op-002", assignedToName: "Tran Thi B", status: "pending" as const, scheduledStart: "2026-06-27T08:00:00Z", scheduledEnd: "2026-06-27T08:30:00Z" },
  { id: "ia-003", assignmentNo: "IA-20260627-003", machineId: "eq-005", machineCode: "REF-V8-01", machineType: "reflow", templateId: "it-003", templateName: "回流焊日常点检表", shiftDate: "2026-06-27", shiftType: "day" as const, assignedTo: "op-001", assignedToName: "Nguyen Van A", status: "in_progress" as const, scheduledStart: "2026-06-27T08:00:00Z", scheduledEnd: "2026-06-27T08:20:00Z" },
  { id: "ia-004", assignmentNo: "IA-20260627-004", machineId: "eq-006", machineCode: "PRINTER-DEK-01", machineType: "printer", templateId: "it-005", templateName: "印刷机日常点检表", shiftDate: "2026-06-27", shiftType: "day" as const, assignedTo: "op-002", assignedToName: "Tran Thi B", status: "pending" as const, scheduledStart: "2026-06-27T08:00:00Z", scheduledEnd: "2026-06-27T08:15:00Z" },
  { id: "ia-005", assignmentNo: "IA-20260627-005", machineId: "eq-004", machineCode: "AOI-CTI-01", machineType: "AOI", templateId: "it-007", templateName: "AOI日常点检表", shiftDate: "2026-06-27", shiftType: "day" as const, assignedTo: "op-001", assignedToName: "Nguyen Van A", status: "completed" as const, scheduledStart: "2026-06-27T08:30:00Z", scheduledEnd: "2026-06-27T08:45:00Z" },
  { id: "ia-006", assignmentNo: "IA-20260627-006", machineId: "eq-003", machineCode: "SPI-VT-01", machineType: "SPI", templateId: "it-001", templateName: "SPI日常点检表", shiftDate: "2026-06-27", shiftType: "day" as const, assignedTo: "op-002", assignedToName: "Tran Thi B", status: "skipped" as const },
];

export const _demoInspectionRecords = [
  { id: "ir-001", recordNo: "IR-20260627-001", assignmentId: "ia-001", machineId: "eq-001", machineCode: "SMT-NXT-01", machineType: "mounter", lineId: "L001", lineName: "SMT Line 1", templateId: "it-001", templateName: "贴片机日常点检表", shiftDate: "2026-06-27", shiftType: "day" as const, inspectorId: "op-001", inspectorName: "Nguyen Van A", startedAt: "2026-06-27T08:05:00Z", completedAt: "2026-06-27T08:22:00Z", overallResult: "pass" as const, totalItems: 8, passedItems: 8, failedItems: 0, skippedItems: 0, hasCriticalFail: false, notes: "日常点检全部通过" },
  { id: "ir-002", recordNo: "IR-20260627-005", assignmentId: "ia-005", machineId: "eq-004", machineCode: "AOI-CTI-01", machineType: "AOI", lineId: "L001", lineName: "SMT Line 1", templateId: "it-007", templateName: "AOI日常点检表", shiftDate: "2026-06-27", shiftType: "day" as const, inspectorId: "op-001", inspectorName: "Nguyen Van A", startedAt: "2026-06-27T08:30:00Z", completedAt: "2026-06-27T08:42:00Z", overallResult: "pass" as const, totalItems: 6, passedItems: 6, failedItems: 0, skippedItems: 0, hasCriticalFail: false },
  { id: "ir-003", recordNo: "IR-20260626-001", assignmentId: "", machineId: "eq-001", machineCode: "SMT-NXT-01", machineType: "mounter", lineId: "L001", lineName: "SMT Line 1", templateId: "it-001", templateName: "贴片机日常点检表", shiftDate: "2026-06-26", shiftType: "day" as const, inspectorId: "op-002", inspectorName: "Tran Thi B", startedAt: "2026-06-26T08:05:00Z", completedAt: "2026-06-26T08:25:00Z", overallResult: "conditional" as const, totalItems: 8, passedItems: 7, failedItems: 0, skippedItems: 1, hasCriticalFail: false, notes: "相机光源轻微衰减，标记关注" },
];

export const _demoInspectionAbnormals = [
  { id: "ab-001", abnormalNo: "AB-20260626-001", recordId: "ir-003", recordItemId: "", machineId: "eq-001", machineCode: "SMT-NXT-01", abnormalityType: "defect" as const, description: "相机光源轻微衰减，光强略低于标准", severity: "medium" as const, status: "acknowledged" as const, reportedBy: "op-002", reportedAt: "2026-06-26T08:30:00Z", assignedTo: "eng-001", resolution: "已记录，计划下周更换光源" },
  { id: "ab-002", abnormalNo: "AB-20260625-001", recordId: "", machineId: "eq-006", machineCode: "PRINTER-DEK-01", abnormalityType: "critical_wear" as const, description: "刮刀压力传感器异常，印刷偏移增大", severity: "high" as const, status: "reported" as const, reportedBy: "op-001", reportedAt: "2026-06-25T09:00:00Z", maintenanceOrderId: "MO-20260625-001" },
];

export const _demoMachineOeeLogs = [
  { id: "oe-001", logDate: "2026-06-27", machineId: "eq-001", machineCode: "SMT-NXT-01", machineType: "mounter", lineId: "L001", lineName: "SMT Line 1", shiftType: "day" as const, plannedProdHours: 10, actualProdHours: 9.5, downtimeMinutes: 15, outputQty: 8500, defectQty: 25, oeeAvailability: 97.5, oeeQuality: 99.71, oeeOverall: 97.22, notes: "正常生产" },
  { id: "oe-002", logDate: "2026-06-27", machineId: "eq-002", machineCode: "SMT-NXT-02", machineType: "mounter", lineId: "L001", lineName: "SMT Line 1", shiftType: "day" as const, plannedProdHours: 10, actualProdHours: 9.8, downtimeMinutes: 8, outputQty: 8600, defectQty: 18, oeeAvailability: 98.67, oeeQuality: 99.79, oeeOverall: 98.46, notes: "良好运行" },
  { id: "oe-003", logDate: "2026-06-27", machineId: "eq-005", machineCode: "REF-V8-01", machineType: "reflow", lineId: "L001", lineName: "SMT Line 1", shiftType: "day" as const, plannedProdHours: 10, actualProdHours: 10, downtimeMinutes: 0, outputQty: 8600, defectQty: 32, oeeAvailability: 100, oeeQuality: 99.63, oeeOverall: 99.63, notes: "连续运行" },
  { id: "oe-004", logDate: "2026-06-27", machineId: "eq-003", machineCode: "SPI-VT-01", machineType: "SPI", lineId: "L001", lineName: "SMT Line 1", shiftType: "day" as const, plannedProdHours: 10, actualProdHours: 9.2, downtimeMinutes: 20, outputQty: 8400, defectQty: 42, oeeAvailability: 96.67, oeeQuality: 99.50, oeeOverall: 96.18, notes: "SPI检测稳定" },
];

export const _demoMachineStatusSnapshots = [
  { id: "ms-001", machineId: "eq-001", machineCode: "SMT-NXT-01", machineType: "mounter", status: "running" as const, currentProduct: "PCBA-A123", currentWorkOrder: "2606M0100001", outputCounter: 8500, defectCounter: 25, runningHours: 1250.5, idleMinutesToday: 15, maintenanceMinutesToday: 0, breakdownMinutesToday: 0, lastUpdated: "2026-06-27T10:30:00Z" },
  { id: "ms-002", machineId: "eq-002", machineCode: "SMT-NXT-02", machineType: "mounter", status: "running" as const, currentProduct: "PCBA-A123", currentWorkOrder: "2606M0100001", outputCounter: 8600, defectCounter: 18, runningHours: 980.0, idleMinutesToday: 8, maintenanceMinutesToday: 0, breakdownMinutesToday: 0, lastUpdated: "2026-06-27T10:30:00Z" },
  { id: "ms-003", machineId: "eq-005", machineCode: "REF-V8-01", machineType: "reflow", status: "running" as const, currentProduct: "PCBA-A123", currentWorkOrder: "2606M0100001", outputCounter: 8600, defectCounter: 32, runningHours: 2500.0, idleMinutesToday: 0, maintenanceMinutesToday: 0, breakdownMinutesToday: 0, lastUpdated: "2026-06-27T10:30:00Z" },
  { id: "ms-004", machineId: "eq-004", machineCode: "AOI-CTI-01", machineType: "AOI", status: "idle" as const, currentProduct: "PCBA-A123", currentWorkOrder: "2606M0100001", outputCounter: 8400, defectCounter: 0, runningHours: 980.0, idleMinutesToday: 20, maintenanceMinutesToday: 0, breakdownMinutesToday: 0, lastUpdated: "2026-06-27T10:30:00Z" },
  { id: "ms-005", machineId: "eq-006", machineCode: "PRINTER-DEK-01", machineType: "printer", status: "maintenance" as const, currentProduct: "PCBA-A123", currentWorkOrder: "2606M0100001", outputCounter: 0, defectCounter: 0, runningHours: 1280.0, idleMinutesToday: 0, maintenanceMinutesToday: 480, breakdownMinutesToday: 0, lastUpdated: "2026-06-27T10:30:00Z" },
];

// ── PM Schedule / 保养计划 ────────────────────────────────────────────────────

export const _demoPmTemplates = [
  { id: "pm-001", templateCode: "PM-MOUNTER-D", machineType: "mounter", frequencyCode: "daily", frequencyName: "每日", templateName: "贴片机每日保养", estDurationMinutes: 20, requiresShutdown: false, requiresEngineer: false, isActive: true },
  { id: "pm-002", templateCode: "PM-MOUNTER-W", machineType: "mounter", frequencyCode: "weekly", frequencyName: "每周", templateName: "贴片机每周保养", estDurationMinutes: 45, requiresShutdown: true, requiresEngineer: false, isActive: true },
  { id: "pm-003", templateCode: "PM-MOUNTER-M", machineType: "mounter", frequencyCode: "monthly", frequencyName: "每月", templateName: "贴片机每月保养", estDurationMinutes: 90, requiresShutdown: true, requiresEngineer: true, isActive: true },
  { id: "pm-004", templateCode: "PM-MOUNTER-Q", machineType: "mounter", frequencyCode: "quarterly", frequencyName: "每季度", templateName: "贴片机每季度保养", estDurationMinutes: 240, requiresShutdown: true, requiresEngineer: true, isActive: true },
  { id: "pm-005", templateCode: "PM-MOUNTER-Y", machineType: "mounter", frequencyCode: "yearly", frequencyName: "每年", templateName: "贴片机年度大保养", estDurationMinutes: 480, requiresShutdown: true, requiresEngineer: true, isActive: true },
  { id: "pm-006", templateCode: "PM-PRINTER-D", machineType: "printer", frequencyCode: "daily", frequencyName: "每日", templateName: "印刷机每日保养", estDurationMinutes: 15, requiresShutdown: false, requiresEngineer: false, isActive: true },
  { id: "pm-007", templateCode: "PM-PRINTER-M", machineType: "printer", frequencyCode: "monthly", frequencyName: "每月", templateName: "印刷机每月保养", estDurationMinutes: 60, requiresShutdown: true, requiresEngineer: true, isActive: true },
  { id: "pm-008", templateCode: "PM-REFLOW-D", machineType: "reflow", frequencyCode: "daily", frequencyName: "每日", templateName: "回流焊每日保养", estDurationMinutes: 15, requiresShutdown: false, requiresEngineer: false, isActive: true },
  { id: "pm-009", templateCode: "PM-REFLOW-M", machineType: "reflow", frequencyCode: "monthly", frequencyName: "每月", templateName: "回流焊每月保养", estDurationMinutes: 60, requiresShutdown: true, requiresEngineer: true, isActive: true },
  { id: "pm-010", templateCode: "PM-AOI-D", machineType: "AOI", frequencyCode: "daily", frequencyName: "每日", templateName: "AOI每日保养", estDurationMinutes: 10, requiresShutdown: false, requiresEngineer: false, isActive: true },
  { id: "pm-011", templateCode: "PM-AOI-M", machineType: "AOI", frequencyCode: "monthly", frequencyName: "每月", templateName: "AOI每月保养", estDurationMinutes: 45, requiresShutdown: true, requiresEngineer: true, isActive: true },
];

export const _demoPmScheduleAssignments = [
  { id: "psa-001", assetId: "eq-001", assetCode: "EQ-0001", machineCode: "SMT-NXT-01", machineType: "mounter", templateId: "pm-001", templateName: "贴片机每日保养", frequencyCode: "daily", frequencyName: "每日", nextDueDate: "2026-06-28", lastCompletedDate: "2026-06-27", assignedTeam: "production", isActive: true },
  { id: "psa-002", assetId: "eq-001", assetCode: "EQ-0001", machineCode: "SMT-NXT-01", machineType: "mounter", templateId: "pm-003", templateName: "贴片机每月保养", frequencyCode: "monthly", frequencyName: "每月", nextDueDate: "2026-07-04", lastCompletedDate: "2026-06-04", assignedTeam: "maintenance", isActive: true },
  { id: "psa-003", assetId: "eq-001", assetCode: "EQ-0001", machineCode: "SMT-NXT-01", machineType: "mounter", templateId: "pm-005", templateName: "贴片机年度大保养", frequencyCode: "yearly", frequencyName: "每年", nextDueDate: "2026-07-15", lastCompletedDate: "2025-07-10", assignedTeam: "maintenance", isActive: true },
  { id: "psa-004", assetId: "eq-005", assetCode: "EQ-0003", machineCode: "REF-V8-01", machineType: "reflow", templateId: "pm-008", templateName: "回流焊每日保养", frequencyCode: "daily", frequencyName: "每日", nextDueDate: "2026-06-28", lastCompletedDate: "2026-06-27", assignedTeam: "production", isActive: true },
  { id: "psa-005", assetId: "eq-005", assetCode: "EQ-0003", machineCode: "REF-V8-01", machineType: "reflow", templateId: "pm-009", templateName: "回流焊每月保养", frequencyCode: "monthly", frequencyName: "每月", nextDueDate: "2026-07-08", lastCompletedDate: "2026-06-08", assignedTeam: "maintenance", isActive: true },
  { id: "psa-006", assetId: "eq-006", assetCode: "EQ-0002", machineCode: "PRINTER-DEK-01", machineType: "printer", templateId: "pm-006", templateName: "印刷机每日保养", frequencyCode: "daily", frequencyName: "每日", nextDueDate: "2026-06-28", lastCompletedDate: "2026-06-27", assignedTeam: "production", isActive: true },
  { id: "psa-007", assetId: "eq-004", assetCode: "EQ-0004", machineCode: "AOI-CTI-01", machineType: "AOI", templateId: "pm-010", templateName: "AOI每日保养", frequencyCode: "daily", frequencyName: "每日", nextDueDate: "2026-06-27", lastCompletedDate: "2026-06-26", assignedTeam: "production", isActive: true },
  { id: "psa-008", assetId: "eq-004", assetCode: "EQ-0004", machineCode: "AOI-CTI-01", machineType: "AOI", templateId: "pm-011", templateName: "AOI每月保养", frequencyCode: "monthly", frequencyName: "每月", nextDueDate: "2026-06-10", lastCompletedDate: "", assignedTeam: "maintenance", isActive: true },
];

export const _demoPmExecutionLogs = [
  { id: "pel-001", logNo: "PEL-20260627-001", assignmentId: "psa-001", maintenanceOrderId: "MO-PM-001", templateId: "pm-001", templateName: "贴片机每日保养", assetId: "eq-001", assetCode: "EQ-0001", scheduledDate: "2026-06-27", completedDate: "2026-06-27", executedBy: "op-001", executedByName: "Nguyen Van A", totalTasks: 4, completedTasks: 4, passedTasks: 4, failedTasks: 0, result: "pass" as const, notes: "全部通过" },
  { id: "pel-002", logNo: "PEL-20260608-001", assignmentId: "psa-005", maintenanceOrderId: "MO-PM-002", templateId: "pm-009", templateName: "回流焊每月保养", assetId: "eq-005", assetCode: "EQ-0003", scheduledDate: "2026-06-08", completedDate: "2026-06-08", executedBy: "eng-001", executedByName: "Pham Van Long", totalTasks: 2, completedTasks: 2, passedTasks: 2, failedTasks: 0, result: "pass" as const, notes: "炉温曲线测试通过" },
  { id: "pel-003", logNo: "PEL-20260604-001", assignmentId: "psa-002", maintenanceOrderId: "MO-PM-003", templateId: "pm-003", templateName: "贴片机每月保养", assetId: "eq-001", assetCode: "EQ-0001", scheduledDate: "2026-06-04", completedDate: "2026-06-04", executedBy: "eng-001", executedByName: "Pham Van Long", totalTasks: 3, completedTasks: 3, passedTasks: 2, failedTasks: 1, result: "conditional" as const, notes: "皮带张力略低，计划下周调整" },
];

// ── MES Station definitions ─────────────────────────────────────────

export const stationDefs: StationDef[] = [
  // SMT section
  { key: "printer", name: { name_zh: "印刷机", name_en: "Solder Paste Printer", name_vi: "Máy in" }, section: "smt", integration: "hardware", description: { name_zh: "锡膏印刷参数自动核对", name_en: "Auto-verify print parameters with SOP", name_vi: "Tự động đối chiếu thông số in với SOP" } },
  { key: "spi", name: { name_zh: "SPI检测", name_en: "SPI Check", name_vi: "Kiểm tra SPI" }, section: "smt", integration: "hardware", description: { name_zh: "锡膏厚度检测参数上传", name_en: "Solder paste inspection parameters upload", name_vi: "Tải lên thông số kiểm tra kem hàn" } },
  { key: "ai1", name: { name_zh: "AI1插件机", name_en: "AI1 Inserter", name_vi: "Máy cắm AI1" }, section: "smt", integration: "hardware", description: { name_zh: "立式插件防错料", name_en: "Vertical insertion anti-mistake", name_vi: "Chống nhầm linh kiện cắm đứng" } },
  { key: "ai2", name: { name_zh: "AI2插件机", name_en: "AI2 Inserter", name_vi: "Máy cắm AI2" }, section: "smt", integration: "hardware", description: { name_zh: "异型插件防错料", name_en: "Odd-form insertion anti-mistake", name_vi: "Chống nhầm linh kiện cắm đặc thù" } },
  { key: "mount1", name: { name_zh: "贴片1", name_en: "Mount 1", name_vi: "Gắp chip 1" }, section: "smt", integration: "hardware", description: { name_zh: "贴片机防错料", name_en: "Mounter anti-mistake", name_vi: "Chống nhầm máy gắp chip" } },
  { key: "mount2", name: { name_zh: "贴片2", name_en: "Mount 2", name_vi: "Gắp chip 2" }, section: "smt", integration: "hardware", description: { name_zh: "贴片机防错料", name_en: "Mounter anti-mistake", name_vi: "Chống nhầm máy gắp chip" } },
  { key: "reflow", name: { name_zh: "回流焊", name_en: "Reflow Oven", name_vi: "Hàn reflow" }, section: "smt", integration: "hardware", description: { name_zh: "回流焊温度PWI实时监控", name_en: "Real-time reflow temperature/PWI monitoring", name_vi: "Giám sát thời gian thực nhiệt độ/PWI" } },
  { key: "smt_aoi", name: { name_zh: "SMT-AOI检测", name_en: "SMT-AOI Check", name_vi: "Kiểm tra SMT-AOI" }, section: "smt", integration: "hardware", description: { name_zh: "SMT段AOI检测报表实时上传", name_en: "SMT AOI inspection report real-time upload", name_vi: "Tải lên thời gian thực báo cáo AOI SMT" } },
  { key: "pcba_load", name: { name_zh: "PCBA上料", name_en: "PCBA Loading", name_vi: "Nạp PCBA" }, section: "smt", integration: "software", description: { name_zh: "PCB开封管控结束时间", name_en: "PCB opening control end time", name_vi: "Thời gian kết thúc kiểm soát mở PCB" } },
  { key: "pda_load", name: { name_zh: "PDA上料", name_en: "PDA Loading", name_vi: "Nạp PDA" }, section: "smt", integration: "hardware", description: { name_zh: "PDA扫码上料记录物料D/C", name_en: "PDA scan loading records material D/C", name_vi: "Quét PDA nạp liệu ghi D/C vật tư" } },
  // Post-SMT section
  { key: "ws_aoi", name: { name_zh: "WS-AOI检测", name_en: "WS-AOI Check", name_vi: "Kiểm tra WS-AOI" }, section: "post_smt", integration: "hardware", description: { name_zh: "波峰焊后AOI误报率/真性不良统计", name_en: "Post-wave-solder AOI false call / true defect stats", name_vi: "Thống kê sai lệch AOI sau hàn sóng" } },
  { key: "ict", name: { name_zh: "ICT检测", name_en: "ICT Check", name_vi: "Kiểm tra ICT" }, section: "post_smt", integration: "hardware", description: { name_zh: "ICT测试数据实时上传/顶针寿命管控", name_en: "ICT test data upload / pin life management", name_vi: "Tải dữ liệu test ICT/quản lý tuổi thọ kim" } },
  { key: "fct", name: { name_zh: "FCT检测", name_en: "FCT Check", name_vi: "Kiểm tra FCT" }, section: "post_smt", integration: "hardware", description: { name_zh: "FCT测试数据实时上传/顶针寿命管控", name_en: "FCT test data upload / pin life management", name_vi: "Tải dữ liệu test FCT/quản lý tuổi thọ kim" } },
  { key: "pcba_divide", name: { name_zh: "分板", name_en: "PCBA Divide", name_vi: "Cắt PCBA" }, section: "post_smt", integration: "software", description: { name_zh: "分板机铣刀寿命管控", name_en: "Router bit life management", name_vi: "Quản lý tuổi thọ mũi cắt" } },
  { key: "pcba_link", name: { name_zh: "PCBA绑码", name_en: "PCBA Link", name_vi: "Liên kết PCBA" }, section: "post_smt", integration: "software", description: { name_zh: "PCBA SN与外壳SN绑定", name_en: "Bind PCBA SN to case SN", name_vi: "Liên kết SN PCBA với SN vỏ" } },
  { key: "ate1", name: { name_zh: "ATE1测试", name_en: "ATE1 Test", name_vi: "Kiểm tra ATE1" }, section: "post_smt", integration: "hardware", description: { name_zh: "ATE半成品测试数据上传/模版下载", name_en: "ATE semi-product test data upload / template download", name_vi: "Tải lên dữ liệu test ATE bán thành phẩm" } },
  { key: "ultrasonic", name: { name_zh: "超声", name_en: "Ultrasonic", name_vi: "Hàn siêu âm" }, section: "post_smt", integration: "hardware", description: { name_zh: "超声参数上传/实时监控", name_en: "Ultrasonic parameter upload / real-time monitoring", name_vi: "Tải thông số siêu âm/giám sát thời gian thực" } },
  { key: "bi_loading", name: { name_zh: "老化上机", name_en: "Burn-in Loading", name_vi: "Nạp già hóa" }, section: "post_smt", integration: "hardware", description: { name_zh: "老化柜装载", name_en: "Burn-in chamber loading", name_vi: "Nạp tủ già hóa" } },
  { key: "burn_in", name: { name_zh: "老化", name_en: "Burn-in", name_vi: "Già hóa" }, section: "post_smt", integration: "hardware", description: { name_zh: "老化测试数据上传/模版下载", name_en: "Burn-in test data upload / template download", name_vi: "Tải dữ liệu test già hóa" } },
  { key: "hi_pot", name: { name_zh: "高压测试", name_en: "Hi-Pot Test", name_vi: "Kiểm tra cao áp" }, section: "post_smt", integration: "hardware", description: { name_zh: "耐压测试数据上传/模版下载", name_en: "Hi-Pot test data upload / template download", name_vi: "Tải dữ liệu test cao áp" } },
  { key: "ate2", name: { name_zh: "ATE2测试", name_en: "ATE2 Test", name_vi: "Kiểm tra ATE2" }, section: "post_smt", integration: "hardware", description: { name_zh: "ATE成品测试数据上传/真性误报统计", name_en: "ATE final test data upload / true defect stats", name_vi: "Tải dữ liệu test ATE thành phẩm" } },
  { key: "code_link", name: { name_zh: "CODE绑码", name_en: "Code Link", name_vi: "Liên kết CODE" }, section: "post_smt", integration: "software", description: { name_zh: "外壳SN与铭牌SN绑定", name_en: "Bind case SN to nameplate SN", name_vi: "Liên kết SN vỏ với SN nhãn" } },
  // Packaging section
  { key: "packing", name: { name_zh: "包装", name_en: "Packing", name_vi: "Đóng gói" }, section: "packaging", integration: "software", description: { name_zh: "外箱标签打印（含所有SN信息）", name_en: "Outer box label print (with all SN info)", name_vi: "In nhãn thùng (bao gồm tất cả SN)" } },
  { key: "pallet_label", name: { name_zh: "栈板标签", name_en: "Pallet Label", name_vi: "Nhãn pallet" }, section: "packaging", integration: "software", description: { name_zh: "PO/客户/数量/多箱集成栈板标签", name_en: "PO/customer/qty pallet label generation", name_vi: "Tạo nhãn pallet PO/khách hàng/số lượng" } },
  // OQC section
  { key: "oqc_hi_pot", name: { name_zh: "OQC耐压", name_en: "OQC Hi-Pot", name_vi: "OQC cao áp" }, section: "oqc", integration: "hardware", description: { name_zh: "OQC耐压测试数据上传", name_en: "OQC hi-pot test data upload", name_vi: "Tải lên dữ liệu test OQC cao áp" } },
  { key: "oqc_ate2", name: { name_zh: "OQC-ATE2", name_en: "OQC-ATE2", name_vi: "OQC-ATE2" }, section: "oqc", integration: "hardware", description: { name_zh: "OQC-ATE2测试数据上传", name_en: "OQC-ATE2 test data upload", name_vi: "Tải lên dữ liệu test OQC-ATE2" } },
  { key: "oqc_cosmetic", name: { name_zh: "OQC外观", name_en: "OQC Cosmetic", name_vi: "OQC ngoại quan" }, section: "oqc", integration: "software", description: { name_zh: "OQC外观检验", name_en: "OQC cosmetic inspection", name_vi: "Kiểm tra ngoại quan OQC" } },
  { key: "oqc_replace", name: { name_zh: "OQC替换", name_en: "OQC Replace", name_vi: "OQC thay thế" }, section: "oqc", integration: "software", description: { name_zh: "OQC不良品替换并重新打印标签", name_en: "OQC defective replacement and reprint label", name_vi: "Thay thế sản phẩm lỗi OQC và in lại nhãn" } },
  { key: "oqc_report", name: { name_zh: "OQC报表记录", name_en: "OQC Report Records", name_vi: "Báo cáo OQC" }, section: "oqc", integration: "software", description: { name_zh: "OQC检验报表记录与归档", name_en: "OQC inspection report records and archiving", name_vi: "Ghi chép và lưu trữ báo cáo OQC" } },
  // Auxiliary section
  { key: "barcode_convert", name: { name_zh: "条码转换", name_en: "Barcode Convert", name_vi: "Chuyển đổi mã vạch" }, section: "auxiliary", integration: "software", description: { name_zh: "不良标签更换", name_en: "Defective label replacement", name_vi: "Thay thế nhãn lỗi" } },
  { key: "decoding", name: { name_zh: "解码", name_en: "Decoding", name_vi: "Giải mã" }, section: "auxiliary", integration: "software", description: { name_zh: "功能测试不良后系统解锁重新测试", name_en: "System unlock for retest after functional failure", name_vi: "Mở khóa hệ thống để kiểm tra lại" } },
  { key: "pcba_bake", name: { name_zh: "PCBA烘烤", name_en: "PCBA Bake", name_vi: "Sấy PCBA" }, section: "auxiliary", integration: "software", description: { name_zh: "PCBA开封超168H需烘烤2H", name_en: "PCBA opened >168H requires 2H bake", name_vi: "PCBA mở >168H cần sấy 2H" } },
  { key: "visual_defect_upload", name: { name_zh: "外观不良上传", name_en: "Visual Defect Upload", name_vi: "Tải lên lỗi ngoại quan" }, section: "auxiliary", integration: "software", description: { name_zh: "外观不良图片上传记录", name_en: "Visual defect photo upload record", name_vi: "Tải lên ảnh lỗi ngoại quan" } },
  { key: "repair_report", name: { name_zh: "维修报表", name_en: "Repair Report", name_vi: "Báo cáo sửa lỗi" }, section: "auxiliary", integration: "software", description: { name_zh: "维修记录报表", name_en: "Repair record report", name_vi: "Báo cáo ghi chép sửa lỗi" } },
];

export const lineStationMap: Record<string, StationKey[]> = {
  "line-smt-01": ["printer", "spi", "mount1", "mount2", "reflow", "smt_aoi", "pcba_load"],
  "line-smt-02": ["printer", "spi", "ai1", "mount1", "mount2", "reflow", "smt_aoi", "pcba_load", "pda_load"],
  "line-semi-auto-02": ["ai1", "pda_load", "ws_aoi", "ict", "fct", "pcba_divide", "pcba_link", "ate1", "ultrasonic", "hi_pot", "ate2", "code_link"],
  "line-pkg-03": ["packing", "pallet_label", "oqc_hi_pot", "oqc_ate2", "oqc_cosmetic", "oqc_replace", "oqc_report"],
  "line-manual-04": ["pcba_divide", "pcba_link", "ate1", "ultrasonic", "bi_loading", "burn_in", "hi_pot", "ate2", "code_link"],
  "line-rework-99": ["barcode_convert", "decoding", "pcba_bake", "visual_defect_upload", "repair_report"],
};

export const demoStationStates: Record<string, LineStationState[]> = {
  "line-smt-01": [
    { stationKey: "printer", status: "ok", cycleTime: 15, defectRate: 0.3, output: 8420 },
    { stationKey: "spi", status: "ok", cycleTime: 8, defectRate: 0.2, output: 8420 },
    { stationKey: "mount1", status: "ok", cycleTime: 45, defectRate: 0.15, output: 8400 },
    { stationKey: "mount2", status: "ok", cycleTime: 42, defectRate: 0.1, output: 8400 },
    { stationKey: "reflow", status: "ok", cycleTime: 60, defectRate: 0.05, output: 8400 },
    { stationKey: "smt_aoi", status: "warning", cycleTime: 18, defectRate: 1.2, output: 8380 },
    { stationKey: "pcba_load", status: "info", cycleTime: 5, output: 8380 },
  ],
  "line-smt-02": [
    { stationKey: "printer", status: "ok", cycleTime: 16, defectRate: 0.2, output: 5280 },
    { stationKey: "spi", status: "warning", cycleTime: 10, defectRate: 0.8, output: 5270 },
    { stationKey: "ai1", status: "ok", cycleTime: 20, defectRate: 0.3, output: 5270 },
    { stationKey: "mount1", status: "ok", cycleTime: 48, defectRate: 0.2, output: 5260 },
    { stationKey: "mount2", status: "ok", cycleTime: 44, defectRate: 0.15, output: 5260 },
    { stationKey: "reflow", status: "ok", cycleTime: 62, defectRate: 0.08, output: 5250 },
    { stationKey: "smt_aoi", status: "danger", cycleTime: 22, defectRate: 3.5, output: 5220 },
    { stationKey: "pcba_load", status: "info", cycleTime: 6, output: 5220 },
    { stationKey: "pda_load", status: "ok", cycleTime: 8, output: 5220 },
  ],
  "line-semi-auto-02": [
    { stationKey: "ai1", status: "ok", cycleTime: 18, defectRate: 0.2, output: 3200 },
    { stationKey: "pda_load", status: "ok", cycleTime: 7, output: 3200 },
    { stationKey: "ws_aoi", status: "warning", cycleTime: 20, defectRate: 1.8, output: 3180 },
    { stationKey: "ict", status: "ok", cycleTime: 25, defectRate: 0.5, output: 3160 },
    { stationKey: "fct", status: "ok", cycleTime: 30, defectRate: 0.6, output: 3150 },
    { stationKey: "pcba_divide", status: "ok", cycleTime: 12, defectRate: 0.1, output: 3150 },
    { stationKey: "pcba_link", status: "ok", cycleTime: 8, output: 3150 },
    { stationKey: "ate1", status: "ok", cycleTime: 35, defectRate: 0.8, output: 3120 },
    { stationKey: "ultrasonic", status: "ok", cycleTime: 15, defectRate: 0.2, output: 3100 },
    { stationKey: "hi_pot", status: "warning", cycleTime: 20, defectRate: 1.5, output: 3080 },
    { stationKey: "ate2", status: "ok", cycleTime: 40, defectRate: 0.9, output: 3050 },
    { stationKey: "code_link", status: "info", cycleTime: 6, output: 3050 },
  ],
  "line-pkg-03": [
    { stationKey: "packing", status: "idle", cycleTime: 10, output: 0 },
    { stationKey: "pallet_label", status: "idle", cycleTime: 5, output: 0 },
    { stationKey: "oqc_hi_pot", status: "idle", output: 0 },
    { stationKey: "oqc_ate2", status: "idle", output: 0 },
    { stationKey: "oqc_cosmetic", status: "idle", output: 0 },
    { stationKey: "oqc_replace", status: "idle", output: 0 },
    { stationKey: "oqc_report", status: "idle", output: 0 },
  ],
  "line-manual-04": [
    { stationKey: "pcba_divide", status: "idle", cycleTime: 15, output: 0 },
    { stationKey: "pcba_link", status: "idle", output: 0 },
    { stationKey: "ate1", status: "idle", output: 0 },
    { stationKey: "ultrasonic", status: "idle", output: 0 },
    { stationKey: "bi_loading", status: "idle", output: 0 },
    { stationKey: "burn_in", status: "idle", output: 0 },
    { stationKey: "hi_pot", status: "idle", output: 0 },
    { stationKey: "ate2", status: "idle", output: 0 },
    { stationKey: "code_link", status: "idle", output: 0 },
  ],
  "line-rework-99": [
    { stationKey: "barcode_convert", status: "warning", output: 118 },
    { stationKey: "decoding", status: "ok", output: 45 },
    { stationKey: "pcba_bake", status: "info", output: 0 },
    { stationKey: "visual_defect_upload", status: "ok", output: 12 },
    { stationKey: "repair_report", status: "ok", output: 30 },
  ],
};

// ── Finance MVP demo data ──────────────────────────────────────────

export const financeInvoices: FinanceInvoiceSummary[] = [
  {
    invoiceId: "INV-AR-2026-0001",
    partyCode: "CUST-SHARP-001",
    partyName: { name_zh: "夏普电子越南", name_en: "Sharp Electronics VN", name_vi: "Sharp Electronics VN" },
    invoiceNo: "AR-2026-0001",
    totalAmount: 125000.00,
    paidAmount: 125000.00,
    balanceAmount: 0,
    currency: "USD",
    invoiceDate: "2026-04-15",
    dueDate: "2026-05-15",
    status: "paid",
  },
  {
    invoiceId: "INV-AR-2026-0002",
    partyCode: "CUST-SONY-002",
    partyName: { name_zh: "索尼越南", name_en: "Sony Vietnam", name_vi: "Sony Việt Nam" },
    invoiceNo: "AR-2026-0002",
    totalAmount: 89200.00,
    paidAmount: 50000.00,
    balanceAmount: 39200.00,
    currency: "USD",
    invoiceDate: "2026-05-01",
    dueDate: "2026-06-01",
    status: "partial",
  },
  {
    invoiceId: "INV-AR-2026-0003",
    partyCode: "CUST-LG-003",
    partyName: { name_zh: "LG 电子", name_en: "LG Electronics", name_vi: "LG Electronics" },
    invoiceNo: "AR-2026-0003",
    totalAmount: 215000.00,
    paidAmount: 0,
    balanceAmount: 215000.00,
    currency: "USD",
    invoiceDate: "2026-05-20",
    dueDate: "2026-06-20",
    status: "open",
  },
  {
    invoiceId: "INV-AR-2026-0004",
    partyCode: "CUST-PANASONIC-004",
    partyName: { name_zh: "松下电器", name_en: "Panasonic", name_vi: "Panasonic" },
    invoiceNo: "AR-2026-0004",
    totalAmount: 47800.00,
    paidAmount: 0,
    balanceAmount: 47800.00,
    currency: "USD",
    invoiceDate: "2026-03-10",
    dueDate: "2026-04-10",
    status: "overdue",
  },
  {
    invoiceId: "INV-AR-2026-0005",
    partyCode: "CUST-TOSHIBA-005",
    partyName: { name_zh: "东芝越南", name_en: "Toshiba Vietnam", name_vi: "Toshiba Việt Nam" },
    invoiceNo: "AR-2026-0005",
    totalAmount: 156000.00,
    paidAmount: 0,
    balanceAmount: 156000.00,
    currency: "USD",
    invoiceDate: "2026-02-05",
    dueDate: "2026-03-05",
    status: "overdue",
  },
  {
    invoiceId: "INV-AR-2026-0006",
    partyCode: "CUST-VIETTEL-006",
    partyName: { name_zh: "越捷科技", name_en: "Viettel Tech", name_vi: "Viettel Tech" },
    invoiceNo: "AR-2026-0006",
    totalAmount: 67200.00,
    paidAmount: 67200.00,
    balanceAmount: 0,
    currency: "USD",
    invoiceDate: "2026-05-15",
    dueDate: "2026-06-15",
    status: "paid",
  },
  {
    invoiceId: "INV-AP-2026-0001",
    partyCode: "SUPP-MURATA-001",
    partyName: { name_zh: "村田制作所", name_en: "Murata Mfg.", name_vi: "Murata" },
    invoiceNo: "AP-2026-0001",
    totalAmount: 42000.00,
    paidAmount: 0,
    balanceAmount: 42000.00,
    currency: "USD",
    invoiceDate: "2026-05-25",
    dueDate: "2026-07-25",
    status: "open",
  },
  {
    invoiceId: "INV-AP-2026-0002",
    partyCode: "SUPP-TDK-002",
    partyName: { name_zh: "TDK 株式会社", name_en: "TDK Corporation", name_vi: "TDK Corporation" },
    invoiceNo: "AP-2026-0002",
    totalAmount: 28500.00,
    paidAmount: 28500.00,
    balanceAmount: 0,
    currency: "USD",
    invoiceDate: "2026-04-20",
    dueDate: "2026-05-20",
    status: "paid",
  },
];

export const payments: PaymentRecord[] = [
  {
    id: "PAY-2026-0001",
    paymentNo: "PAY-IN-2026-0001",
    direction: "IN",
    partyType: "customer",
    partyId: "CUST-SHARP-001",
    invoiceId: "INV-AR-2026-0001",
    amount: 125000.00,
    currency: "USD",
    paidAt: "2026-05-10",
    method: "银行转账",
    referenceNo: "TT20260510001",
  },
  {
    id: "PAY-2026-0002",
    paymentNo: "PAY-IN-2026-0002",
    direction: "IN",
    partyType: "customer",
    partyId: "CUST-SONY-002",
    invoiceId: "INV-AR-2026-0002",
    amount: 50000.00,
    currency: "USD",
    paidAt: "2026-05-25",
    method: "信用证",
    referenceNo: "LC20260525002",
  },
  {
    id: "PAY-2026-0003",
    paymentNo: "PAY-IN-2026-0003",
    direction: "IN",
    partyType: "customer",
    partyId: "CUST-VIETTEL-006",
    invoiceId: "INV-AR-2026-0006",
    amount: 67200.00,
    currency: "USD",
    paidAt: "2026-06-12",
    method: "银行转账",
    referenceNo: "TT20260612003",
  },
  {
    id: "PAY-2026-0004",
    paymentNo: "PAY-OUT-2026-0001",
    direction: "OUT",
    partyType: "supplier",
    partyId: "SUPP-MURATA-001",
    amount: 18000.00,
    currency: "USD",
    paidAt: "2026-05-30",
    method: "银行转账",
    referenceNo: "TT20260530004",
  },
  {
    id: "PAY-2026-0005",
    paymentNo: "PAY-OUT-2026-0002",
    direction: "OUT",
    partyType: "supplier",
    partyId: "SUPP-TDK-002",
    invoiceId: "INV-AP-2026-0002",
    amount: 28500.00,
    currency: "USD",
    paidAt: "2026-05-18",
    method: "银行转账",
    referenceNo: "TT20260518005",
  },
  {
    id: "PAY-2026-0006",
    paymentNo: "PAY-OUT-2026-0003",
    direction: "OUT",
    partyType: "supplier",
    partyId: "SUPP-MURATA-001",
    amount: 9500.00,
    currency: "USD",
    paidAt: "2026-06-05",
    method: "银行转账",
    referenceNo: "TT20260605006",
  },
];

export const costSummaries: CostSummary[] = [
  {
    workOrderCode: "26061010001",
    productCode: "PROD-CPU-A1",
    productName: { name_zh: "CPU 控制板 A1", name_en: "CPU Control Board A1", name_vi: "Bo mạch CPU A1" },
    materialCost: 4520.50,
    laborCost: 0,
    overheadCost: 0,
    totalCost: 4520.50,
    currency: "USD",
    costStatus: "calculated",
    updatedAt: "2026-06-15T10:30:00+07:00",
  },
  {
    workOrderCode: "26061010002",
    productCode: "PROD-SENSOR-B2",
    productName: { name_zh: "传感器板 B2", name_en: "Sensor Board B2", name_vi: "Bo cảm biến B2" },
    materialCost: 2890.75,
    laborCost: 0,
    overheadCost: 0,
    totalCost: 2890.75,
    currency: "USD",
    costStatus: "closed",
    updatedAt: "2026-06-16T14:20:00+07:00",
  },
  {
    workOrderCode: "26061010003",
    productCode: "PROD-POWER-C3",
    productName: { name_zh: "电源管理板 C3", name_en: "Power Mgmt Board C3", name_vi: "Bo quản lý nguồn C3" },
    materialCost: 6120.00,
    laborCost: 0,
    overheadCost: 0,
    totalCost: 6120.00,
    currency: "USD",
    costStatus: "draft",
    updatedAt: "2026-06-18T09:15:00+07:00",
  },
  {
    workOrderCode: "26061020001",
    productCode: "PROD-DISPLAY-D1",
    productName: { name_zh: "显示模块 D1", name_en: "Display Module D1", name_vi: "Mô-đun hiển thị D1" },
    materialCost: 8745.20,
    laborCost: 0,
    overheadCost: 0,
    totalCost: 8745.20,
    currency: "USD",
    costStatus: "calculated",
    updatedAt: "2026-06-17T16:45:00+07:00",
  },
];

// ── Sales MVP demo data ──────────────────────────────────────────────

export const salesQuotes: SalesQuote[] = [
  {
    id: "Q-2026-0001",
    quoteNo: "SQ-2026-0001",
    customerCode: "CUST-SHARP-001",
    contactName: "Tanaka Hiroshi",
    currency: "USD",
    totalAmount: 145200,
    status: "accepted",
    validUntil: "2026-07-15",
    createdAt: "2026-05-20",
    lines: [
      { productCode: "PROD-CPU-A1", productName: { name_zh: "CPU 控制板 A1", name_en: "CPU Control Board A1", name_vi: "Bo mạch CPU A1" }, qty: 500, unitPrice: 145, leadTimeDays: 30, notes: "MP priority" },
      { productCode: "PROD-SENSOR-B2", productName: { name_zh: "传感器板 B2", name_en: "Sensor Board B2", name_vi: "Bo cảm biến B2" }, qty: 1000, unitPrice: 72.6, leadTimeDays: 30 },
    ],
  },
  {
    id: "Q-2026-0002",
    quoteNo: "SQ-2026-0002",
    customerCode: "CUST-SONY-002",
    contactName: "Nguyen Van Minh",
    currency: "USD",
    totalAmount: 87200,
    status: "sent",
    validUntil: "2026-06-25",
    createdAt: "2026-06-10",
    lines: [
      { productCode: "PROD-DISPLAY-D1", productName: { name_zh: "显示模块 D1", name_en: "Display Module D1", name_vi: "Mô-đun hiển thị D1" }, qty: 200, unitPrice: 436, leadTimeDays: 45 },
    ],
  },
  {
    id: "Q-2026-0003",
    quoteNo: "SQ-2026-0003",
    customerCode: "CUST-LG-003",
    contactName: "Park Ji-hoon",
    currency: "USD",
    totalAmount: 213500,
    status: "draft",
    validUntil: "2026-07-30",
    createdAt: "2026-06-18",
    lines: [
      { productCode: "PROD-POWER-C3", productName: { name_zh: "电源管理板 C3", name_en: "Power Mgmt Board C3", name_vi: "Bo quản lý nguồn C3" }, qty: 500, unitPrice: 285, leadTimeDays: 35 },
      { productCode: "PROD-CPU-A1", productName: { name_zh: "CPU 控制板 A1", name_en: "CPU Control Board A1", name_vi: "Bo mạch CPU A1" }, qty: 250, unitPrice: 148, leadTimeDays: 35 },
    ],
  },
];

export const salesOrders: SalesOrder[] = [
  {
    id: "SO-2026-0001",
    soNo: "SO-2026-0001",
    customerCode: "CUST-SHARP-001",
    quoteNo: "SQ-2026-0001",
    currency: "USD",
    totalAmount: 145200,
    status: "partially_fulfilled",
    fulfilledPercent: 65,
    createdAt: "2026-06-01",
    lines: [
      { productCode: "PROD-CPU-A1", productName: { name_zh: "CPU 控制板 A1", name_en: "CPU Control Board A1", name_vi: "Bo mạch CPU A1" }, qty: 500, fulfilledQty: 325, unitPrice: 145, plannedDelivery: "2026-07-10", workOrderCodes: ["26061010001"] },
      { productCode: "PROD-SENSOR-B2", productName: { name_zh: "传感器板 B2", name_en: "Sensor Board B2", name_vi: "Bo cảm biến B2" }, qty: 1000, fulfilledQty: 650, unitPrice: 72.6, plannedDelivery: "2026-07-15", workOrderCodes: ["26061010002"] },
    ],
  },
  {
    id: "SO-2026-0002",
    soNo: "SO-2026-0002",
    customerCode: "CUST-VIETTEL-006",
    currency: "USD",
    totalAmount: 67200,
    status: "fulfilled",
    fulfilledPercent: 100,
    createdAt: "2026-05-15",
    lines: [
      { productCode: "PROD-CPU-A1", productName: { name_zh: "CPU 控制板 A1", name_en: "CPU Control Board A1", name_vi: "Bo mạch CPU A1" }, qty: 200, fulfilledQty: 200, unitPrice: 168, plannedDelivery: "2026-06-10", workOrderCodes: ["26061010003"] },
    ],
  },
];

export const quoteConversions: QuoteConversionRow[] = [
  { quoteNo: "SQ-2026-0001", customerCode: "CUST-SHARP-001", acceptedAt: "2026-05-25", soNo: "SO-2026-0001", poNo: "PO-2026-0042", workOrderCodes: ["26061010001", "26061010002"], status: "converted" },
  { quoteNo: "SQ-2026-0002", customerCode: "CUST-SONY-002", acceptedAt: "", workOrderCodes: [], status: "pending" },
  { quoteNo: "SQ-2026-0004", customerCode: "CUST-PANASONIC-004", acceptedAt: "2026-04-10", workOrderCodes: [], status: "lost" },
];

// ── Customer Service MVP demo data ──────────────────────────────────

export const serviceTickets: ServiceTicket[] = [
  { id: "TKT-2026-0001", ticketNo: "TKT-2026-0001", customerCode: "CUST-SONY-002", category: "complaint", priority: "high", status: "in_progress", subject: "显示模块信号异常", slaDueAt: "2026-06-20T16:00:00Z", assignee: "VN_CS_001" },
  { id: "TKT-2026-0002", ticketNo: "TKT-2026-0002", customerCode: "CUST-LG-003", category: "quality_issue", priority: "urgent", status: "open", subject: "批量产品外观划痕", slaDueAt: "2026-06-19T20:00:00Z" },
  { id: "TKT-2026-0003", ticketNo: "TKT-2026-0003", customerCode: "CUST-VIETTEL-006", category: "defect_report", priority: "normal", status: "resolved", subject: "PCB 焊接缺陷反馈", slaDueAt: "2026-06-22T16:00:00Z", assignee: "VN_CS_002" },
  { id: "TKT-2026-0004", ticketNo: "TKT-2026-0004", customerCode: "CUST-SHARP-001", category: "complaint", priority: "low", status: "closed", subject: "包装数量短缺", slaDueAt: "2026-06-30T16:00:00Z", assignee: "VN_CS_001" },
];

export const rmaRequests: RmaRequest[] = [
  { id: "RMA-2026-0001", rmaNumber: "RMA-2026-0001", customerCode: "CUST-SONY-002", productCode: "PROD-DISPLAY-D1", serialNo: "D1SN-260615-0042", qty: 50, reasonCode: "DEFECT-COSMETIC", customerComplaint: "50 个 D1 模块屏幕有划痕", receivedAt: "2026-06-17", inspectionResult: "fail", disposition: "repair", status: "inspecting", createdAt: "2026-06-15" },
  { id: "RMA-2026-0002", rmaNumber: "RMA-2026-0002", customerCode: "CUST-SHARP-001", productCode: "PROD-CPU-A1", serialNo: "A1SN-260610-0008", qty: 12, reasonCode: "DEFECT-FUNCTIONAL", customerComplaint: "12 块 CPU 板无法启动", inspectionResult: "pending", status: "submitted", createdAt: "2026-06-18" },
  { id: "RMA-2026-0003", rmaNumber: "RMA-2026-0003", customerCode: "CUST-LG-003", productCode: "PROD-POWER-C3", serialNo: "C3SN-260605-0220", qty: 25, reasonCode: "DEFECT-ELEC", customerComplaint: "电源管理板输出电压异常", inspectionResult: "pass", disposition: "replace", status: "closed", createdAt: "2026-06-05" },
];

export const rmaRepairRecords: RmaRepairRecord[] = [
  { id: "REP-2026-0001", rmaNo: "RMA-2026-0001", defectCode: "DEFECT-COSMETIC", actionTaken: "更换屏幕保护膜，重新贴附", partsUsed: "保护膜 50 张", startedAt: "2026-06-18T09:00:00Z", operatorName: "VN_REPAIR_001", result: "in_progress" },
  { id: "REP-2026-0002", rmaNo: "RMA-2026-0003", defectCode: "DEFECT-ELEC", actionTaken: "更换电容 C12", partsUsed: "电容 25 个", startedAt: "2026-06-12T08:00:00Z", completedAt: "2026-06-13T17:00:00Z", operatorName: "VN_REPAIR_002", result: "pass" },
];

// ── Spare Parts Warehouse ─────────────────────────────────────────────────────

export const spareParts: SparePart[] = [
  { id: "SP-001", partNo: "NOZ-FUJI-NXT-III", name_zh: "Fuji NXT III 贴装头喷嘴", name_en: "Fuji NXT III mounter nozzle", name_vi: "Đầu hàn Fuji NXT III", equipmentModel: "Fuji NXT III", equipmentType: "mounter", currentStock: 12, minStock: 5, unit: "pcs", locationCode: "A-01-01", supplier: "Fuji机械", unitCost: 2800, leadTimeDays: 14, status: "active" },
  { id: "SP-002", partNo: "NOZ-FUJI-NXT-IV", name_zh: "Fuji NXT IV 贴装头喷嘴", name_en: "Fuji NXT IV mounter nozzle", name_vi: "Đầu hàn Fuji NXT IV", equipmentModel: "Fuji NXT IV", equipmentType: "mounter", currentStock: 6, minStock: 5, unit: "pcs", locationCode: "A-01-02", supplier: "Fuji机械", unitCost: 3200, leadTimeDays: 14, status: "active" },
  { id: "SP-003", partNo: "NOZZLE-SMT-003", name_zh: "SMT通用喷嘴 Ø3", name_en: "SMT universal nozzle Ø3", name_vi: "Đầu hàn SMT Ø3", equipmentModel: "Universal", equipmentType: "mounter", currentStock: 20, minStock: 10, unit: "pcs", locationCode: "A-01-03", supplier: "国产", unitCost: 180, leadTimeDays: 7, status: "active" },
  { id: "SP-004", partNo: "FEEDER-FUJI-8", name_zh: "Fuji 8mm feeder供料器", name_en: "Fuji 8mm feeder", name_vi: "Bộ cấp liệu Fuji 8mm", equipmentModel: "Fuji NXT III", equipmentType: "mounter", currentStock: 45, minStock: 20, unit: "pcs", locationCode: "A-02-01", supplier: "Fuji机械", unitCost: 1200, leadTimeDays: 21, status: "active" },
  { id: "SP-005", partNo: "FEEDER-FUJI-12", name_zh: "Fuji 12mm feeder供料器", name_en: "Fuji 12mm feeder", name_vi: "Bộ cấp liệu Fuji 12mm", equipmentModel: "Fuji NXT III", equipmentType: "mounter", currentStock: 30, minStock: 15, unit: "pcs", locationCode: "A-02-02", supplier: "Fuji机械", unitCost: 1400, leadTimeDays: 21, status: "active" },
  { id: "SP-006", partNo: "SOLDER-PRINT-5", name_zh: "锡膏印刷刮刀 5mm", name_en: "Solder paste squeegee 5mm", name_vi: "Lưỡi gạt thiếc 5mm", equipmentModel: "DEK Horizon", equipmentType: "printer", currentStock: 8, minStock: 5, unit: "pcs", locationCode: "B-01-01", supplier: "DEK原厂", unitCost: 450, leadTimeDays: 7, status: "active" },
  { id: "SP-007", partNo: "SOLDER-PRINT-8", name_zh: "锡膏印刷刮刀 8mm", name_en: "Solder paste squeegee 8mm", name_vi: "Lưỡi gạt thiếc 8mm", equipmentModel: "DEK Horizon", equipmentType: "printer", currentStock: 6, minStock: 5, unit: "pcs", locationCode: "B-01-02", supplier: "DEK原厂", unitCost: 520, leadTimeDays: 7, status: "active" },
  { id: "SP-008", partNo: "HEATER-REHM-1", name_zh: "Rehm回流焊加热管", name_en: "Rehm reflow heater tube", name_vi: "Ống gia nhiệt Rehm", equipmentModel: "Rehm V8", equipmentType: "reflow", currentStock: 3, minStock: 2, unit: "pcs", locationCode: "C-01-01", supplier: "Rehm原厂", unitCost: 8500, leadTimeDays: 30, status: "active" },
  { id: "SP-009", partNo: "THERMOCOUPLE-1", name_zh: "热电偶温度传感器", name_en: "Thermocouple temperature sensor", name_vi: "Cặp nhiệt điện", equipmentModel: "Rehm V8", equipmentType: "reflow", currentStock: 5, minStock: 3, unit: "pcs", locationCode: "C-01-02", supplier: "国产", unitCost: 320, leadTimeDays: 14, status: "active" },
  { id: "SP-010", partNo: "CAMERA-AOI-1", name_zh: "AOI检测相机光源", name_en: "AOI inspection camera light", name_vi: "Đèn camera AOI", equipmentModel: "CTI A40", equipmentType: "AOI", currentStock: 2, minStock: 2, unit: "pcs", locationCode: "D-01-01", supplier: "Cognex", unitCost: 12000, leadTimeDays: 45, status: "active" },
  { id: "SP-011", partNo: "LASER-AOI-1", name_zh: "AOI激光扫描头", name_en: "AOI laser scan head", name_vi: "Đầu quét laser AOI", equipmentModel: "CTI A40", equipmentType: "AOI", currentStock: 1, minStock: 2, unit: "pcs", locationCode: "D-01-02", supplier: "Cognex", unitCost: 28000, leadTimeDays: 60, status: "on_order" },
  { id: "SP-012", partNo: "ICT-NOZZLE-1", name_zh: "ICT测试顶针", name_en: "ICT test probe needle", name_vi: "Kim probe ICT", equipmentModel: "TR518II", equipmentType: "ICT", currentStock: 100, minStock: 50, unit: "pcs", locationCode: "E-01-01", supplier: "国产", unitCost: 25, leadTimeDays: 7, status: "active" },
  { id: "SP-013", partNo: "ICT-NOZZLE-2", name_zh: "ICT真空吸嘴", name_en: "ICT vacuum nozzle", name_vi: "Đầu hút chân ICT", equipmentModel: "TR518II", equipmentType: "ICT", currentStock: 50, minStock: 30, unit: "pcs", locationCode: "E-01-02", supplier: "国产", unitCost: 45, leadTimeDays: 7, status: "active" },
  { id: "SP-014", partNo: "VACCUM-PUMP-1", name_zh: "真空泵膜片", name_en: "Vacuum pump diaphragm", name_vi: "Màng bơm chân không", equipmentModel: "Universal", equipmentType: "general", currentStock: 4, minStock: 3, unit: "pcs", locationCode: "F-01-01", supplier: "干式真空泵", unitCost: 1800, leadTimeDays: 21, status: "active" },
  { id: "SP-015", partNo: "FILTER-HEPA-1", name_zh: "HEPA过滤器", name_en: "HEPA air filter", name_vi: "Lọc khí HEPA", equipmentModel: "Universal", equipmentType: "general", currentStock: 10, minStock: 5, unit: "pcs", locationCode: "F-02-01", supplier: "AAF", unitCost: 2200, leadTimeDays: 30, status: "active" },
  { id: "SP-016", partNo: "LUBRICANT-GREASE", name_zh: "轴承润滑脂", name_en: "Bearing lubricant grease", name_vi: "Mỡ bôi trơn ổ đỡ", equipmentModel: "Universal", equipmentType: "general", currentStock: 20, minStock: 10, unit: "kg", locationCode: "F-03-01", supplier: "美孚", unitCost: 180, leadTimeDays: 14, status: "active" },
  { id: "SP-017", partNo: "BELT-TIMING-1", name_zh: "同步皮带 100T", name_en: "Timing belt 100T", name_vi: "Dây curoa định thời 100T", equipmentModel: "Universal", equipmentType: "general", currentStock: 15, minStock: 8, unit: "pcs", locationCode: "G-01-01", supplier: "盖茨", unitCost: 85, leadTimeDays: 14, status: "active" },
  { id: "SP-018", partNo: "MOTOR-SERVO-1", name_zh: "伺服电机驱动器", name_en: "Servo motor driver", name_vi: "Driver động cơ servo", equipmentModel: "Fuji NXT III", equipmentType: "mounter", currentStock: 2, minStock: 2, unit: "pcs", locationCode: "H-01-01", supplier: "Fuji原厂", unitCost: 15000, leadTimeDays: 45, status: "active", lowStock: true },
  { id: "SP-019", partNo: "SPONGE-CLEAN-1", name_zh: "清洁海绵条", name_en: "Cleaning sponge strip", name_vi: "Miếng bọt biển sạch", equipmentModel: "DEK Horizon", equipmentType: "printer", currentStock: 30, minStock: 15, unit: "pcs", locationCode: "B-02-01", supplier: "DEK原厂", unitCost: 120, leadTimeDays: 7, status: "active" },
  { id: "SP-020", partNo: "DISPENSER-SYRINGE", name_zh: "点胶注射器 30cc", name_en: "Dispensing syringe 30cc", name_vi: "Ống tiêm phết keo 30cc", equipmentModel: "Universal", equipmentType: "general", currentStock: 50, minStock: 20, unit: "pcs", locationCode: "G-02-01", supplier: "国产", unitCost: 15, leadTimeDays: 7, status: "active" },
];

export const partsWearSchedules: PartsWearSchedule[] = [
  { id: "WS-001", partId: "SP-001", partNo: "NOZ-FUJI-NXT-III", name_zh: "Fuji NXT III 贴装头喷嘴", equipmentId: "eq-001", equipmentNo: "SMT-NXT-01", installedAt: "2026-01-15T00:00:00Z", runningHours: 1840, replaceIntervalHours: 2000, nextReplaceDue: "2026-07-15T00:00:00Z", wearStatus: "warning", wearPct: 92 },
  { id: "WS-002", partId: "SP-004", partNo: "FEEDER-FUJI-8", name_zh: "Fuji 8mm feeder供料器", equipmentId: "eq-001", equipmentNo: "SMT-NXT-01", installedAt: "2026-03-01T00:00:00Z", runningHours: 960, replaceIntervalHours: 2000, nextReplaceDue: "2026-10-01T00:00:00Z", wearStatus: "normal", wearPct: 48 },
  { id: "WS-003", partId: "SP-018", partNo: "MOTOR-SERVO-1", name_zh: "伺服电机驱动器", equipmentId: "eq-001", equipmentNo: "SMT-NXT-01", installedAt: "2026-02-01T00:00:00Z", runningHours: 1200, replaceIntervalHours: 4000, nextReplaceDue: "2026-09-01T00:00:00Z", wearStatus: "normal", wearPct: 30 },
  { id: "WS-004", partId: "SP-002", partNo: "NOZ-FUJI-NXT-IV", name_zh: "Fuji NXT IV 贴装头喷嘴", equipmentId: "eq-002", equipmentNo: "SMT-NXT-02", installedAt: "2026-04-01T00:00:00Z", runningHours: 720, replaceIntervalHours: 2000, nextReplaceDue: "2026-11-01T00:00:00Z", wearStatus: "normal", wearPct: 36 },
  { id: "WS-005", partId: "SP-006", partNo: "SOLDER-PRINT-5", name_zh: "锡膏印刷刮刀 5mm", equipmentId: "eq-003", equipmentNo: "PRINTER-DEK-01", installedAt: "2026-05-01T00:00:00Z", runningHours: 480, replaceIntervalHours: 500, nextReplaceDue: "2026-06-28T00:00:00Z", wearStatus: "critical", wearPct: 96 },
  { id: "WS-006", partId: "SP-007", partNo: "SOLDER-PRINT-8", name_zh: "锡膏印刷刮刀 8mm", equipmentId: "eq-003", equipmentNo: "PRINTER-DEK-01", installedAt: "2026-05-01T00:00:00Z", runningHours: 480, replaceIntervalHours: 500, nextReplaceDue: "2026-06-28T00:00:00Z", wearStatus: "critical", wearPct: 96 },
  { id: "WS-007", partId: "SP-019", partNo: "SPONGE-CLEAN-1", name_zh: "清洁海绵条", equipmentId: "eq-003", equipmentNo: "PRINTER-DEK-01", installedAt: "2026-05-15T00:00:00Z", runningHours: 360, replaceIntervalHours: 400, nextReplaceDue: "2026-07-15T00:00:00Z", wearStatus: "warning", wearPct: 90 },
  { id: "WS-008", partId: "SP-010", partNo: "CAMERA-AOI-1", name_zh: "AOI检测相机光源", equipmentId: "eq-004", equipmentNo: "AOI-CTI-01", installedAt: "2026-01-01T00:00:00Z", runningHours: 2100, replaceIntervalHours: 2000, nextReplaceDue: "2026-06-10T00:00:00Z", wearStatus: "overdue", wearPct: 105 },
  { id: "WS-009", partId: "SP-011", partNo: "LASER-AOI-1", name_zh: "AOI激光扫描头", equipmentId: "eq-004", equipmentNo: "AOI-CTI-01", installedAt: "2026-01-01T00:00:00Z", runningHours: 2100, replaceIntervalHours: 3000, nextReplaceDue: "2026-08-01T00:00:00Z", wearStatus: "warning", wearPct: 70 },
  { id: "WS-010", partId: "SP-008", partNo: "HEATER-REHM-1", name_zh: "Rehm回流焊加热管", equipmentId: "eq-005", equipmentNo: "REF-V8-01", installedAt: "2026-02-15T00:00:00Z", runningHours: 1400, replaceIntervalHours: 3000, nextReplaceDue: "2026-09-15T00:00:00Z", wearStatus: "normal", wearPct: 47 },
  { id: "WS-011", partId: "SP-009", partNo: "THERMOCOUPLE-1", name_zh: "热电偶温度传感器", equipmentId: "eq-005", equipmentNo: "REF-V8-01", installedAt: "2026-02-15T00:00:00Z", runningHours: 1400, replaceIntervalHours: 2000, nextReplaceDue: "2026-08-15T00:00:00Z", wearStatus: "warning", wearPct: 70 },
  { id: "WS-012", partId: "SP-006", partNo: "SOLDER-PRINT-5", name_zh: "锡膏印刷刮刀 5mm", equipmentId: "eq-006", equipmentNo: "PRINTER-DEK-02", installedAt: "2026-03-10T00:00:00Z", runningHours: 860, replaceIntervalHours: 1000, nextReplaceDue: "2026-08-10T00:00:00Z", wearStatus: "warning", wearPct: 86 },
];

export const partsConsumptionLogs: PartsConsumptionLog[] = [
  { id: "PCL-001", partId: "SP-001", partNo: "NOZ-FUJI-NXT-III", equipmentId: "eq-001", workOrderCode: "26061010001", quantity: 1, reason: "corrective", operatorName: "Pham Van Long", consumedAt: "2026-06-25T08:30:00Z" },
  { id: "PCL-002", partId: "SP-004", partNo: "FEEDER-FUJI-8", equipmentId: "eq-001", workOrderCode: "26061010001", quantity: 2, reason: "preventive", operatorName: "Pham Van Long", consumedAt: "2026-06-20T09:00:00Z" },
  { id: "PCL-003", partId: "SP-006", partNo: "SOLDER-PRINT-5", equipmentId: "eq-003", workOrderCode: "26061010002", quantity: 1, reason: "preventive_scheduled", operatorName: "Dang Van Nam", consumedAt: "2026-06-22T14:00:00Z" },
  { id: "PCL-004", partId: "SP-010", partNo: "CAMERA-AOI-1", equipmentId: "eq-004", workOrderCode: "26061010003", quantity: 1, reason: "breakdown", operatorName: "Hoang Van Cuong", consumedAt: "2026-06-10T11:00:00Z" },
  { id: "PCL-005", partId: "SP-019", partNo: "SPONGE-CLEAN-1", equipmentId: "eq-003", workOrderCode: "26061010002", quantity: 3, reason: "preventive", operatorName: "Dang Van Nam", consumedAt: "2026-06-18T08:00:00Z" },
  { id: "PCL-006", partId: "SP-004", partNo: "FEEDER-FUJI-8", equipmentId: "eq-002", workOrderCode: "26061010004", quantity: 1, reason: "preventive", operatorName: "Le Thi Mai", consumedAt: "2026-06-15T10:00:00Z" },
  { id: "PCL-007", partId: "SP-007", partNo: "SOLDER-PRINT-8", equipmentId: "eq-003", workOrderCode: "26061010002", quantity: 1, reason: "corrective", operatorName: "Dang Van Nam", consumedAt: "2026-06-26T16:00:00Z" },
  { id: "PCL-008", partId: "SP-003", partNo: "NOZZLE-SMT-003", equipmentId: "eq-001", workOrderCode: "26061010001", quantity: 5, reason: "preventive", operatorName: "Pham Van Long", consumedAt: "2026-06-10T09:00:00Z" },
  { id: "PCL-009", partId: "SP-017", partNo: "BELT-TIMING-1", equipmentId: "eq-005", quantity: 1, reason: "preventive_scheduled", operatorName: "Hoang Van Cuong", consumedAt: "2026-06-05T10:00:00Z" },
  { id: "PCL-010", partId: "SP-009", partNo: "THERMOCOUPLE-1", equipmentId: "eq-005", quantity: 1, reason: "corrective", operatorName: "Hoang Van Cuong", consumedAt: "2026-06-20T14:00:00Z" },
];

export const partsWearAlerts: PartsWearAlert[] = [
  { id: "PWA-001", partId: "SP-006", partNo: "SOLDER-PRINT-5", name_zh: "锡膏印刷刮刀 5mm", equipmentId: "eq-003", alertType: "wear_critical", severity: "critical", message: "DEK印刷机刮刀已使用480小时，接近500小时更换周期", runningHours: 480, replaceIntervalHours: 500, acknowledged: false, createdAt: "2026-06-26T00:00:00Z" },
  { id: "PWA-002", partId: "SP-007", partNo: "SOLDER-PRINT-8", name_zh: "锡膏印刷刮刀 8mm", equipmentId: "eq-003", alertType: "wear_critical", severity: "critical", message: "DEK印刷机刮刀已使用480小时，接近500小时更换周期", runningHours: 480, replaceIntervalHours: 500, acknowledged: false, createdAt: "2026-06-26T00:00:00Z" },
  { id: "PWA-003", partId: "SP-010", partNo: "CAMERA-AOI-1", name_zh: "AOI检测相机光源", equipmentId: "eq-004", alertType: "overdue", severity: "critical", message: "AOI相机光源已使用2100小时，超出2000小时更换周期，请立即更换", runningHours: 2100, replaceIntervalHours: 2000, acknowledged: false, createdAt: "2026-06-11T00:00:00Z" },
  { id: "PWA-004", partId: "SP-018", partNo: "MOTOR-SERVO-1", name_zh: "伺服电机驱动器", equipmentId: "eq-001", alertType: "low_stock", severity: "warning", message: "SMT-NXT-01伺高分子驱动器的当前库存为2件，等于最低库存警戒线", currentStock: 2, minStock: 2, acknowledged: false, createdAt: "2026-06-27T00:00:00Z" },
];
