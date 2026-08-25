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

export interface EinvoiceInvoice {
  id: number;
  invoiceNo: string;
  einvoiceReference: string | null;
  providerName: string | null;
  invoiceType: string | null;
  arInvoiceId: number | null;
  customerId: number | null;
  buyerName: string | null;
  buyerTaxCode: string | null;
  buyerAddress: string | null;
  issueDate: string;
  totalAmount: number;
  vatAmount: number;
  grossAmount: number;
  currencyCode: string;
  status: "draft" | "published" | "cancelled" | "voided";
  xmlPayload: string | null;
  pdfUrl: string | null;
  gdtConfirmationCode: string | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  adjustmentReason: string | null;
  createdAt: string;
}

export interface EinvoiceConfig {
  id: number;
  providerName: string | null;
  apiEndpoint: string | null;
  apiKeyMasked: string | null;
  taxCode: string | null;
  companyName: string | null;
  companyAddress: string | null;
  bankAccount: string | null;
  bankName: string | null;
  isActive: boolean | null;
  updatedAt: string | null;
}

export interface EinvoiceApiLog {
  id: number;
  invoiceId: number | null;
  invoiceNo: string | null;
  action: string;
  requestMethod: string | null;
  requestPayload: string | null;
  responseCode: number | null;
  responseMessage: string | null;
  errorDetails: string | null;
  createdAt: string;
}

export interface EinvoiceDashboardSummary {
  totalIssued: number;
  totalCancelled: number;
  totalAmount: number;
  publishedCount: number;
  cancelledCount: number;
}

// API

export const einvoiceApi = {
  listInvoices: (params?: {
    status?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }) =>
    apiClient.get<ListEnvelope<EinvoiceInvoice>>(
      "/api/einvoice/invoices" + buildParams(params as Record<string, string | number | boolean | undefined>)
    ),

  getInvoice: (id: number) =>
    apiClient.get<Envelope<EinvoiceInvoice & { logs: EinvoiceApiLog[] }>>(
      `/api/einvoice/invoices/${id}`
    ),

  getConfig: () =>
    apiClient.get<EinvoiceConfig>("/api/einvoice/config"),

  updateConfig: (body: {
    providerName: string;
    apiEndpoint: string;
    apiKey: string;
    apiSecret: string;
    taxCode: string;
    companyName: string;
    companyAddress: string;
    bankAccount: string;
    bankName: string;
  }) => apiClient.put<{ updated: boolean; id: number }>("/api/einvoice/config", body),

  issueFromAr: (arInvoiceId: number) =>
    apiClient.post<{
      issued?: boolean;
      alreadyIssued?: boolean;
      id: number;
      einvoiceReference?: string;
    }>(`/api/einvoice/ar/${arInvoiceId}/issue`),

  cancelInvoice: (id: number, reason: string) =>
    apiClient.post<{ cancelled: boolean }>(`/api/einvoice/${id}/cancel`, { reason }),

  getLogs: (limit = 50) =>
    apiClient.get<ListEnvelope<EinvoiceApiLog>>(`/api/einvoice/logs?limit=${limit}`),

  getDashboardSummary: () =>
    apiClient.get<EinvoiceDashboardSummary>("/api/einvoice/dashboard-summary"),
};
