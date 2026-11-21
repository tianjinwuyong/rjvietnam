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

// ── Report column definitions ──────────────────────────────────

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

// The API returns rows only; a row says nothing about which locale label or number
// format to render, so the column metadata stays here. Row data is never synthesised --
// a failed report request now rejects instead of showing invented numbers.
const REPORT_COLUMNS: Partial<Record<ReportKey, ReportColumn[]>> = {
  "work-order-progress": [
    { key: "workOrderCode", labelZh: "工单号", labelEn: "Work Order", labelVi: "Lệnh SX" },
    { key: "productCode", labelZh: "产品", labelEn: "Product", labelVi: "Sản phẩm" },
    { key: "lineCode", labelZh: "线别", labelEn: "Line", labelVi: "Dây chuyền" },
    { key: "plannedQty", labelZh: "计划数", labelEn: "Planned", labelVi: "KH", format: "number" },
    { key: "completedQty", labelZh: "完成数", labelEn: "Completed", labelVi: "Hoàn thành", format: "number" },
    { key: "progressPct", labelZh: "进度", labelEn: "Progress", labelVi: "Tiến độ", format: "percent" },
    { key: "status", labelZh: "状态", labelEn: "Status", labelVi: "Trạng thái" },
    { key: "dueDate", labelZh: "到期日", labelEn: "Due Date", labelVi: "Hạn", format: "date" },
  ],
  "oee-by-line": [
    { key: "lineCode", labelZh: "线别", labelEn: "Line", labelVi: "Dây chuyền" },
    { key: "availability", labelZh: "可用率", labelEn: "Availability", labelVi: "Khả dụng", format: "percent" },
    { key: "performance", labelZh: "性能率", labelEn: "Performance", labelVi: "Hiệu suất", format: "percent" },
    { key: "quality", labelZh: "质量率", labelEn: "Quality", labelVi: "Chất lượng", format: "percent" },
    { key: "oee", labelZh: "OEE", labelEn: "OEE", labelVi: "OEE", format: "percent" },
    { key: "outputToday", labelZh: "今日产出", labelEn: "Today Output", labelVi: "Hôm nay", format: "number" },
  ],
  "delivery-risk": [
    { key: "poNumber", labelZh: "PO 号", labelEn: "PO No.", labelVi: "Số PO" },
    { key: "customerName", labelZh: "客户", labelEn: "Customer", labelVi: "Khách hàng" },
    { key: "productCode", labelZh: "产品", labelEn: "Product", labelVi: "Sản phẩm" },
    { key: "orderQty", labelZh: "订单数", labelEn: "Order Qty", labelVi: "SL đặt", format: "number" },
    { key: "deliveredQty", labelZh: "已交付", labelEn: "Delivered", labelVi: "Đã giao", format: "number" },
    { key: "dueDate", labelZh: "到期日", labelEn: "Due Date", labelVi: "Hạn", format: "date" },
    { key: "riskLevel", labelZh: "风险等级", labelEn: "Risk", labelVi: "Rủi ro" },
    { key: "daysRemaining", labelZh: "剩余天数", labelEn: "Days Left", labelVi: "Còn lại", format: "number" },
  ],
  "iqc-summary": [
    { key: "materialCode", labelZh: "物料编码", labelEn: "Material", labelVi: "Mã VT" },
    { key: "supplierCode", labelZh: "供应商", labelEn: "Supplier", labelVi: "NCC" },
    { key: "totalLots", labelZh: "总批次", labelEn: "Total", labelVi: "Tổng lô", format: "number" },
    { key: "releasedLots", labelZh: "已放行", labelEn: "Released", labelVi: "Đã QĐ", format: "number" },
    { key: "holdLots", labelZh: "拦截", labelEn: "Hold", labelVi: "Giữ", format: "number" },
    { key: "rejectedLots", labelZh: "退货", labelEn: "Rejected", labelVi: "Từ chối", format: "number" },
  ],
  "defect-analysis": [
    { key: "defectCode", labelZh: "缺陷代码", labelEn: "Defect Code", labelVi: "Mã lỗi" },
    { key: "count", labelZh: "数量", labelEn: "Count", labelVi: "SL", format: "number" },
    { key: "percentage", labelZh: "占比", labelEn: "%", labelVi: "%", format: "percent" },
    { key: "stationType", labelZh: "工站", labelEn: "Station", labelVi: "Trạm" },
  ],
};

// Reports without curated labels still have to render: fall back to the column keys of
// the first real row rather than inventing a schema.
function columnsFor(reportKey: ReportKey, rows: Record<string, unknown>[]): ReportColumn[] {
  const known = REPORT_COLUMNS[reportKey];
  if (known) return known;
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((key) => ({ key, labelZh: key, labelEn: key, labelVi: key }));
}

// ── Report API client ──────────────────────────────────────────

export const reportsApi = {
  /** POST /api/archives/run-snapshot — persist an auditable session for every report in MES */
  archiveAllReports(period?: "weekly" | "monthly") {
    return apiClient.post<{ results: Array<{ key: string; status: string; rows: number }>; totalArchived: number }>("/api/archives/run-snapshot", period ? { period } : {});
  },
  /** GET /reports — list available report definitions */
  getDefinitions() {
    return apiClient.get<ReportDefinition[]>("/reports");
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
        const columns = columnsFor(reportKey, response.rows ?? []);
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
      });
  },

  /** GET /reports/:reportKey/export — get export URL */
  getExportUrl(reportKey: ReportKey, format: "csv" | "xlsx" = "csv") {
    return `/reports/${reportKey}/export?format=${format}`;
  },
};
