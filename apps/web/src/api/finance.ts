import { apiClient, type ListEnvelope, type Envelope } from "./client";

function buildParams(params: Record<string, string | number | boolean | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) searchParams.set(k, String(v));
  }
  const s = searchParams.toString();
  return s ? "?" + s : "";
}

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface ArInvoice {
  id: number;
  invoiceNumber: string;
  customerId: number;
  customerCode: string;
  customerNameZh: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  exchangeRate: number;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  paymentStatus: "open" | "partial" | "posted" | "paid" | "voided";
  notes: string | null;
  createdAt: string;
}

export interface ApInvoice {
  id: number;
  invoiceNumber: string;
  supplierId: number;
  supplierCode: string;
  supplierNameZh: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  exchangeRate: number;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  paymentStatus: "open" | "partial" | "posted" | "paid" | "voided";
  notes: string | null;
  createdAt: string;
}

export interface PaymentRecord {
  id: number;
  paymentNumber: string;
  direction: "IN" | "OUT";
  partyType: "customer" | "supplier";
  partyId: number;
  partyCode: string;
  partyName: string;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
  paymentMethod: string;
  paymentDate: string;
  referenceNo: string | null;
  notes: string | null;
  status: "pending" | "completed" | "failed" | "cancelled";
  createdAt: string;
}

export interface GlAccount {
  accountCode: string;
  accountNameZh: string;
  accountNameEn: string;
  accountType: string;
  parentCode: string | null;
  isActive: boolean;
  isCashEquiv: boolean;
  costCenterType: string | null;
}

export interface GlJournalEntry {
  id: number;
  entryNo: string;
  sourceType: string;
  sourceId: number | null;
  postingDate: string;
  status: "draft" | "posted" | "voided";
  description: string;
  totalDebit: number;
  totalCredit: number;
  createdBy: string;
  createdAt: string;
}

export interface WoCostSummary {
  workOrderId: number;
  workOrderCode: string;
  productCode: string;
  productNameZh: string;
  lineCode: string;
  standardMaterialCost: number;
  standardLaborCost: number;
  standardOverheadCost: number;
  totalStandardCost: number;
  actualMaterialCost: number;
  actualLaborCost: number;
  actualOverheadCost: number;
  totalActualCost: number;
  costVariance: number;
  costStatus: "open" | "accumulating" | "closed";
  updatedAt: string;
}

export interface DashboardSummary {
  totalArOutstanding: number;
  totalArOverdue: number;
  totalApOutstanding: number;
  totalInventoryValue: number;
  totalWipCost: number;
  openMaterialEventCount: number;
  openMaterialEventLoss: number;
  draftJournalCount: number;
  currency: string;
  asOfDate: string;
}

export interface AgingBucket {
  currencyCode: string;
  buckets: {
    "0-30": number;
    "31-60": number;
    "61-90": number;
    over_90: number;
  };
  totalOutstanding: number;
  totalOverdue: number;
}

// ─── API calls ────────────────────────────────────────────────────────────────
export const financeApi = {
  // AR
  listArInvoices: (params?: { status?: string; customerId?: number; fromDate?: string; toDate?: string; limit?: number }) =>
    apiClient.get<ListEnvelope<ArInvoice>>("/finance/ar-invoices" + buildParams(params as Record<string, string | number | boolean | undefined>)),

  getArInvoice: (id: number) =>
    apiClient.get<ArInvoice>(`/finance/ar-invoices/${id}`),

  createArInvoice: (body: Partial<ArInvoice>) =>
    apiClient.post<ArInvoice>("/finance/ar-invoices", body),

  postArInvoice: (id: number) =>
    apiClient.post<{ journalNo: string; journalId: number }>(`/finance/ar-invoices/${id}/post`),

  // AP
  listApInvoices: (params?: { status?: string; supplierId?: number; fromDate?: string; toDate?: string; limit?: number }) =>
    apiClient.get<ListEnvelope<ApInvoice>>("/finance/ap-invoices" + buildParams(params as Record<string, string | number | boolean | undefined>)),

  getApInvoice: (id: number) =>
    apiClient.get<ApInvoice>(`/finance/ap-invoices/${id}`),

  createApInvoice: (body: Partial<ApInvoice>) =>
    apiClient.post<ApInvoice>("/finance/ap-invoices", body),

  postApInvoice: (id: number) =>
    apiClient.post<{ journalNo: string; journalId: number }>(`/finance/ap-invoices/${id}/post`),

  // Payments
  listPayments: (params?: { direction?: string; partyType?: string; fromDate?: string; toDate?: string; limit?: number }) =>
    apiClient.get<ListEnvelope<PaymentRecord>>("/finance/payments" + buildParams(params as Record<string, string | number | boolean | undefined>)),

  createPayment: (body: Partial<PaymentRecord>) =>
    apiClient.post<PaymentRecord>("/finance/payments", body),

  // GL
  listGlAccounts: (params?: { accountType?: string; isActive?: boolean }) =>
    apiClient.get<ListEnvelope<GlAccount>>("/finance/gl-accounts" + buildParams(params as Record<string, string | number | boolean | undefined>)),

  listGlJournals: (params?: { status?: string; fromDate?: string; toDate?: string; limit?: number }) =>
    apiClient.get<ListEnvelope<GlJournalEntry>>("/finance/gl-journals" + buildParams(params as Record<string, string | number | boolean | undefined>)),

  getGlJournal: (id: number) =>
    apiClient.get<GlJournalEntry>(`/finance/gl-journals/${id}`),

  // WO Cost
  listWoCosts: (params?: { status?: string; lineId?: number; limit?: number }) =>
    apiClient.get<ListEnvelope<WoCostSummary>>("/finance/work-order-costs" + buildParams(params as Record<string, string | number | boolean | undefined>)),

  postWoCost: (woId: number) =>
    apiClient.post(`/finance/work-order-costs`, { workOrderId: woId }),

  // Reports
  getArAging: () =>
    apiClient.get<AgingBucket>("/finance/reports/ar-aging"),

  getApAging: () =>
    apiClient.get<AgingBucket>("/finance/reports/ap-aging"),

  getInventoryValuation: () =>
    apiClient.get("/finance/reports/inventory-valuation"),

  getDashboardSummary: () =>
    apiClient.get<DashboardSummary>("/finance/reports/dashboard-summary"),

  // FX
  listExchangeRates: (params?: { fromCurrency?: string; toCurrency?: string }) =>
    apiClient.get("/finance/exchange-rates" + buildParams(params as Record<string, string | number | boolean | undefined>)),

  // Fiscal periods
  listFiscalPeriods: (params?: { fiscalYear?: number; status?: string }) =>
    apiClient.get("/finance/fiscal-periods" + buildParams(params as Record<string, string | number | boolean | undefined>)),

// ─── SMT Cost & Loss API calls ──────────────────────────────────────────────
  getCostSummary: () =>
    apiClient.get<{ summary: CostSummaryDay[]; totals: CostSummaryTotals }>("/finance/cost-summary"),

  getInventoryValue: () =>
    apiClient.get<{ byMaterial: MaterialInventoryValue[]; grandTotal: { grand_total: number; currency_code: string }[] }>("/finance/inventory-value"),

  getWipData: () =>
    apiClient.get<WipData>("/finance/wip"),

  getMonthlyCostTrend: () =>
    apiClient.get<{ data: MonthlyCostTrend[] }>("/finance/monthly-cost-trend"),

  getMaterialLifecycleCost: (days = 30) =>
    apiClient.get<{ data: MaterialLifecycleCost[]; periodDays: number }>("/finance/material-lifecycle-cost?days=" + days),

  getConsumptionReport: (from?: string, to?: string) =>
    apiClient.get<{ data: ConsumptionReportRow[] }>("/finance/consumption-report" + buildParams({ from, to })),

  getNgLossReport: (from?: string, to?: string) =>
    apiClient.get<{ data: NgLossReportRow[]; summary: { total_replacements: number } }>("/finance/ng-loss-report" + buildParams({ from, to })),

  getScrapReport: (from?: string, to?: string) =>
    apiClient.get<{ data: ScrapReportRow[] }>("/finance/scrap-report" + buildParams({ from, to })),

  getInventoryTurnover: (from?: string, to?: string) =>
    apiClient.get<{ data: InventoryTurnoverRow[] }>("/finance/inventory-turnover" + buildParams({ from, to })),

  getLossAnalysis: (from?: string, to?: string) =>
    apiClient.get<{ byType: LossAnalysisType[]; topLossMaterials: LossAnalysisMaterial[] }>("/finance/loss-analysis" + buildParams({ from, to })),
};


// ─── SMT Cost & Loss Types ─────────────────────────────────────────────────
export interface CostSummaryDay {
  date_key: string;
  material_cost: string;
  ng_loss: string;
  scrap_loss: string;
  compensation: string;
  consumption_count: string;
  ng_count: string;
  scrap_count: string;
}

export interface CostSummaryTotals {
  total_material_cost: string;
  total_ng_loss: string;
  total_scrap_loss: string;
  total_compensation: string;
  total_ng_events: string;
}

export interface MaterialInventoryValue {
  material_code: string;
  name_zh: string;
  lot_count: number;
  total_qty: number;
  total_value: number;
  currency: string;
}

export interface WipData {
  totalSn: number;
  totalQty: number;
  byZone: { zone: string; sn_count: number }[];
}

export interface MonthlyCostTrend {
  month: string;
  material_cost: string;
  ng_loss: string;
  scrap_loss: string;
  compensation: string;
  total_cost: string;
}

export interface MaterialLifecycleCost {
  event_type: string;
  event_count: string;
  total_cost: string;
  total_loss: string;
}

export interface ConsumptionReportRow {
  material_code: string;
  material_name: string;
  tx_count: number;
  total_cost: number;
  loss: number;
}

export interface NgLossReportRow {
  defect_type: string;
  description: string;
  replacement_count: number;
  replaced_at: string;
}

export interface ScrapReportRow {
  lot_no: string;
  material_code: string;
  scrap_count: number;
  total_loss: number;
}

export interface InventoryTurnoverRow {
  material_code: string;
  material_name: string;
  consumed_value: number;
  received_value: number;
  total_qty: number;
}

export interface LossAnalysisType {
  event_type: string;
  count: number;
  total_loss: number;
  avg_loss: number;
}

export interface LossAnalysisMaterial {
  material_code: string;
  material_name: string;
  total_loss: number;
  event_count: number;
}
