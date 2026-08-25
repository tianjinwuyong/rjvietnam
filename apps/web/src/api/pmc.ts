import { apiClient, authStorage, type ListEnvelope, type MutateEnvelope } from "./client";


export interface WorkOrder {
  id: number;
  code: string;
  type: number;
  plannedQty: number;
  completedQty: number;
  status: string;
  productCode: string;
  productNameZh: string;
  lineCode: string;
  lineNameZh: string;
  poNumber: string | null;
  bomId?: number | string;
  bomRevision?: string;
  lockedBy?: string | null;
  lockedAt?: string | null;
  activeOperators?: string[];
}


export interface Schedule {
  id: number;
  code: string;
  plannedQty: number;
  completedQty: number;
  status: string;
  lineCode: string;
  lineNameZh: string;
  productCode: string;
}


export interface CustomerPo {
  id: number;
  poNumber: string;
  customerName: string;
  orderQty: number;
  dueDate: string;
  status: string;
}


export interface PmcDashboardSummary {
  workOrders: { status: string; cnt: number }[];
  lines: { status: string; cnt: number }[];
}

export type PmcPlanReviewType = "CAPACITY" | "MATERIAL" | "BOM" | "QUALITY" | "COST" | "DELIVERY";
export type PmcPlanReviewResult = "PASS" | "WARNING" | "FAIL";

export interface PmcClosedLoopPlan {
  id: number;
  plan_no: string;
  product_code: string;
  product_name: string;
  planned_qty: number;
  planned_start_at: string;
  planned_finish_at: string;
  line_name: string | null;
  priority_code: string;
  status: string;
  reviews: Array<{
    reviewType: PmcPlanReviewType;
    result: PmcPlanReviewResult;
    detail: Record<string, unknown>;
    reviewedBy: string;
    reviewedAt: string;
  }>;
  approvals: Array<{
    role: "PMC_MANAGER" | "PRODUCTION_MANAGER";
    decision: "APPROVE" | "REJECT";
    actor: string;
    comment: string;
    decidedAt: string;
  }>;
  work_order_code: string | null;
  work_order_status: string | null;
}

export interface PmcClosedLoopDashboard {
  metrics: {
    pending_demands: number;
    pending_plans: number;
    active_expedites: number;
    active_work_orders: number;
  };
  demands: Array<{
    id: number;
    demand_no: string;
    source_type: string;
    product_code: string;
    required_qty: number;
    required_date: string;
    priority_code: string;
    status: string;
  }>;
  plans: PmcClosedLoopPlan[];
  expedites: Array<Record<string, unknown>>;
}


// ── Patrol State types ────────────────────────────────────────────────

export type PatrolNodeState = "firing" | "warning" | "idle" | "disabled";

export interface PatrolNode {
  state: PatrolNodeState;
  detail: string;
  escalations: number;
}

export interface PatrolState {
  cycle: number;
  timestamp: string;
  nodes: Record<string, PatrolNode>;
  total_escalations: number;
  overdue_count: number;
  patrol_duration_ms: number;
}

// ── Delivery Watch types ─────────────────────────────────────────────

export type DeliveryTier = "OVERDUE" | "WARNING" | "CAUTION" | "ON_TRACK";

export interface DeliveryWatchItem {
  wo_code: string;
  product_code: string;
  line_code: string;
  due_date: string;
  completion_pct: number;
  completed_qty: number;
  planned_qty: number;
  delay_hours: number;
  tier: DeliveryTier;
  rate_detail?: string;
  alert_id?: number;
}


// ── Demo store ───────────────────────────────────────────────────────

const demoStore: { workOrders: WorkOrder[]; nextId: number; customerPos: CustomerPo[] } = {
  workOrders: [
    { id: 1, code: "26061010001", type: 1, plannedQty: 9600, completedQty: 9600, status: "closed", productCode: "PCBA-AURORA-CTRL", productNameZh: "Aurora PCB", lineCode: "L001", lineNameZh: "SMT Line", poNumber: "RJ-VN-PO-240611" },
    { id: 2, code: "26061010002", type: 1, plannedQty: 7200, completedQty: 4800, status: "running", productCode: "PCBA-AURORA-CTRL", productNameZh: "Aurora PCB", lineCode: "L002", lineNameZh: "AOI Line", poNumber: "RJ-VN-PO-240612" },
    { id: 3, code: "26061020003", type: 2, plannedQty: 200, completedQty: 200, status: "closed", productCode: "PCBA-AURORA-CTRL", productNameZh: "Aurora PCB(Product)", lineCode: "L001", lineNameZh: "SMT Line", poNumber: "RJ-VN-PO-240615" },
  ],
  nextId: 4,
  customerPos: [
    { id: 1, poNumber: "RJ-VN-PO-240611", customerName: "Ruijing Vietnam", orderQty: 9600, dueDate: "2026-06-25", status: "confirmed" },
    { id: 2, poNumber: "RJ-VN-PO-240612", customerName: "Ruijing Vietnam", orderQty: 7200, dueDate: "2026-06-30", status: "confirmed" },
    { id: 3, poNumber: "RJ-VN-PO-240615", customerName: "Aurora Tech", orderQty: 200, dueDate: "2026-06-20", status: "confirmed" },
  ],
};

const LINE_NAMES: Record<string, string> = {
  L001: "SMT Line", L002: "AOI Line", L003: "Assembly", L004: "Manual", L099: "Test Line",
};

function isDemoMode(): boolean {
  return !authStorage.getToken();
}

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}


// ── pmcApi ───────────────────────────────────────────────────────────

export const pmcApi = {

  async getClosedLoopDashboard(): Promise<PmcClosedLoopDashboard> {
    return apiClient.get("/pmc/closed-loop/dashboard");
  },

  async reviewPlan(
    id: number,
    payload: {
      reviewType: PmcPlanReviewType;
      result: PmcPlanReviewResult;
      detail: { conclusion: string; evidenceRef: string };
      actor: string;
    },
  ) {
    return apiClient.post(`/pmc/plans/${id}/reviews`, payload);
  },

  async decidePlan(
    id: number,
    payload: {
      approvalRole: "PMC_MANAGER" | "PRODUCTION_MANAGER";
      decision: "APPROVE" | "REJECT";
      actor: string;
      comment: string;
    },
  ) {
    return apiClient.post(`/pmc/plans/${id}/decision`, payload);
  },

  async bindPlanWorkOrder(
    id: number,
    payload: { workOrderCode: string; kitReady: boolean; actor: string },
  ) {
    return apiClient.post(`/pmc/plans/${id}/bind-work-order`, payload);
  },

  async releasePlanToMes(id: number, actor: string) {
    return apiClient.post(`/pmc/plans/${id}/release-to-mes`, { actor });
  },

  // ── Work Orders ──────────────────────────────────────────────────

  /** GET /pmc/work-orders */
  async getWorkOrders(params?: { status?: string; q?: string; limit?: number; offset?: number }): Promise<ListEnvelope<WorkOrder>> {
    if (isDemoMode()) {
      let items = [...demoStore.workOrders];
      if (params?.status) items = items.filter((w) => w.status === params.status);
      if (params?.q) {
        const q = params.q.toLowerCase();
        items = items.filter((w) => w.code.toLowerCase().includes(q) || w.productCode.toLowerCase().includes(q));
      }
      const total = items.length;
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? 20;
      return delay({ items: items.slice(offset, offset + limit), total });
    }
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.q) qs.set("q", params.q);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<WorkOrder>>(`/pmc/work-orders${query ? `?${query}` : ""}`);
  },

  /** POST /pmc/work-orders */
  async createWorkOrder(workOrder: { customerPoId?: number; woType?: number; lineCode: string; productCode: string; plannedQty: number; bomId: number | string; bomRevision: string; dueDate: string }): Promise<MutateEnvelope<{ id: number; code: string; woType: number }>> {
    if (isDemoMode()) {
      const id = demoStore.nextId++;
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const numericLine = workOrder.lineCode.replace(/[^0-9]/g, "").slice(-2).padStart(2, "0");
      const code = `${yy}${mm}${workOrder.woType ?? 1}${numericLine}${String(id).padStart(4, "0")}`;
      const wo: WorkOrder = {
        id, code, type: workOrder.woType ?? 1,
        plannedQty: workOrder.plannedQty, completedQty: 0, status: "released",
        productCode: workOrder.productCode, productNameZh: workOrder.productCode,
        lineCode: workOrder.lineCode, lineNameZh: LINE_NAMES[workOrder.lineCode] ?? workOrder.lineCode,
        poNumber: workOrder.customerPoId ? demoStore.customerPos.find((p) => p.id === workOrder.customerPoId)?.poNumber ?? null : null,
        bomId: workOrder.bomId, bomRevision: workOrder.bomRevision,
      };
      demoStore.workOrders.unshift(wo);
      return delay({ item: { id: wo.id, code: wo.code, woType: wo.type }, auditEventId: id });
    }
    return apiClient.post<MutateEnvelope<{ id: number; code: string; woType: number }>>("/pmc/work-orders", { payload: { workOrder } });
  },

  /** PATCH /pmc/work-orders/:code */
  async updateWorkOrderStatus(code: string, status: string): Promise<{ code: string; status: string }> {
    if (isDemoMode()) {
      const wo = demoStore.workOrders.find((w) => w.code === code);
      if (wo) wo.status = status;
      return delay({ code, status });
    }
    return apiClient.patch<{ code: string; status: string }>(`/pmc/work-orders/${code}`, { payload: { status } });
  },

  /** POST /pmc/work-orders/:code/quick-approve-release */
  async quickApproveAndReleaseWorkOrder(code: string, reason = "Quick approval from PMC work-order list") {
    if (isDemoMode()) {
      const wo = demoStore.workOrders.find((w) => w.code === code);
      if (wo) wo.status = "released";
      return delay({ item: { code, status: "released" } });
    }
    return apiClient.post<MutateEnvelope<{ code: string; status: string; releasedAt: string }>>(
      `/pmc/work-orders/${encodeURIComponent(code)}/quick-approve-release`,
      { payload: { reason } },
    );
  },

  /** POST /pmc/work-orders/:code/closure-check — records quantity reconciliation and closure gates. */
  async checkWorkOrderClosure(code: string, payload: {
    actor?: string;
    quantityDetail?: {
      varianceReason?: string;
      approvedBy?: string;
      buckets?: Array<{ bucketQr: string; station: string; quantity: number }>;
      evidenceRefs?: string[];
    };
    materialReconciled?: boolean;
    qualityClosed?: boolean;
    handoversClosed?: boolean;
    finishedGoodsReceived?: boolean;
    costSettled?: boolean;
  }) {
    return apiClient.post(`/pmc/work-orders/${encodeURIComponent(code)}/closure-check`, { payload });
  },

  /** GET /pmc/customer-pos */
  async getCustomerPos(): Promise<ListEnvelope<CustomerPo>> {
    if (isDemoMode()) {
      return delay({ items: [...demoStore.customerPos], total: demoStore.customerPos.length });
    }
    return apiClient.get<ListEnvelope<CustomerPo>>("/pmc/customer-pos");
  },

  async getErpCustomers(): Promise<ListEnvelope<{
    id: number; code: string; name: string; status: string; lifecycleStatus?: string;
    riskLevel?: string; contactName?: string; email?: string; phone?: string; paymentTermsDays?: number;
  }>> {
    return apiClient.get("/erp/customers");
  },

  async createErpCustomer(payload: {
    code: string; nameZh: string; nameEn?: string; contactName?: string; email?: string;
    phone?: string; paymentTermsDays?: number; riskLevel?: string;
  }) {
    return apiClient.post<MutateEnvelope<{ id: number; code: string; name: string; status: string }>>(
      "/erp/customers",
      { payload },
    );
  },

  async setErpCustomerStatus(id: number, status: "active" | "inactive") {
    return apiClient.patch(`/erp/customers/${id}/status`, { payload: { status } });
  },

  async transitionErpCustomer(
    id: number,
    action: "submit" | "approve" | "reject" | "hold" | "reactivate" | "archive",
    reason: string,
  ) {
    return apiClient.post(`/erp/customers/${id}/transition`, { payload: { action, reason } });
  },

  async updateErpCustomer(id: number, payload: { code?: string; nameZh?: string; nameEn?: string }) {
    return apiClient.patch(`/erp/customers/${id}`, { payload });
  },

  async deleteErpCustomer(id: number) {
    return apiClient.delete(`/erp/customers/${id}`);
  },

  async getErpProducts(): Promise<ListEnvelope<{ id: number; code: string; nameZh?: string; nameEn?: string; status: string }>> {
    return apiClient.get("/erp/products");
  },

  async createCustomerPo(payload: {
    poNumber: string;
    customerId: number;
    productId: number;
    orderQty: number;
    dueDate: string;
  }): Promise<MutateEnvelope<{ id: number; po_number: string }>> {
    return apiClient.post("/erp/customer-pos", { payload });
  },

  async createErpProduct(payload: { code: string; nameZh: string; nameEn?: string; revision?: string }) {
    return apiClient.post<MutateEnvelope<{ id: number; code: string; nameZh: string; status: string }>>(
      "/erp/products",
      { payload },
    );
  },

  async setErpProductStatus(id: number, status: "active" | "inactive") {
    return apiClient.patch(`/erp/products/${id}/status`, { payload: { status } });
  },

  async updateErpProduct(id: number, payload: { code?: string; nameZh?: string; nameEn?: string; revision?: string }) {
    return apiClient.patch(`/erp/products/${id}`, { payload });
  },

  async deleteErpProduct(id: number) {
    return apiClient.delete(`/erp/products/${id}`);
  },

  async getCustomerPoClosure(id: number | string): Promise<{
    po: CustomerPo & { productCode?: string; closedAt?: string };
    metrics: Record<string, unknown>;
    gates: Array<{
      gateCode: string;
      status: "PASS" | "BLOCKED";
      source: "SYSTEM" | "APPROVED_OVERRIDE";
      detail: string;
      decision?: { reason: string; evidence_ref: string; actor: string; created_at: string } | null;
    }>;
    readyToClose: boolean;
  }> {
    return apiClient.get(`/pmc/customer-pos/${id}/closure`);
  },

  async decideCustomerPoClosureGate(
    id: number | string,
    payload: { gateCode: string; result: "PASS" | "FAIL"; reason: string; evidenceRef: string },
  ) {
    return apiClient.post(`/pmc/customer-pos/${id}/closure/decisions`, payload);
  },

  async closeCustomerPo(id: number | string) {
    return apiClient.post(`/pmc/customer-pos/${id}/close`, {});
  },

  async getSchedules(params?: { lineCode?: string; limit?: number; offset?: number }): Promise<ListEnvelope<Schedule>> {
    if (isDemoMode()) {
      const items: Schedule[] = demoStore.workOrders
        .filter((w) => !params?.lineCode || w.lineCode === params.lineCode)
        .map((w) => ({ id: w.id, code: w.code, plannedQty: w.plannedQty, completedQty: w.completedQty, status: w.status, lineCode: w.lineCode, lineNameZh: w.lineNameZh, productCode: w.productCode }));
      const total = items.length;
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? 20;
      return delay({ items: items.slice(offset, offset + limit), total });
    }
    const qs = new URLSearchParams();
    if (params?.lineCode) qs.set("lineCode", params.lineCode);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<Schedule>>(`/pmc/schedules${query ? `?${query}` : ""}`);
  },

  // ── Material Requirements ─────────────────────────────────────────

  /** GET /mes/work-order-requirements?workOrderCode=X */
  async getWorkOrderRequirements(workOrderCode: string): Promise<{
    items: Array<{
      id: string; pickOrderId: string; materialCode: string;
      materialName: { name_zh: string; name_en: string; name_vi: string };
      requiredQty: number; pickedQty: number; lotNo: string | null;
      locationCode: string | null; status: string;
    }>;
  }> {
    return apiClient.get(`/mes/work-order-requirements?workOrderCode=${encodeURIComponent(workOrderCode)}`);
  },

  async completeWorkOrder(woCode: string, payload: { outputQty?: number; ngQty?: number; stationCode?: string; operator?: string }) {
    return apiClient.post(`/pmc/work-orders/${encodeURIComponent(woCode)}/complete`, { payload });
  },

  async lockWorkOrder(woCode: string, payload: { operator: string }) {
    return apiClient.post(`/pmc/work-orders/${encodeURIComponent(woCode)}/lock`, { payload });
  },

  async unlockWorkOrder(woCode: string, payload: { operator: string; force?: boolean }) {
    return apiClient.post(`/pmc/work-orders/${encodeURIComponent(woCode)}/unlock`, { payload });
  },

  async freezeWorkOrder(woCode: string, payload: { status?: string; changeReason?: string; plannedQty?: number; priority?: number; operator?: string }) {
    return apiClient.patch(`/pmc/work-orders/${encodeURIComponent(woCode)}/freeze`, { payload });
  },

  async getWorkOrderGantt(lineCode?: string) {
    const q = lineCode ? `?lineCode=${encodeURIComponent(lineCode)}` : "";
    return apiClient.get(`/pmc/work-order-gantt${q}`);
  },

  async getWorkOrderQcReport(workOrderCode: string) {
    return apiClient.get(`/pmc/work-order-qc-report?workOrderCode=${encodeURIComponent(workOrderCode)}`);
  },

  async getWorkOrderAlerts(alertLevel = "all", limit = 50, offset = 0): Promise<{
    data: {
      items: Array<{
        id: number; code: string; status: string;
        plannedQty: number; completedQty: number;
        dueDate: string | null; releasedAt: string | null;
        productCode: string; productNameZh: string;
        lineCode: string; lineNameZh: string;
        poNumber: string | null;
        alertLevel: "overdue" | "delay" | "material_risk" | "normal";
        progressPct: number;
        materialFulfillment: number | null;
        daysUntilDue: number | null;
      }>;
      counts: { overdue: number; delay: number; material_risk: number };
    };
  }> {
    return apiClient.get(`/pmc/work-order-alerts?alertLevel=${alertLevel}&limit=${limit}&offset=${offset}`);
  },

  async getNgReviews(status?: string, limit = 50, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set("status", status);
    return apiClient.get(`/pmc/ng-reviews?${params}`);
  },

  async patchNgReview(id: number, payload: { rootCause?: string; improvementAction?: string; reviewStatus?: string }) {
    return apiClient.patch(`/pmc/ng-reviews/${id}`, { payload });
  },

  async getNgSummary(days = 30) {
    return apiClient.get(`/pmc/ng-summary?days=${days}`);
  },

  async getWorkOrderMaterialStatus(workOrderCode: string) {
    return apiClient.get<{
      workOrder: {
        woId: number; woCode: string; plannedQty: number; completedQty: number;
        status: string; productCode: string; productNameZh: string;
        lineCode: string; lineNameZh: string; bomRevision: string | null;
      };
      items: Array<{
        id: number; materialCode: string; vietnamCode: string | null;
        materialNameZh: string; materialNameEn: string;
        uom: string; materialType: string;
        qtyPer: number; lossRate: number; referenceDesignators: string | null; spec: string | null;
        totalRequired: number; pickedQty: number; shortfall: number;
        bestLot: { lotNo: string; locationCode: string; availableQty: number } | null;
      }>;
      summary: { totalMaterials: number; fulfilledMaterials: number; fulfillmentPct: number; totalShortfall: number; woProgressPct: number };
    }>(`/pmc/work-order-material-status?workOrderCode=${encodeURIComponent(workOrderCode)}`);
  },

  // ── Alert Channels ────────────────────────────────────────────────

  async getAlertChannels() {
    return apiClient.get<{ items: Array<{ id: number; name: string; channel_type: string; webhook_url: string | null; telegram_bot_token: string | null; telegram_chat_id: string | null; is_active: boolean }> }>("/pmc/alert-channels");
  },

  async updateAlertChannel(id: number, payload: { name?: string; webhook_url?: string; telegram_bot_token?: string; telegram_chat_id?: string; is_active?: boolean }) {
    return apiClient.patch<{ id: number }>(`/pmc/alert-channels/${id}`, { payload });
  },

  async sendAlert(payload: { alertType?: string; workOrderCode?: string; lineCode?: string; priority?: string; title: string; message: string }) {
    return apiClient.post("/pmc/alerts/send", { payload });
  },

  // ── NG Review ───────────────────────────────────────────────────

  async ngAutoImport() {
    return apiClient.post<{ imported: number; rows: Array<{ id: number }> }>("/pmc/ng-reviews/auto-import", {});
  },

  // ── Supplementary Materials ─────────────────────────────────────

  async getSupplementaryMaterials(params?: { workOrderCode?: string; status?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.workOrderCode) qs.set("workOrderCode", params.workOrderCode);
    if (params?.status) qs.set("status", params.status);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<{
      items: Array<{
        id: number; requiredQty: number; uom: string; reason: string;
        status: string; createdAt: string; workOrderCode: string;
        plannedQty: number; productCode: string; productNameZh: string;
        materialCode: string; materialNameZh: string; requestedByName: string;
      }>;
      total: number;
      summary: Array<{ status: string; count: string; total_qty: string }>;
    }>(`/pmc/supplementary-materials${query ? `?${query}` : ""}`);
  },

  async createSupplementaryMaterial(payload: {
    workOrderCode: string; materialCode: string; requiredQty: number;
    uom?: string; reason: string; requestedByName?: string;
  }) {
    return apiClient.post<{ data: { id: number; status: string; createdAt: string } }>(
      "/pmc/supplementary-materials", payload
    );
  },

  async patchSupplementaryMaterial(id: number, payload: {
    status?: string; requiredQty?: number; reason?: string;
  }) {
    return apiClient.patch<{ data: { id: number; status: string; requiredQty?: number; reason?: string } }>(
      `/pmc/supplementary-materials/${id}`, payload
    );
  },

  async deleteSupplementaryMaterial(id: number) {
    return apiClient.delete<{ data: { id: number; status: string } }>(`/pmc/supplementary-materials/${id}`);
  },

  // ── Patrol State (reads from patrol state JSON written by patrol scripts) ──

  async getPatrolState(): Promise<PatrolState> {
    if (isDemoMode()) {
      return delay({
        cycle: 42,
        timestamp: new Date().toISOString(),
        nodes: {
          delivery_watch:     { state: "idle", detail: "No delivery alerts", escalations: 0 },
          rate_check:         { state: "idle", detail: "All WOs within rate", escalations: 0 },
          abnormal_detector:  { state: "idle", detail: "No abnormal events", escalations: 0 },
          material_shortage:  { state: "idle", detail: "All materials ready", escalations: 0 },
          notification_router:{ state: "idle", detail: "No notifications needed", escalations: 0 },
        },
        total_escalations: 0,
        overdue_count: 0,
        patrol_duration_ms: 2847,
      });
    }
    return apiClient.get<PatrolState>("/pmc/patrol-state");
  },

  // ── Delivery Watch ───────────────────────────────────────────────

  async getDeliveryWatch(): Promise<{ items: DeliveryWatchItem[]; last_run: string }> {
    if (isDemoMode()) {
      return delay({
        last_run: new Date().toISOString(),
        items: [
          {
            wo_code: "26061030009", product_code: "EPS48R1-36", line_code: "L002",
            due_date: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
            completion_pct: 23.6, completed_qty: 118, planned_qty: 500,
            delay_hours: -4.2, tier: "OVERDUE",
            rate_detail: "required_rate 90.9 > current_rate 5.1 × 1.2",
          },
          {
            wo_code: "26061010003", product_code: "B2672111-001", line_code: "L001",
            due_date: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
            completion_pct: 15.0, completed_qty: 75, planned_qty: 500,
            delay_hours: 18.5, tier: "WARNING",
            rate_detail: "required_rate 18.5 > current_rate 3.1 × 1.2",
          },
          {
            wo_code: "26061010010", product_code: "EPS18R1G", line_code: "L002",
            due_date: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
            completion_pct: 58.0, completed_qty: 580, planned_qty: 1000,
            delay_hours: 34.0, tier: "CAUTION",
          },
          {
            wo_code: "26061010011", product_code: "B2672111-001", line_code: "L001",
            due_date: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
            completion_pct: 70.0, completed_qty: 700, planned_qty: 1000,
            delay_hours: 70.0, tier: "ON_TRACK",
          },
        ],
      });
    }
    return apiClient.get<{ items: DeliveryWatchItem[]; last_run: string }>("/pmc/delivery-watch");
  },

  // ── NG Compensation (PMC approval) ─────────────────────────────────

  async getNgCompensations(params?: { workOrderCode?: string; status?: string }): Promise<any> {
    const qs = params ? "?" + new URLSearchParams(params as Record<string,string>).toString() : "";
    return apiClient.get("/mes/ng-compensations" + qs);
  },

  async patchNgCompensation(id: number, payload: {
    status: string;
    reviewNote?: string;
    reviewedBy?: string;
    reviewedByName?: string;
  }): Promise<any> {
    return apiClient.patch(`/mes/ng-compensations/${id}`, payload);
  },

  async getNgCompensationReasons(): Promise<any> {
    return apiClient.get("/mes/ng-compensation-reasons");
  },
};
