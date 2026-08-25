import { apiClient } from "./client";

// ── Report type definitions ────────────────────────────────────

export type ReportKey =
  | "work-order-progress"
  | "inventory-ledger"
  | "material-movement"
  | "iqc-summary"
  | "oee-by-line"
  | "defect-analysis"
  | "material-balance"
  | "delivery-risk";

/** Canonical report keys used by the management report-session export. */
export const reportKeys: ReportKey[] = [
  "work-order-progress",
  "inventory-ledger",
  "material-movement",
  "iqc-summary",
  "oee-by-line",
  "defect-analysis",
  "material-balance",
  "delivery-risk",
];

export interface ReportDefinition {
  key: ReportKey;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  descriptionZh: string;
  descriptionEn: string;
  descriptionVi: string;
}

export interface ReportColumn {
  key: string;
  labelZh: string;
  labelEn: string;
  labelVi: string;
  format?: "number" | "percent" | "currency" | "date";
}

export interface ReportMeta {
  generatedAt: string;
  totalRows: number;
  filter?: {
    dateFrom?: string;
    dateTo?: string;
    lineCode?: string;
    workOrderCode?: string;
    materialCode?: string;
    period?: string;
  };
}

export interface ReportData {
  key: ReportKey;
  titleZh: string;
  titleEn: string;
  titleVi: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  meta: ReportMeta;
}

// ── Mock data generators ───────────────────────────────────────

const reportDefinitions: ReportDefinition[] = [
  { key: "work-order-progress", nameZh: "工单进度", nameEn: "Work Order Progress", nameVi: "Tiến độ lệnh SX", descriptionZh: "所有工单的完成进度和状态", descriptionEn: "Completion progress and status of all work orders", descriptionVi: "Tiến độ hoàn thành và trạng thái của tất cả lệnh SX" },
  { key: "inventory-ledger", nameZh: "库存台账", nameEn: "Inventory Ledger", nameVi: "Sổ cái tồn kho", descriptionZh: "按批次查看当前库存数量和位置", descriptionEn: "Current stock quantities and locations by lot", descriptionVi: "Số lượng tồn kho hiện tại và vị trí theo lô" },
  { key: "material-movement", nameZh: "物料移动记录", nameEn: "Material Movement", nameVi: "Lịch sử di chuyển vật tư", descriptionZh: "完整的物料事务流水", descriptionEn: "Full material transaction history", descriptionVi: "Lịch sử đầy đủ các giao dịch vật tư" },
  { key: "iqc-summary", nameZh: "IQC 汇总", nameEn: "IQC Summary", nameVi: "Tổng kết IQC", descriptionZh: "来料检验结果按物料和供应商汇总", descriptionEn: "Incoming inspection results by material and supplier", descriptionVi: "Kết quả kiểm tra đầu vào theo vật tư và nhà cung cấp" },
  { key: "oee-by-line", nameZh: "OEE 按线别", nameEn: "OEE by Line", nameVi: "OEE theo dây chuyền", descriptionZh: "各产线的设备综合效率", descriptionEn: "Overall Equipment Effectiveness by production line", descriptionVi: "Hiệu suất thiết bị tổng thể theo dây chuyền" },
  { key: "defect-analysis", nameZh: "缺陷分析", nameEn: "Defect Analysis", nameVi: "Phân tích lỗi", descriptionZh: "缺陷代码 Pareto 分析", descriptionEn: "Defect code Pareto analysis", descriptionVi: "Phân tích Pareto mã lỗi" },
  { key: "material-balance", nameZh: "物料结存", nameEn: "Material Balance", nameVi: "Cân đối vật tư", descriptionZh: "物料收发存汇总", descriptionEn: "Material receipt/issue/balance summary", descriptionVi: "Tổng kết nhập/xuất/tồn vật tư" },
  { key: "delivery-risk", nameZh: "交付风险", nameEn: "Delivery Risk", nameVi: "Rủi ro giao hàng", descriptionZh: "客户 PO 交付风险跟踪", descriptionEn: "Customer PO delivery risk tracking", descriptionVi: "Theo dõi rủi ro giao hàng PO khách hàng" },
];

function generateMockRows(reportKey: ReportKey): { columns: ReportColumn[]; rows: Record<string, unknown>[] } {
  switch (reportKey) {
    case "work-order-progress":
      return {
        columns: [
          { key: "workOrderCode", labelZh: "工单号", labelEn: "Work Order", labelVi: "Lệnh SX" },
          { key: "productCode", labelZh: "产品", labelEn: "Product", labelVi: "Sản phẩm" },
          { key: "lineCode", labelZh: "线别", labelEn: "Line", labelVi: "Dây chuyền" },
          { key: "plannedQty", labelZh: "计划数", labelEn: "Planned", labelVi: "KH", format: "number" },
          { key: "completedQty", labelZh: "完成数", labelEn: "Completed", labelVi: "Hoàn thành", format: "number" },
          { key: "progressPct", labelZh: "进度", labelEn: "Progress", labelVi: "Tiến độ", format: "percent" },
          { key: "status", labelZh: "状态", labelEn: "Status", labelVi: "Trạng thái" },
          { key: "dueDate", labelZh: "到期日", labelEn: "Due Date", labelVi: "Hạn", format: "date" },
        ],
        rows: [
          { workOrderCode: "2606001010001", productCode: "PCB-A100", lineCode: "L01", plannedQty: 5000, completedQty: 3420, progressPct: 68.4, status: "running", dueDate: "2026-07-15" },
          { workOrderCode: "2606002010002", productCode: "PCB-B200", lineCode: "L02", plannedQty: 3000, completedQty: 3000, progressPct: 100, status: "closed", dueDate: "2026-06-30" },
          { workOrderCode: "2606001010003", productCode: "PCB-C300", lineCode: "L01", plannedQty: 2000, completedQty: 0, progressPct: 0, status: "released", dueDate: "2026-07-20" },
          { workOrderCode: "2606002020004", productCode: "PCB-D400", lineCode: "L02", plannedQty: 1500, completedQty: 890, progressPct: 59.3, status: "running", dueDate: "2026-07-10" },
          { workOrderCode: "2606003010005", productCode: "PCB-A100", lineCode: "L01", plannedQty: 4000, completedQty: 4000, progressPct: 100, status: "closed", dueDate: "2026-06-25" },
        ],
      };

    case "oee-by-line":
      return {
        columns: [
          { key: "lineCode", labelZh: "线别", labelEn: "Line", labelVi: "Dây chuyền" },
          { key: "availability", labelZh: "可用率", labelEn: "Availability", labelVi: "Khả dụng", format: "percent" },
          { key: "performance", labelZh: "性能率", labelEn: "Performance", labelVi: "Hiệu suất", format: "percent" },
          { key: "quality", labelZh: "质量率", labelEn: "Quality", labelVi: "Chất lượng", format: "percent" },
          { key: "oee", labelZh: "OEE", labelEn: "OEE", labelVi: "OEE", format: "percent" },
          { key: "outputToday", labelZh: "今日产出", labelEn: "Today Output", labelVi: "Hôm nay", format: "number" },
        ],
        rows: [
          { lineCode: "SMT-01", availability: 95.2, performance: 88.5, quality: 99.1, oee: 83.5, outputToday: 12450 },
          { lineCode: "SMT-02", availability: 92.8, performance: 85.3, quality: 98.7, oee: 78.2, outputToday: 9870 },
          { lineCode: "SMT-03", availability: 97.1, performance: 91.2, quality: 99.5, oee: 88.1, outputToday: 15200 },
          { lineCode: "SMT-04", availability: 88.5, performance: 82.1, quality: 97.8, oee: 71.1, outputToday: 7650 },
        ],
      };

    case "delivery-risk":
      return {
        columns: [
          { key: "poNumber", labelZh: "PO 号", labelEn: "PO No.", labelVi: "Số PO" },
          { key: "customerName", labelZh: "客户", labelEn: "Customer", labelVi: "Khách hàng" },
          { key: "productCode", labelZh: "产品", labelEn: "Product", labelVi: "Sản phẩm" },
          { key: "orderQty", labelZh: "订单数", labelEn: "Order Qty", labelVi: "SL đặt", format: "number" },
          { key: "deliveredQty", labelZh: "已交付", labelEn: "Delivered", labelVi: "Đã giao", format: "number" },
          { key: "dueDate", labelZh: "到期日", labelEn: "Due Date", labelVi: "Hạn", format: "date" },
          { key: "riskLevel", labelZh: "风险等级", labelEn: "Risk", labelVi: "Rủi ro" },
          { key: "daysRemaining", labelZh: "剩余天数", labelEn: "Days Left", labelVi: "Còn lại", format: "number" },
        ],
        rows: [
          { poNumber: "PO-2026-001", customerName: "TechClient A", productCode: "PCB-A100", orderQty: 10000, deliveredQty: 6500, dueDate: "2026-07-15", riskLevel: "medium", daysRemaining: 18 },
          { poNumber: "PO-2026-002", customerName: "ElectroBuyer B", productCode: "PCB-B200", orderQty: 5000, deliveredQty: 5000, dueDate: "2026-06-30", riskLevel: "low", daysRemaining: 3 },
          { poNumber: "PO-2026-003", customerName: "GlobalParts C", productCode: "PCB-C300", orderQty: 8000, deliveredQty: 2000, dueDate: "2026-07-10", riskLevel: "high", daysRemaining: 13 },
        ],
      };

    case "iqc-summary":
      return {
        columns: [
          { key: "materialCode", labelZh: "物料编码", labelEn: "Material", labelVi: "Mã VT" },
          { key: "supplierCode", labelZh: "供应商", labelEn: "Supplier", labelVi: "NCC" },
          { key: "totalLots", labelZh: "总批次", labelEn: "Total", labelVi: "Tổng lô", format: "number" },
          { key: "releasedLots", labelZh: "已放行", labelEn: "Released", labelVi: "Đã QĐ", format: "number" },
          { key: "holdLots", labelZh: "拦截", labelEn: "Hold", labelVi: "Giữ", format: "number" },
          { key: "rejectedLots", labelZh: "退货", labelEn: "Rejected", labelVi: "Từ chối", format: "number" },
        ],
        rows: [
          { materialCode: "RES-100K", supplierCode: "SUP-001", totalLots: 12, releasedLots: 10, holdLots: 1, rejectedLots: 1 },
          { materialCode: "CAP-10UF", supplierCode: "SUP-002", totalLots: 8, releasedLots: 8, holdLots: 0, rejectedLots: 0 },
          { materialCode: "IC-STM32", supplierCode: "SUP-003", totalLots: 5, releasedLots: 3, holdLots: 2, rejectedLots: 0 },
        ],
      };

    case "defect-analysis":
      return {
        columns: [
          { key: "defectCode", labelZh: "缺陷代码", labelEn: "Defect Code", labelVi: "Mã lỗi" },
          { key: "count", labelZh: "数量", labelEn: "Count", labelVi: "SL", format: "number" },
          { key: "percentage", labelZh: "占比", labelEn: "%", labelVi: "%", format: "percent" },
          { key: "stationType", labelZh: "工站", labelEn: "Station", labelVi: "Trạm" },
        ],
        rows: [
          { defectCode: "BRD-001", count: 45, percentage: 28.3, stationType: "AOI" },
          { defectCode: "BRD-002", count: 32, percentage: 20.1, stationType: "AOI" },
          { defectCode: "SMT-010", count: 28, percentage: 17.6, stationType: "SPI" },
          { defectCode: "SMT-015", count: 18, percentage: 11.3, stationType: "SPI" },
          { defectCode: "ICT-005", count: 12, percentage: 7.5, stationType: "ICT" },
        ],
      };

    default:
      return {
        columns: [{ key: "note", labelZh: "信息", labelEn: "Info", labelVi: "Thông tin" }],
        rows: [{ note: `${reportKey}: 报表数据开发中，将在后续版本中提供详细数据。` }],
      };
  }
}

// ── Report API client ──────────────────────────────────────────

export const reportsApi = {
  /** POST /api/archives/run-snapshot — persist an auditable session for every report in MES */
  archiveAllReports(period?: "weekly" | "monthly") {
    return apiClient.post<{ results: Array<{ key: string; status: string; rows: number }>; totalArchived: number }>("/api/archives/run-snapshot", period ? { period } : {});
  },
  /** GET /reports — list available report definitions */
  getDefinitions() {
    return apiClient
      .get<ReportDefinition[]>("/reports")
      .catch(() => reportDefinitions);
  },

  /** GET /reports/:reportKey — run a named report with optional filters */
  getReport(reportKey: ReportKey, params?: {
    dateFrom?: string;
    dateTo?: string;
    lineCode?: string;
    workOrderCode?: string;
    materialCode?: string;
    supplierCode?: string;
    employeeCode?: string;
    assetCode?: string;
    period?: string;
    // backend-specific filters
    iqcStatus?: string;
    status?: string;
    stationType?: string;
    riskLevel?: string;
  }) {
    const qs = new URLSearchParams();
    if (params?.dateFrom) qs.set("dateFrom", params.dateFrom);
    if (params?.dateTo) qs.set("dateTo", params.dateTo);
    if (params?.lineCode) qs.set("lineCode", params.lineCode);
    if (params?.workOrderCode) qs.set("workOrderCode", params.workOrderCode);
    if (params?.materialCode) qs.set("materialCode", params.materialCode);
    if (params?.supplierCode) qs.set("supplierCode", params.supplierCode);
    if (params?.employeeCode) qs.set("employeeCode", params.employeeCode);
    if (params?.assetCode) qs.set("assetCode", params.assetCode);
    if (params?.period) qs.set("period", params.period);
    if (params?.iqcStatus) qs.set("iqcStatus", params.iqcStatus);
    if (params?.status) qs.set("status", params.status);
    if (params?.stationType) qs.set("stationType", params.stationType);
    if (params?.riskLevel) qs.set("riskLevel", params.riskLevel);
    const query = qs.toString();

    return apiClient
      .get<ReportData>(`/reports/${reportKey}${query ? `?${query}` : ""}`)
      .then((response: { key: string; rows: Record<string, unknown>[]; generatedAt?: string }) => {
        // Enrich live API response with static column definitions + titles
        const def = reportDefinitions.find((d) => d.key === reportKey);
        const { columns } = generateMockRows(reportKey);
        return {
          key: reportKey,
          titleZh: def?.nameZh ?? reportKey,
          titleEn: def?.nameEn ?? reportKey,
          titleVi: def?.nameVi ?? reportKey,
          columns,
          rows: response.rows ?? [],
          meta: {
            generatedAt: response.generatedAt ?? new Date().toISOString(),
            totalRows: (response.rows ?? []).length,
            filter: params ?? {},
          },
        } as ReportData;
      })
      .catch(() => {
        const def = reportDefinitions.find((d) => d.key === reportKey);
        const { columns, rows } = generateMockRows(reportKey);
        return {
          key: reportKey,
          titleZh: def?.nameZh ?? reportKey,
          titleEn: def?.nameEn ?? reportKey,
          titleVi: def?.nameVi ?? reportKey,
          columns,
          rows,
          meta: {
            generatedAt: new Date().toISOString(),
            totalRows: rows.length,
            filter: params ?? {},
          },
        } as ReportData;
      });
  },

  /** GET /reports/:reportKey/export — get export URL */
  getExportUrl(reportKey: ReportKey, format: "csv" | "xlsx" = "csv") {
    return `/reports/${reportKey}/export?format=${format}`;
  },
};
