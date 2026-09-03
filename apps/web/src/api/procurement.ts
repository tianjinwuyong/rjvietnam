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

export interface ProcurementContract {
  id: number;
  contractNo: string;
  supplierId: number;
  supplierCode: string;
  supplierNameZh: string;
  poHeaderId: number | null;
  contactId: number | null;
  title: string;
  contractType: "purchase" | "framework" | "rate_agreement" | "service" | "nda";
  rawText: string | null;
  totalValue: number;
  currencyCode: string;
  paymentTerms: string | null;
  advancePct: number;
  deliveryTerms: string | null;
  qualityClause: string | null;
  warrantyMonths: number;
  penaltyClause: string | null;
  effectiveDate: string;
  expiryDate: string;
  autoRenew: boolean;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "active" | "expired" | "terminated" | "voided";
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: number | null;
  rejectedAt: string | null;
  rejectedBy: number | null;
  rejectionReason: string | null;
}

export interface ContractApprovalTask {
  id: number;
  contractId: number;
  step: number;
  approverRole: string;
  approverId: number | null;
  status: "pending" | "approved" | "rejected" | "skipped";
  decision: string | null;
  notes: string | null;
  submittedAt: string;
  decidedAt: string | null;
}

export interface ContractApprovalHistory {
  id: number;
  contractId: number;
  step: number;
  approverRole: string;
  approverId: number | null;
  action: string;
  notes: string | null;
  actedAt: string;
}

export interface PurchaseOrderHeader {
  id: number;
  poNo: string;
  supplierId: number;
  supplierCode: string;
  supplierNameZh: string;
  orderDate: string;
  promisedDate: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  currencyCode: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: "draft" | "sent" | "acknowledged" | "partially_received" | "received" | "closed" | "cancelled";
  notes: string | null;
  createdAt: string;
}

export interface PoAdjustmentRequest { id:number; request_no:string; supplier_id:number; supplier_code:string; supplier_name:string; po_no:string; adjustment_type:string; line_no:number|null; current_value:string|null; proposed_value:string; reason:string; status:string; requested_at:string; review_note:string|null }

export interface SupplierScorecard {
  id: number;
  supplierId: number;
  supplierCode: string;
  supplierNameZh: string;
  periodStart: string;
  periodEnd: string;
  onTimeDeliveryRate: number;
  qualityAcceptRate: number;
  avgLeadTimeDays: number;
  priceCompetitiveness: number;
  complaintCount: number;
  returnRate: number;
  overallScore: number;
  grade: string | null;
  notes: string | null;
  evaluatedAt: string;
}

export interface ProcurementDashboardSummary {
  activeContracts: number;
  pendingApprovals: number;
  expiringContracts: number;
  poThisMonth: number;
  poThisMonthValue: number;
}

export interface PurchaseRequisitionLine {
  id: number;
  lineNo: number;
  materialCode: string;
  materialNameZh: string;
  qtyRequested: number;
  qtyOrdered: number;
  unit: string;
  targetUnitCost: number | null;
}

export interface PurchaseRequisition {
  id: number;
  requisitionNo: string;
  requesterName: string;
  department: string;
  reason: string;
  urgency: "critical" | "urgent" | "normal" | "low";
  targetDate: string | null;
  status: string;
  lines: PurchaseRequisitionLine[];
  createdAt: string;
}

export interface ProcurementRfq {
  id: number;
  rfqNo: string;
  requisitionNo: string;
  title: string;
  status: string;
  responseDeadline: string | null;
  lines: Array<{ id: number; lineNo: number; materialCode: string; materialNameZh: string; qtyRequested: number; unit: string }>;
  quotes: Array<{
    id: number;
    quoteNo: string | null;
    supplierId: number;
    supplierName: string;
    currencyCode: string;
    grandTotal: number;
    leadTimeDays: number | null;
    status: string;
    isWinner: boolean;
  }>;
}

export interface ProcurementSupplier {
  id: number;
  code: string;
  nameZh: string;
  nameEn: string;
  defaultCurrencyCode: string;
}

export interface PoClosure {
  po: PurchaseOrderHeader;
  gates: {
    supplierAcknowledged: boolean;
    receiptComplete: boolean;
    iqcReleased: boolean;
    threeWayMatch: boolean;
    paymentSettled: boolean;
  };
  metrics: {
    orderedQty: number;
    receivedQty: number;
    orderedValue: number;
    invoiceValue: number;
    outstandingValue: number;
    tolerance: number;
  };
  canClose: boolean;
  history: unknown[];
}

export interface PoIncomingLogistics {
  poId: number;
  poNo: string;
  shipments: Array<{
    id: string; asn: string; poNo: string; eta: string; ata: string | null; shipmentType: string; status: string;
    logisticsPayload?: { carrierName?: string; vehicleNo?: string; driverName?: string; driverPhone?: string; trackingNo?: string; palletCount?: number; totalWeightKg?: number; pallets?: Array<{ palletQr?: string; lengthMm?: number; widthMm?: number; heightMm?: number; weightKg?: number }>; qrCodes?: Array<{ type?: string; value?: string }> };
    lines: Array<{ id: string; materialCode: string; materialName?: string; lotNo: string; productionDate: string; quantity: number; perBoxQuantity: number; uom: string; msl?: string }>;
  }>;
  manifests: Array<{ id: number; manifestKey: string; materialCode: string; lotNo: string; totalQuantity: number; unit: string; outerBoxCount: number; subBoxCount: number; status: string; registeredAt: string }>;
  qrCodes: Array<{ manifestId: number; qrValue: string; serialNo: string; quantity: number; packageLevel: string; parentSerialNo: string | null; palletQr: string | null; receivingStatus: string; scannedAt: string | null }>;
}

// API

export const procurementApi = {
  listRequisitions: () =>
    apiClient.get<ListEnvelope<PurchaseRequisition>>("/api/procurement/requisitions"),

  createRequisition: (body: {
    department: string;
    reason: string;
    urgency: string;
    target_date?: string;
    lines: Array<{ material_code: string; qty_requested: number; unit?: string; target_unit_cost?: number }>;
  }) => apiClient.post<PurchaseRequisition>("/api/procurement/requisitions", body),

  submitRequisition: (id: number) =>
    apiClient.put<{ submitted: boolean }>(`/api/procurement/requisitions/${id}/submit`),

  createRfq: (id: number, body: { title?: string; response_deadline?: string } = {}) =>
    apiClient.post<ProcurementRfq>(`/api/procurement/requisitions/${id}/rfq`, body),

  listRfqs: () => apiClient.get<ListEnvelope<ProcurementRfq>>("/api/procurement/rfqs"),
  listSuppliers: () => apiClient.get<ListEnvelope<ProcurementSupplier>>("/api/procurement/suppliers"),
  addQuote: (rfqId: number, body: {
    supplier_id: number; quote_no?: string; currency_code: string; lead_time_days?: number;
    payment_terms?: string; delivery_terms?: string;
    lines: Array<{ rfq_line_id: number; qty_quoted: number; unit_price: number }>;
  }) => apiClient.post<{ id: number }>(`/api/procurement/rfqs/${rfqId}/quotes`, body),
  awardQuote: (rfqId: number, quoteId: number) =>
    apiClient.post<PurchaseOrderHeader>(`/api/procurement/rfqs/${rfqId}/award`, { quote_id: quoteId }),

  listContracts: (params?: {
    status?: string;
    supplierId?: number;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }) =>
    apiClient.get<ListEnvelope<ProcurementContract>>(
      "/api/procurement/contracts" + buildParams(params as Record<string, string | number | boolean | undefined>)
    ),

  getContract: (id: number) =>
    apiClient.get<ProcurementContract>(`/api/procurement/contracts/${id}`),

  createContract: (body: {
    supplierId: number;
    title: string;
    contractType: string;
    totalValue: number;
    currencyCode: string;
    paymentTerms?: string;
    deliveryTerms?: string;
    effectiveDate: string;
    expiryDate: string;
    lines?: Array<{ lineNo: number; description: string; qty: number; unitPrice: number }>;
  }) => apiClient.post<{ id: number; contractNo: string }>("/api/procurement/contracts", body),

  submitContract: (id: number) =>
    apiClient.put<{ submitted: boolean }>(`/api/procurement/contracts/${id}/submit`),

  approveContract: (id: number) =>
    apiClient.put<{ approved: boolean }>(`/api/procurement/contracts/${id}/approve`),

  rejectContract: (id: number, reason: string) =>
    apiClient.put<{ rejected: boolean }>(`/api/procurement/contracts/${id}/reject`, { reason }),

  getApprovals: (id: number) =>
    apiClient.get<Envelope<{ tasks: ContractApprovalTask[]; history: ContractApprovalHistory[] }>>(
      `/api/procurement/contracts/${id}/approvals`
    ),

  listPos: (params?: {
    status?: string;
    supplierId?: number;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }) =>
    apiClient.get<ListEnvelope<PurchaseOrderHeader>>(
      "/api/procurement/pos" + buildParams(params as Record<string, string | number | boolean | undefined>)
    ),

  sendPo: (id: number) => apiClient.put<{ sent: boolean }>(`/api/procurement/pos/${id}/send`),
  acknowledgePo: (id: number) => apiClient.put<{ acknowledged: boolean }>(`/api/procurement/pos/${id}/acknowledge`),
  getPoClosure: (id: number) => apiClient.get<PoClosure>(`/api/procurement/pos/${id}/closure`),
  getPoIncomingLogistics: (id: number) => apiClient.get<PoIncomingLogistics>(`/api/procurement/pos/${id}/incoming-logistics`),
  runPurchasingEmployee: () => apiClient.post<{ scanned: number; tasksCreated: number; portalNotifications: number; contractsDrafted: number; materialsBlocked: number }>("/api/procurement/purchasing-employee/run-now", {}),
  sendPortalMessage: (id: number, payload: { subject: string; message: string; priority?: "NORMAL" | "WARNING" | "CRITICAL" }) => apiClient.post(`/api/procurement/pos/${id}/portal-message`, payload),
  closePo: (id: number) => apiClient.put<{ closed: boolean }>(`/api/procurement/pos/${id}/close`),
  listPoAdjustments: () => apiClient.get<ListEnvelope<PoAdjustmentRequest>>("/procurement/po-adjustments"),
  decidePoAdjustment: (x: PoAdjustmentRequest, status: "APPROVED" | "REJECTED", reviewNote: string) => apiClient.put(`/procurement/suppliers/${x.supplier_id}/po-adjustments/${encodeURIComponent(x.request_no)}/decision`, { status, reviewNote }),

  getSupplierScorecards: () =>
    apiClient.get<ListEnvelope<SupplierScorecard>>("/api/procurement/supplier-scorecards"),

  getDashboardSummary: () =>
    apiClient.get<ProcurementDashboardSummary>("/api/procurement/dashboard-summary"),
};
