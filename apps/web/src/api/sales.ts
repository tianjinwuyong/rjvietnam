import { apiClient, type ListEnvelope } from "./client";

function buildParams(params: Record<string, string | number | boolean | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) searchParams.set(k, String(v));
  }
  const s = searchParams.toString();
  return s ? "?" + s : "";
}

// The API returns snake_case DB columns; convert keys to camelCase so the
// frontend types (SalesOrder, SalesOrderLine, SalesOrderStatusHistory, …) line up.
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelize<T = unknown>(input: unknown): T {
  if (Array.isArray(input)) {
    return input.map((v) => camelize(v)) as unknown as T;
  }
  if (input !== null && typeof input === "object" && !(input instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[snakeToCamel(k)] = camelize(v);
    }
    return out as T;
  }
  return input as T;
}

// Types

export interface SalesQuote {
  id: number;
  quoteNo: string;
  customerId: number;
  customerCode: string;
  customerNameZh: string;
  contactId: number | null;
  currency: string;
  validUntil: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired";
  totalAmount: number;
  notes: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface SalesQuoteLine {
  id: number;
  quoteId: number;
  lineNo: number;
  productId: number;
  productCode: string;
  productNameZh: string;
  qty: number;
  unitPrice: number;
  leadTimeDays: number;
  notes: string | null;
}

export interface SalesOrder {
  id: number;
  soNo: string;
  customerId: number;
  customerCode: string;
  customerNameZh: string;
  quoteId: number | null;
  currency: string;
  totalAmount: number;
  status: "open" | "confirmed" | "released" | "in_production" | "ready_to_ship" | "shipped" | "delivered" | "invoiced" | "paid" | "partially_fulfilled" | "fulfilled" | "closed" | "cancelled";
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface SalesOrderLine {
  id: number;
  soId: number;
  lineNo: number;
  productId: number;
  productCode: string;
  productNameZh: string;
  qty: number;
  fulfilledQty: number;
  unitPrice: number;
  plannedDelivery: string;
  notes: string | null;
}

export interface QuoteToWorkOrderLink {
  salesOrderLineId: number;
  customerPoId: number | null;
  workOrderId: number | null;
  workOrderCode: string | null;
  linkedAt: string;
}

export interface SalesDashboardSummary {
  openSOs: number;
  openSOValue: number;
  pendingQuotes: number;
  fulfilledSOs: number;
  monthlyRevenue: number;
}

export interface SalesOrderStatusHistory {
  id: number;
  fromStatus: string;
  toStatus: string;
  actor: string | null;
  note: string | null;
  createdAt: string;
}

export type SalesOrderAction =
  | "confirm"
  | "release"
  | "ship"
  | "deliver"
  | "invoice"
  | "pay"
  | "cancel"
  | "close";

// API

export const salesApi = {
  listOrders: (params?: {
    status?: string;
    customerId?: number;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }) =>
    apiClient.get<ListEnvelope<SalesOrder>>(
      "/api/sales/orders" + buildParams(params as Record<string, string | number | boolean | undefined>)
    ).then((r) => camelize<ListEnvelope<SalesOrder>>(r)),

  getOrder: (id: number) =>
    apiClient.get<SalesOrder & { lines: SalesOrderLine[]; woLinks: QuoteToWorkOrderLink[] }>(
      `/api/sales/orders/${id}`
    ).then((r) => camelize<SalesOrder & { lines: SalesOrderLine[]; woLinks: QuoteToWorkOrderLink[] }>(r)),

  createOrder: (body: {
    customerId: number;
    quoteId?: number;
    currency: string;
    lines: Array<{
      lineNo: number;
      productId: number;
      qty: number;
      unitPrice: number;
      plannedDelivery: string;
    }>;
  }) => apiClient.post<{ id: number; soNo: string }>("/api/sales/orders", body),

  fulfillLine: (orderId: number, lineId: number, fulfilledQty: number) =>
    apiClient.put<{ fulfilled: boolean; soStatus: string }>(
      `/api/sales/orders/${orderId}/lines/${lineId}/fulfill`,
      { fulfilledQty }
    ),

  listQuotes: (params?: {
    status?: string;
    customerId?: number;
    limit?: number;
  }) =>
    apiClient.get<ListEnvelope<SalesQuote>>(
      "/api/sales/quotes" + buildParams(params as Record<string, string | number | boolean | undefined>)
    ),

  convertQuoteToSo: (quoteId: number) =>
    apiClient.put<{ salesOrderId: number; soNo: string }>(`/api/sales/quotes/${quoteId}/convert-to-so`),

  getDashboardSummary: () =>
    apiClient.get<SalesDashboardSummary>("/api/sales/dashboard-summary").then((r) => camelize<SalesDashboardSummary>(r)),

  // ── Closed-loop transitions ──────────────────────────────────────
  // apiClient strips the outer `data` wrapper, so these resolve to the inner payload.

  confirm: (id: number) =>
    apiClient.post<{ confirmed: boolean; workOrders: Array<{ id: number; code: string }> }>(
      `/api/sales/orders/${id}/confirm`, {}
    ),

  release: (id: number) =>
    apiClient.post<{ released: boolean }>(`/api/sales/orders/${id}/release`, {}),

  ship: (id: number) =>
    apiClient.post<{ shipped: boolean }>(`/api/sales/orders/${id}/ship`, {}),

  deliver: (id: number) =>
    apiClient.post<{ delivered: boolean }>(`/api/sales/orders/${id}/deliver`, {}),

  invoice: (id: number) =>
    apiClient.post<{ invoiced: boolean; invoice: { id: number; invoiceNo: string } }>(
      `/api/sales/orders/${id}/invoice`, {}
    ),

  pay: (id: number) =>
    apiClient.post<{ paid: boolean }>(`/api/sales/orders/${id}/pay`, {}),

  cancel: (id: number, reason: string) =>
    apiClient.post<{ cancelled: boolean }>(`/api/sales/orders/${id}/cancel`, { reason }),

  close: (id: number) =>
    apiClient.post<{ closed: boolean }>(`/api/sales/orders/${id}/close`, {}),

  getHistory: (id: number) =>
    apiClient.get<{ history: SalesOrderStatusHistory[] }>(`/api/sales/orders/${id}/history`).then((r) => camelize<{ history: SalesOrderStatusHistory[] }>(r)),
};
