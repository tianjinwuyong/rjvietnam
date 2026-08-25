import { apiClient, type ListEnvelope, type Envelope } from "./client";

function buildParams(params: Record<string, string | number | boolean | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) searchParams.set(k, String(v));
  }
  const s = searchParams.toString();
  return s ? "?" + s : "";
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
  status: "open" | "partially_fulfilled" | "fulfilled" | "closed" | "cancelled";
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
  openOrders: number;
  openOrderValue: number;
  pendingQuotes: number;
  fulfilledThisMonth: number;
  revenueThisMonth: number;
}

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
    ),

  getOrder: (id: number) =>
    apiClient.get<Envelope<SalesOrder & { lines: SalesOrderLine[]; woLinks: QuoteToWorkOrderLink[] }>>(
      `/api/sales/orders/${id}`
    ),

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
    apiClient.get<SalesDashboardSummary>("/api/sales/dashboard-summary"),
};
