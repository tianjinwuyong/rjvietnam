import { API_BASE, apiClient, authStorage, type ListEnvelope, type MutateEnvelope } from "./client";
import type { MaterialLot, IqcStatus, InventoryAction, PickOrder } from "../../../../packages/shared-types/src/factory";

// Generic apiClient re-export for WMS quality components
export const api = apiClient;

// Re-export for consumers
export type { MaterialLot, IqcStatus, InventoryAction };


export interface IncomingRecord {
  id:number; lot_no:string; material_code:string; material_name:string;
  supplier_code:string; supplier_name:string; po_no:string;
  delivery_note_no:string; invoice_no:string; received_qty:number;
  uom_code:string; received_at:string; packaging_status:string;
  msd_level:string; expiry_date:string; operator_id:string;
  iqc_status:string; attachments:{type:string;url:string;name:string;uploaded_at:string}[];
  created_at:string; updated_at?:string;
}
export interface IqcAqlRule {
  id:number; material_category:string; supplier_grade:string;
  aql_critical:number; aql_major:number; aql_minor:number; active:boolean;
}
export interface IqcSamplingPlan {
  id:number; batch_size_min:number; batch_size_max:number; aql_level:string;
  sample_size:number; ac_critical:number; re_critical:number;
  ac_major:number; re_major:number; ac_minor:number; re_minor:number;
}
export interface IqcInspection {
  id:number; incoming_record_id:number; lot_no:string; material_code:string;
  supplier_code:string; batch_size:number; sample_size:number; aql_level:string;
  ac_critical:number; re_critical:number; ac_major:number; re_major:number;
  ac_minor:number; re_minor:number; inspector_id:string; inspection_types:string[];
  result:string; submitted_at:string; completed_at:string; defects?:IqcDefect[];
  created_at:string;
}
export interface IqcDefect {
  id:number; inspection_id:number; defect_type:string; defect_location:string;
  defect_count:number; severity:string; photo_url:string; created_at:string;
}
export interface IqcSpecialApproval {
  id:number; inspection_id:number; applicant_id:string;
  approver_iqc_id:string; approver_engineering_id:string;
  status:string; reason:string; notes:string;
  submitted_at:string; iqc_approved_at:string; engineering_approved_at:string;
  lot_no?:string; material_code?:string; supplier_code?:string;
}

export interface WmsClosureDashboardData {
  metrics: {
    pending_approval: number; in_transit: number; overdue_cases: number;
    overdue_handovers: number; active_freezes: number; closed_today: number;
  };
  processes: Array<{
    key: "receiving"|"iqc"|"putaway"|"issue"|"consumption"|"returns"|"reconciliation"|"audit";
    completed24h: number; openCount: number; status: "CONTROLLED"|"ATTENTION";
    owner: string; slaMinutes: number; tab: string; overdueCount: number;
  }>;
  gateItems: Array<{
    processKey: "iqc"|"putaway"; entityKey: string; state: string; quantity: number;
    openedAt: string; ageMinutes: number; overdue: boolean;
  }>;
  cases: Array<{
    id: number; caseNo: string; caseType: string; entityType: string; entityKey: string;
    reasonCode: string; riskLevel: string; status: string; requestedBy: string;
    requestedAt: string; expectedQty?: number; actualQty?: number; differenceQty?: number;
  }>;
  handovers: Array<{
    id: number; handoverNo: string; entityType: string; entityKey: string; quantity: number;
    fromDomain: string; toDomain: string; status: string; senderBadge: string;
    receiverBadge?: string; sentAt?: string; receivedAt?: string; dueAt: string; overdue: boolean;
  }>;
}

export interface StorageLocation {
  id: number;
  code: string;
  area: string;
  status: string;
  locationType: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  warehouseType?: "RAW_MATERIAL" | "FINISHED_GOODS" | "WIP" | "QUARANTINE" | "SCRAP" | null;
}

export interface InventoryTransaction {
  id: number | string;
  txNo: string;
  action: string;
  qty: number;
  txStatus: string;
  materialLotId?: string;
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

export interface StockRow {
  materialCode: string;
  materialName?: string;
  lotNo?: string;
  locationCode?: string;
  availableQty: number;
  reservedQty?: number;
  uom?: string;
  iqcStatus?: string;
}

export interface MaterialTrace {
  id: number; lotNo: string; materialQr?: string; palletQr?: string;
  materialCode: string; materialName?: string; locationCode?: string;
  remainingQty: number; lineSideQty: number; warehouseQty: number; isPartial: boolean;
  usedByWorkOrder: Array<{ workOrderCode: string; usedQty: number }>;
  movements: InventoryTransaction[];
  positions?: Array<{ id:number; positionType:string; areaCode?:string; locationCode?:string; x?:number; z?:number; workOrderCode?:string; movementType:string; operator:string; occurredAt:string }>;
  quality?: { iqcStatus?: string; inspections: unknown[]; pdaInspections: unknown[]; specialApprovals: unknown[]; documents: unknown[] };
}

export interface FifoLotRecommendation {
  id: number;
  lotNo: string;
  availableQty: number;
  receivedAt?: string | null;
  effectiveExpiryAt?: string | null;
  locationCode?: string | null;
}

export interface WmsLoadingStats {
  totalWos: number;
  completedWos: number;
  activeWos: number;
  shelfOccupancyPct: number;
  shelfCounts: { shelf_code: string; cnt: number }[];
  lastPlacement: { wo_code: string; shelf_code: string; operator_name: string; created_at: string } | null;
}

export interface WmsLoadingActiveItem {
  wo_code: string; product_code: string; product_name_zh: string; shelf_code: string;
  cells: { cell_number: number; material_code: string; lot_no: string; label_id: string }[];
  operator_name: string; placed_at: string;
}

export interface WmsLoadingHistoryItem {
  id: number; wo_code: string; shelf_code: string; cell_number: number; material_code: string;
  lot_no: string; qty: number; operator_name: string; created_at: string;
}

export interface WmsDashboardSummary {
  workOrders: { status: string; cnt: number }[];
  lines: { status: string; cnt: number }[];
  materialLots: { iqc_status: string; cnt: number }[];
  inspections: { result: string; cnt: number }[];
}

export interface IqcPlanCharacteristic {
  id: number;
  sequenceNo: number;
  characteristicCode: string;
  name_zh: string;
  name_en?: string;
  name_vi?: string;
  dataType: string;
  unit?: string;
  lowerLimit?: number | null;
  upperLimit?: number | null;
  required: boolean;
}

export interface IqcPlanForLot {
  id: number;
  planCode: string;
  revision: string;
  samplingStandard?: string;
  aqlLevel?: string;
  characteristics: IqcPlanCharacteristic[];
}

export interface IqcPlan extends IqcPlanForLot {
  status: string;
  materialId?: number;
  materialCode?: string;
  categoryId?: number;
  categoryCode?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  approvedBy?: number | null;
  approvedAt?: string | null;
}

const _listEnvelope = <T>() => apiClient.get<ListEnvelope<T>>;


export interface MaterialLoadingRecord {
  id:number; work_order_no:string; station_code:string; feeder_no:string; slot_no:string;
  material_lot_no:string; material_code:string; material_name:string; qty_loaded:number;
  operator_id:string; line_leader_id:string; loading_status:string;
  released_at:string; msd_verified:boolean; iqc_verified:boolean; expiry_verified:boolean;
  msd_level:string; baking_required:boolean; baking_passed:boolean; baking_record_id:number;
  quality_gate_passed:boolean; gate_failed_items:string[]|null;
  created_at:string;
}
export interface FeederChange {
  id:number; work_order_no:string; station_code:string; feeder_no:string; slot_no:string;
  old_lot_no:string; new_lot_no:string; old_material_code:string; new_material_code:string;
  change_reason:string; change_type:string; operator_id:string; created_at:string;
}
export interface LineStop {
  id:number; work_order_no:string; station_code:string; stop_reason:string;
  stop_reason_code:string; start_time:string; end_time:string; duration_minutes:number;
  operator_id:string; resolution:string; production_loss:number; created_at:string;
}
export interface SnMaterialLotRecord {
  id:number; sn_no:string; material_lot_no:string; material_code:string; material_name:string;
  work_order_no:string; station_code:string; loaded_at:string; operator_id:string; qty_per_unit:number;
}
export interface FinishedGood {
  id:number; sn_no:string; work_order_no:string; material_code:string; material_name:string;
  batch_code:string; production_date:string; qty:number; location_code:string; warehouse_zone:string;
  iqc_status:string; oqc_inspector:string; oqc_inspected_at:string; stored_at:string;
  stored_by:string; status:string; customer_code:string; customer_order_no:string;
}
export interface OutboundOrder {
  id:number; outbound_no:string; customer_code:string; customer_name:string;
  customer_order_no:string; outbound_type:string; planned_date:string; actual_date:string;
  status:string; total_qty:number; operator_id:string; logistics_no:string;
  packing_operator:string; packing_time:string; shipping_method:string; destination:string;
}
export interface OutboundItem {
  id:number; outbound_id:number; sn_no:string; material_code:string; batch_code:string;
  qty:number; pick_status:string; picked_at:string; picked_by:string;
  verified_at:string; verified_by:string; packed_at:string;
}

export const wmsApi: any = {
  getSupplierPreReceipt(qr: string) {
    return apiClient.get<{
      preReceiptQr: string; supplierCode: string; supplierName?: string; poNo?: string;
      materialCode: string; materialName?: string; lotNo: string; qty: number; uom?: string;
      palletQr?: string; outerBoxQrs?: string[]; manufacturerQc?: Record<string, unknown>;
      manufacturingDate?: string; expiryDate?: string; status: string;
    }>(`/wms/supplier-pre-receipts/${encodeURIComponent(qr)}`);
  },
  authorizeMissingPreReceipt(payload: { scannedQr: string; authorizedBy: string; authorizationRole: string; reason: string }) {
    return apiClient.post<{ exceptionId: number; status: string }>("/wms/supplier-pre-receipt-exceptions", payload);
  },
  receiveSupplierPreReceipt(qr: string, receivedBy: string) {
    return apiClient.post<{ preReceiptQr: string; status: string }>(
      `/wms/supplier-pre-receipts/${encodeURIComponent(qr)}/receive`, { receivedBy });
  },
  async resolveQrFamily(identity: string) {
    const response = await fetch(`${API_BASE}/api/mes/lineage/${encodeURIComponent(identity)}`, {
      headers: authStorage.getToken() ? { Authorization: `Bearer ${authStorage.getToken()}` } : {},
    });
    if (!response.ok) throw new Error(`QR family lookup HTTP ${response.status}`);
    return response.json() as Promise<{
      identity: string;
      rootSn: string;
      family?: {
        scannedQr: string;
        motherQr: string;
        containerId?: string | null;
        pallet?: { palletCode: string; workOrderCode?: string } | null;
        siblingProducts?: Array<{ sn: string; slotPosition: number }>;
        siblingCartons?: Array<{ containerId: string }>;
      };
    }>;
  },
  getClosureDashboard() {
    return apiClient.get<WmsClosureDashboardData>("/wms/closure/dashboard");
  },
  decideClosureCase(id:number,payload:{decision:"APPROVE"|"REJECT";approvalRole:string;actorBadge:string;comment:string}) {
    return apiClient.post<MutateEnvelope<{id:number;status:string}>>(`/wms/closure/cases/${id}/decision`,payload);
  },
  createClosureHandover(payload:{caseId:number;entityType:string;entityKey:string;quantity:number;fromDomain:string;toDomain:string;senderBadge:string;dueMinutes:number}) {
    return apiClient.post<MutateEnvelope<{id:number;status:string}>>("/wms/closure/handovers",payload);
  },
  receiveClosureHandover(id:number,receiverBadge:string) {
    return apiClient.post<MutateEnvelope<{id:number;status:string;caseStatus:string}>>(`/wms/closure/handovers/${id}/receive`,{receiverBadge});
  },

  /** GET /wms/material-lots — PostgreSQL is authoritative; never substitute demo stock. */
  getMaterialLots(params?: { lotNo?: string; labelId?: string; iqcStatus?: string; q?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.lotNo) qs.set("lotNo", params.lotNo);
    if (params?.labelId) qs.set("labelId", params.labelId);
    if (params?.iqcStatus) qs.set("iqcStatus", params.iqcStatus);
    if (params?.q) qs.set("q", params.q);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<MaterialLot>>(`/wms/material-lots${query ? `?${query}` : ""}`);
  },

  /** GET /wms/storage-locations */
  getStorageLocations(params?: { status?: string; q?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.q) qs.set("q", params.q);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<StorageLocation>>(`/wms/storage-locations${query ? `?${query}` : ""}`);
  },


  /** GET /wms/inventory-transactions — immutable WMS ledger only. */
  getTransactions(params?: { action?: string; workOrderCode?: string; fromDate?: string; toDate?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.action) qs.set("action", params.action);
    if (params?.workOrderCode) qs.set("workOrderCode", params.workOrderCode);
    if (params?.fromDate) qs.set("fromDate", params.fromDate);
    if (params?.toDate) qs.set("toDate", params.toDate);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<InventoryTransaction>>(`/wms/inventory-transactions${query ? `?${query}` : ""}`);
  },

  /** GET /wms/lot-transactions/:lotId — full history for a specific lot */
  getLotTransactions(lotId: number | string) {
    return apiClient.get<ListEnvelope<InventoryTransaction>>(`/wms/lot-transactions/${lotId}`);
  },

  /** POST /wms/transactions */
  postTransaction(action: string, payload: { materialLotId?: number | string; lotNo?: string; qty?: number; operator?: number | string; workOrderCode?: string; fromLocation?: string; toLocation?: string; reason?: string }) {
    return apiClient.post<MutateEnvelope<{ id: number; action: string }>>("/wms/transactions", { action, payload: { ...payload, action } });
  },
  getLotRecommendations(workOrderCode: string, materialCode: string) {
    return apiClient.get<{ policy: string; items: FifoLotRecommendation[] }>(`/wms/work-orders/${encodeURIComponent(workOrderCode)}/lot-recommendations/${encodeURIComponent(materialCode)}`);
  },
  reserveMaterial(payload: { lotNo: string; workOrderCode: string; qty: number; operator?: string }) {
    return apiClient.post<MutateEnvelope<{ id: number; lotNo: string; workOrderCode: string; qty: number }>>("/wms/reservations", { payload });
  },
  /** Resolve a scanned physical roll QR/SN before MES/PDA loading. */
  resolveMaterialRoll(qr: string) {
    return apiClient.get(`/wms/material-rolls/resolve?qr=${encodeURIComponent(qr)}`);
  },

  getMaterialTrace(qr: string) {
    return apiClient.get<{ data: MaterialTrace }>(`/wms/material-trace?qr=${encodeURIComponent(qr)}`);
  },

  registerFloorPosition(materialLotId: number|string, payload: { areaCode:string; x:number; z:number; workOrderCode?:string; movementType?:string; permitNo?:string; clearBy?:string; operator:string }) {
    return apiClient.post(`/wms/material-lots/${materialLotId}/floor-position`, payload);
  },

  resolveFloorStorageArea(qr: string) {
    return apiClient.get<{data:{areaCode:string;areaQr:string;areaName:string;areaType:string;polygon:number[][];capacity:number;occupied:number;status:string}}>(`/wms/floor-storage-areas/resolve?qr=${encodeURIComponent(qr)}`);
  },

  /** POST /wms/put-away — move a released lot from IQC area to permanent storage */
  putAway(payload: { lotNo: string; toLocation: string; qty: number; operator?: string }) {
    return apiClient.post<MutateEnvelope<{ id: number; txNo: string }>>("/wms/put-away", payload);
  },

  /** POST /wms/return-from-line */
  returnFromLine(payload: { lotNo: string; workOrderCode: string; qty: number; operator: string; reason?: string }) {
    return apiClient.post<{ id: number; txNo: string }>("/wms/return-from-line", payload);
  },

  /** POST /wms/scrap */
  supplierReturn(payload: { lotNo: string; materialCode?: string; supplierCode?: string; returnQty: number; reason: string; operator: string }) {
    return apiClient.post("/wms/supplier-returns", { payload: payload });
  },

  scrapMaterial(payload: { lotNo: string; qty: number; reason: string; operator: string }) {
    return apiClient.post<{ id: number; txNo: string }>("/wms/scrap", payload);
  },

  /** GET /dashboard/summary */
  getDashboardSummary() {
    return apiClient.get<WmsDashboardSummary>("/dashboard/summary");
  },

  /** GET /wms/pick-orders?workOrderCode= — get pick lines for a work order */
  getPickOrders(workOrderCode: string) {
    return apiClient.get<ListEnvelope<PickOrder>>(`/wms/pick-orders?workOrderCode=${encodeURIComponent(workOrderCode)}`);
  },

  /** @deprecated Use getPickOrders() instead */
  getPickOrdersByWorkOrder(workOrderCode: string) {
    return this.getPickOrders(workOrderCode);
  },

  // ── PDA Inspection Records ───────────────────────────────────────────────────

  /** GET /wms/pda-inspection-records */
  getPdaInspectionRecords(params?: {
    recordType?: "RECEIVING" | "IQC";
    lotNo?: string;
    supplierCode?: string;
    decision?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.recordType) qs.set("recordType", params.recordType);
    if (params?.lotNo) qs.set("lotNo", params.lotNo);
    if (params?.supplierCode) qs.set("supplierCode", params.supplierCode);
    if (params?.decision) qs.set("decision", params.decision);
    if (params?.fromDate) qs.set("fromDate", params.fromDate);
    if (params?.toDate) qs.set("toDate", params.toDate);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient
      .get<ListEnvelope<PdaInspectionRecord>>(`/wms/pda-inspection-records${query ? `?${query}` : ""}`)
      .catch(() => ({ items: [], total: 0 }));
  },

  /** POST /wms/pda-inspection-records */
  createPdaInspectionRecord(record: PdaInspectionRecord) {
    return apiClient.post<PdaInspectionRecord>("/wms/pda-inspection-records", record);
  },

  getReceivingDocuments(materialLotId: number | string) {
    return apiClient.get<{ items: Array<Record<string, unknown>>; total: number }>("/wms/material-lots/" + materialLotId + "/receiving-documents");
  },

  registerReceivingDocument(materialLotId: number | string, body: {
    documentType: "QUALITY_CERTIFICATE" | "INSPECTION_REPORT" | "RECEIVING_PHOTO" | "PACKING_PHOTO" | "OTHER";
    documentQr?: string; documentUrl?: string; fileName?: string; checksum?: string;
    capturedBy: string; notes?: string; metadata?: Record<string, unknown>;
  }) {
    return apiClient.post<{ item: Record<string, unknown> }>("/wms/material-lots/" + materialLotId + "/receiving-documents", body);
  },
  registerReceivingQrs(materialLotId: number, body: { materialQr: string; palletQr: string; preReceiptQr?: string; workOrderCode?: string; locationCode?: string; registeredBy: string }) {
    return apiClient.post<{ ok: boolean; materialLotId: number; materialQr: string; palletQr: string }>(`/wms/material-lots/${materialLotId}/qr-registration`, body);
  },

  // ── Lifecycle (物料有效期管控 — Sheets 1-5) ──────────────────────────────

  /** GET /api/lifecycle/summary */
  getLifecycleSummary() {
    return apiClient.get<{
      expired: number; red_l3: number; blue_l2: number;
      yellow_l1: number; normal: number; total: number;
    }>("/api/lifecycle/summary") as unknown as Promise<{
      success: boolean; data: {
        expired: number | string; red_l3: number | string; blue_l2: number | string;
        yellow_l1: number | string; normal: number | string; total: number | string;
      };
    }>;
  },

  /** GET /api/lifecycle/lots */
  getLifecycleLots(params?: {
    alert?: string; materialType?: string; supplier?: string;
    lotNo?: string; limit?: number; offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.alert) qs.set("alert", params.alert);
    if (params?.materialType) qs.set("materialType", params.materialType);
    if (params?.supplier) qs.set("supplier", params.supplier);
    if (params?.lotNo) qs.set("lotNo", params.lotNo);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    // apiClient.get<T> returns json.data as T, so pass LifecycleLot[] and access .data on result
    return apiClient.get<LifecycleLot[]>(`/api/lifecycle/lots${query ? `?${query}` : ""}`);
  },


  /** GET /api/lifecycle/alerts-with-actions — Sheet2 data */
  getLifecycleAlertsWithActions(params?: { status?: string }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    const query = qs.toString();
    return apiClient.get<LifecycleAlertAction[]>(
      `/api/lifecycle/alerts-with-actions${query ? `?${query}` : ""}`,
    );
  },

  /** PATCH /api/lifecycle/alert-status/:lotId — update 处理状态 */
  patchLifecycleAlertStatus(lotId: number | string, body: {
    processing_status?: string; action_plan?: string; responsible?: string; plan_date?: string;
  }): Promise<{ success: boolean }> {
    return apiClient.patch<{ success: boolean }>(`/api/lifecycle/alert-status/${lotId}`, body);
  },

  /** GET /api/lifecycle/openings — Sheet4 data */
  getLifecycleOpenings(params?: { limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<LifecycleOpening[]>(
      `/api/lifecycle/openings${query ? `?${query}` : ""}`,
    );
  },

  /** POST /api/lifecycle/openings — record package opening */
  postLifecycleOpening(body: {
    material_lot_id: number | string;
    opened_at: string;
    opened_shelf_life_days: number;
    opened_qty?: number;
    department?: string;
    operator?: string;
  }): Promise<{ success: boolean; data?: LifecycleOpening }> {
    return apiClient.post<{ success: boolean; data?: LifecycleOpening }>("/api/lifecycle/openings", body);
  },
  sealLifecycleOpening(openingId: number | string, operator?: string) {
    return apiClient.post<{ data: { id: number; material_lot_id: number; opened_at: string; closed_at: string; closed_by: string } }>(`/api/lifecycle/openings/${openingId}/seal`, { operator });
  },

  /** GET /api/lifecycle/reinspection — Sheet3 data */
  getLifecycleReinspection(params?: {
    pass?: boolean; lot_id?: number | string; limit?: number; offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.pass !== undefined) qs.set("pass", String(params.pass));
    if (params?.lot_id) qs.set("lot_id", String(params.lot_id));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<LifecycleReinspection[]>(
      `/api/lifecycle/reinspection${query ? `?${query}` : ""}`,
    );
  },

  /** POST /api/lifecycle/reinspection */
  postLifecycleReinspection(body: {
    material_lot_id: number | string;
    inspected_at: string;
    overdue_days?: number;
    sample_qty?: number;
    test_items: string;
    test_standards?: string;
    test_results?: string;
    pass: boolean;
    disposal_advice?: string;
    inspector_id?: number | string;
    quality_approved_by?: number | string;
    equipment_approved_by?: number | string;
    remarks?: string;
  }): Promise<{ success: boolean; data?: LifecycleReinspection }> {
    return apiClient.post<{ success: boolean; data?: LifecycleReinspection }>("/api/lifecycle/reinspection", body);
  },

  /** GET /api/lifecycle/scrapping — Sheet5 data */
  getLifecycleScrapping(params?: { status?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<LifecycleScrapping[]>(
      `/api/lifecycle/scrapping${query ? `?${query}` : ""}`,
    );
  },

  /** POST /api/lifecycle/scrapping */
  postLifecycleScrapping(body: {
    material_lot_id: number | string;
    department?: string;
    scrap_qty: number;
    unit?: string;
    overdue_days?: number;
    scrap_reason: string;
    isolation_status?: string;
    disposal_method: string;
    applicant_id?: number | string;
  }): Promise<{ success: boolean; data?: LifecycleScrapping }> {
    return apiClient.post<{ success: boolean; data?: LifecycleScrapping }>("/api/lifecycle/scrapping", body);
  },

  /** PATCH /api/lifecycle/scrapping/:id — approve/reject */
  patchLifecycleScrapping(id: number | string, body: {
    status?: string; warehouse_approved_by?: number | string; quality_approved_by?: number | string;
  }): Promise<{ success: boolean }> {
    return apiClient.patch<{ success: boolean }>(`/api/lifecycle/scrapping/${id}`, body);
  },

  // ⑥ 免检物料管理

  /** GET /api/lifecycle/exempt-materials — v_exempt_iqc_materials */
  getExemptMaterials() {
    return apiClient.get<ExemptMaterial[]>(`/api/lifecycle/exempt-materials`);
  },

  /** GET /api/lifecycle/exempt-lots — v_material_lots_exempt */
  getExemptLots() {
    return apiClient.get<ExemptLot[]>(`/api/lifecycle/exempt-lots`);
  },

  /** PATCH /api/materials/:id/iqc-required — toggle iqc_required on a material */
  patchMaterialIqcRequired(id: number, iqcRequired: boolean): Promise<{ success: boolean }> {
    return apiClient.patch<{ success: boolean }>(`/api/materials/${id}/iqc-required`, { iqc_required: iqcRequired });
  },

  /** GET /api/lifecycle/destruction-records — v_material_destruction_records */
  getDestructionRecords() {
    return apiClient.get<DestructionRecord[]>(`/api/lifecycle/destruction-records`);
  },

  /** PATCH /api/lifecycle/scrapping/:id/destruction — fill destruction execution fields */
  patchDestructionRecord(id: number, body: {
    destroyed_qty?: number;
    destruction_at?: string;
    destruction_supervisor_id?: number;
    destruction_doc_url?: string;
  }): Promise<{ success: boolean }> {
    return apiClient.patch<{ success: boolean }>(`/api/lifecycle/scrapping/${id}/destruction`, body);
  },

  getReceivingQueue(status?: "pending" | "released" | "iqc") {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    const query = qs.toString();
    return apiClient.get<ListEnvelope<ReceivingLot>>(`/wms/receiving-queue${query ? `?${query}` : ""}`);
  },

  postReceive(body: {
    lot_no: string;
    po_no?: string;
    inbound_order_no?: string;
    material_code: string;
    supplier_code?: string;
    received_qty: number;
    received_at: string;
    receiving_notes?: string;
    ancillary_items?: {
      item_type: string;
      item_desc?: string;
      qty?: number;
      deposit_required?: boolean;
      deposit_amount?: number;
      deposit_currency?: string;
    }[];
  }) {
    return apiClient.post<any>('/api/receiving', body);
  },

  
  // ── MSD 烘烤 Baking ──────────────────────────────────────────────────

  /** GET /api/lifecycle/baking — 烘烤记录列表 */
  getBakingRecords(params?: { lotNo?: string; result?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.lotNo)  qs.set("lotNo", params.lotNo);
    if (params?.result) qs.set("result", params.result);
    if (params?.limit)  qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<{ items: BakingRecord[]; total: number }>(
      "/api/lifecycle/baking" + (query ? "?" + query : "")
    );
  },

  /** POST /api/lifecycle/baking — 触发烘烤 */
  startBaking(body: {
    lotNo: string;
    temperature?: number;
    humidity?: number;
    ovenNo?: string;
    operatorName?: string;
    notes?: string;
  }) {
    return apiClient.post<BakingRecord>("/api/lifecycle/baking", body);
  },

  /** PATCH /api/lifecycle/baking/:id — 完成烘烤 */
  completeBaking(id: number, body: {
    result: "pass" | "fail";
    completedAt?: string;
    notes?: string;
  }) {
    return apiClient.patch<BakingRecord>(`/api/lifecycle/baking/${id}`, body);
  },

  /** GET /api/lifecycle/baking/lot/:lotNo — 某批次烘烤历史 */
  getBakingHistoryByLot(lotNo: string) {
    return apiClient.get<BakingRecord[]>(`/api/lifecycle/baking/lot/${encodeURIComponent(lotNo)}`);
  },

// ── PDA 上料看板 Loading Dashboard ──
  getLoadingStats() {
    return apiClient.get<WmsLoadingStats>("/api/wms/loading/stats");
  },

  getWorkOrderMaterialReconciliation(workOrderCode: string) {
    return apiClient.get<{ workOrderCode: string; balanced: boolean; items: Array<Record<string, unknown>> }>(`/wms/work-orders/${encodeURIComponent(workOrderCode)}/material-reconciliation`);
  },

  getWorkOrderMaterialShortages(workOrderCode: string) {
    return apiClient.get<{ workOrderCode: string; hasShortage: boolean; unacknowledgedIssueCount: number; items: Array<Record<string, unknown>> }>(`/wms/work-orders/${encodeURIComponent(workOrderCode)}/material-shortages`);
  },

  createReplenishmentRequest(body: { workOrderCode: string; originalRequisitionId: number; materialCode: string; qty: number; reasonCode: string; requestor?: string; notes?: string }) {
    return apiClient.post<MutateEnvelope<{ id: number; doc_no: string; status: string }>>("/wms/replenishment-requests", body);
  },

  getIqcPlanForLot(lotId: number | string) {
    return apiClient.get<IqcPlanForLot>(`/wms/iqc/plan-for-lot/${lotId}`);
  },

  getIqcPlans() {
    return apiClient.get<ListEnvelope<IqcPlan>>("/wms/iqc/plans");
  },

  decideIqcPlan(id: number, decision: "APPROVE" | "REJECT") {
    return apiClient.post<MutateEnvelope<{ id: number; status: string }>>(`/wms/iqc/plans/${id}/decision`, { decision });
  },

  submitIqcInspection(payload: {
    materialLotId: number | string;
    planId: number;
    decision: "PASS" | "FAIL" | "HOLD";
    sampleSize: number;
    operator: string;
    results: Array<{ characteristicId: number; result: "PASS" | "FAIL" | "NA"; measuredValue?: string; numericValue?: number; note?: string }>;
  }) {
    return apiClient.post<MutateEnvelope<{ id: number; inspectionNo: string; lotNo: string; status: string }>>("/wms/iqc/inspections", payload);
  },

  getLoadingActive() {
    return apiClient.get<ListEnvelope<WmsLoadingActiveItem>>("/api/wms/loading/active");
  },

  getLoadingHistory(params?: { wo_code?: string; shelf_code?: string; page?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.wo_code) qs.set("wo_code", params.wo_code);
    if (params?.shelf_code) qs.set("shelf_code", params.shelf_code);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<WmsLoadingHistoryItem>>(`/api/wms/loading/history${query ? `?${query}` : ""}`);
  },

};

// ── Shared lifecycle types (mirrors server.js SQL column aliases) ─────────────

export interface LifecycleLot {
  id: number;
  lotNo: string;
  materialCode: string;
  materialNameZh: string;
  materialNameEn?: string;
  materialNameVi?: string;
  materialType: string;
  uom: string;
  manufacturingDate: string | null;
  receivedAt: string;
  shelfLifeMonths: number;
  expiryDate: string | null;
  iqcStatus: string;
  qty: number;
  reservedQty: number;
  locationCode: string | null;
  supplierName: string | null;
  remainingDays: number | null;
  alertLevel: "EXPIRED" | "RED_L3" | "BLUE_L2" | "YELLOW_L1" | "NORMAL" | null;
  statusLabel: string | null;
}
export interface LifecycleAlertAction {
  id: number;
  lotNo: string;
  materialCode: string;
  materialNameZh: string;
  materialNameEn?: string;
  materialNameVi?: string;
  uom: string;
  materialType: string;
  expiryDate: string;
  remainingDays: number | null;
  qty: number;
  supplierName: string | null;
  alertLevel: string;
  processingStatus: string;
  action_plan: string | null;
  responsible: string | null;
  plan_date: string | null;
}

export interface LifecycleOpening {
  id: number;
  lotNo: string;
  materialCode: string;
  materialNameZh: string;
  materialNameEn?: string;
  uom: string;
  openedAt: string;
  openedShelfLifeDays: number;
  expiryDate: string;
  openedQty: number | null;
  originalQty: number;
  remainingQty: number;
  department: string | null;
  operator: string | null;
  status: string;
}


export interface BakingRecord {
  id: number;
  lot_no: string;
  material_code: string;
  name_zh: string;
  lot_id: number;
  received_qty: number;
  operator_name: string | null;
  started_at: string;
  completed_at: string | null;
  temperature: number | null;
  humidity: number | null;
  oven_no: string | null;
  result: "pass" | "fail" | "pending" | null;
  notes: string | null;
}

export interface LifecycleReinspection {
  id: number;
  reportNo: string;
  lotNo: string;
  materialCode: string;
  materialNameZh: string;
  materialNameEn?: string;
  uom: string;
  inspectedAt: string;
  overdueDays: number;
  sampleQty: number;
  testItems: string;
  testStandards: string;
  testResults: string;
  pass: boolean;
  disposalAdvice: string;
  remarks: string | null;
  inspectorName: string | null;
  qualityApprover: string | null;
  equipmentApprover: string | null;
  createdAt: string;
}

export interface ExemptMaterial {
  id: number;
  code: string;
  nameZh: string;
  nameEn?: string;
  nameVi?: string;
  shelfLifeDays: number | null;
}

export interface ExemptLot {
  id: number;
  lotNo: string;
  materialCode: string;
  materialNameZh: string;
  supplierCode: string | null;
  locationCode: string | null;
  poDate: string | null;
  expiryDate: string | null;
  receivedQty: number;
  iqcStatus: string;
  alertLevel: string;
}

export interface DestructionRecord {
  id: number;
  requestNo: string;
  lotNo: string;
  materialCode: string;
  materialNameZh: string;
  scrapQty: number;
  destroyedQty: number | null;
  destructionAt: string | null;
  destructionSupervisor: string | null;
  destructionSupervisorId: number | null;
  destructionDocUrl: string | null;
  scrapReason: string;
  disposalMethod: string;
  isolationStatus: string;
  status: string;
  applicantName: string | null;
  warehouseApprover: string | null;
  qualityApprover: string | null;
  createdAt: string;
}

export interface LifecycleScrapping {
  id: number;
  requestNo: string;
  lotNo: string;
  materialCode: string;
  materialNameZh: string;
  materialNameEn?: string;
  uom: string;
  scrapQty: number;
  overdueDays: number | null;
  scrapReason: string;
  isolationStatus: string;
  disposalMethod: string;
  status: string;
  applicantName: string | null;
  warehouseApprover: string | null;
  qualityApprover: string | null;
  createdAt: string;
}

// ── Receiving types ────────────────────────────────────────────────────────────
export interface ReceivingLot {
  id: number; lot_no: string; po_no: string; material_code: string;
  material_name_zh: string; supplier_code: string; supplier_name_zh: string;
  location_code: string; received_qty: number; received_at: string;
  receiver_name: string; receiving_photo_url: string | null;
  receiving_notes: string | null; iqc_status: string; has_open_issues: boolean;
}
export interface AncillaryItem {
  item_type: string; item_desc: string; qty: number;
  deposit_required: boolean; deposit_amount: number; deposit_currency: string; returned: boolean;
}
export interface ReceivingIssue {
  id: number; issue_type: string; issue_desc: string;
  resolved: boolean; reported_at: string;
}

// ── PDA Inspection Records ───────────────────────────────────────────────────────
export interface PdaInspectionRecord {
  id?: number;
  record_type: "RECEIVING" | "IQC";
  lot_no: string;
  // POST-only fields (not from GET response)
  materialLotId?: number;
  result?: "PASS" | "FAIL" | "HOLD";
  rejectReason?: string;
  operator?: string;
  operatorId?: number;
  msdSealOk?: boolean;
  msdDesiccantOk?: boolean;
  msdHumidityOk?: boolean;
  photoUrl?: string;
  material_code?: string;
  material_name_zh?: string;
  supplier_code?: string;
  supplier_name_zh?: string;
  received_qty?: number;
  po_no?: string;
  date_code?: string;
  msd_level?: string;
  msd_bag_intact?: boolean;
  msd_bag_sealed?: boolean;
  msd_exposure_noted?: boolean;
  receiving_photo_url?: string;
  receiving_notes?: string;
  notes?: string;
  location_code?: string;
  sample_size?: number;
  defect_count?: number;
  defect_type?: string;
  defect_severity?: string;
  defect_rate?: number;
  defect_photo_url?: string;
  inspection_notes?: string;
  decision?: string;
  decision_by?: "AUTO" | "OPERATOR";
  ornith_confidence?: number;
  operator_name?: string;
  device_info?: string;
  recorded_at?: string;
  created_at?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// DOCUMENT MANAGEMENT (入库单/出库单/领料单/退库单/补料单)
// ═══════════════════════════════════════════════════════════════════════

export type DocStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "EXECUTING" | "COMPLETED" | "REJECTED" | "CANCELLED";

export interface DocLine {
  id?: number;
  material_id?: number;
  material_code?: string;
  material_name_zh?: string;
  unit?: string;
  requested_qty?: number;
  approved_qqty?: number;
  executed_qty?: number;
  lot_no?: string;
  location_code?: string;
  location_name?: string;
  line_status?: string;
  remarks?: string;
}

export interface DocListItem {
  id: number;
  doc_no: string;
  status: DocStatus;
  created_at: string;
  created_by: number;
  [key: string]: unknown;
}

function docList<T extends DocListItem>(prefix: string, params?: { status?: string; page?: number; pageSize?: number }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.page != null) qs.set("page", String(params.page));
  if (params?.pageSize != null) qs.set("pageSize", String(params.pageSize));
  const query = qs.toString();
  return apiClient.get<{ items: T[]; total: number }>(`/wms/${prefix}?${query}`);
}

function docGet<T>(prefix: string, id: number) {
  return apiClient.get<T>(`/wms/${prefix}/${id}`);
}

function docCreate<T>(prefix: string, body: Record<string, unknown>) {
  return apiClient.post<T>(`/wms/${prefix}`, body);
}

function docUpdate<T>(prefix: string, id: number, body: Record<string, unknown>) {
  return apiClient.patch<T>(`/wms/${prefix}/${id}`, body);
}

function docDelete(prefix: string, id: number) {
  return apiClient.delete(`/wms/${prefix}/${id}`);
}

function docAction<T>(prefix: string, verb: string, id: number, body?: Record<string, unknown>) {
  return apiClient.post<T>(`/wms/${prefix}/${verb}/${id}`, body ?? {});
}

export const docApi = {
  inbound: {
    list: (p?: { status?: string; page?: number; pageSize?: number }) =>
      docList<DocListItem & { supplier_code?: string; supplier_name?: string }>("inbound", p),
    get: (id: number) =>
      docGet<DocListItem & { lines: DocLine[] }>("inbound", id),
    create: (body: Record<string, unknown>) => docCreate("inbound", body),
    update: (id: number, body: Record<string, unknown>) => docUpdate("inbound", id, body),
    delete: (id: number) => docDelete("inbound", id),
    submit:   (id: number) => docAction("inbound", "submit",   id),
    approve:  (id: number) => docAction("inbound", "approve",  id),
    reject:   (id: number, reason?: string) => docAction("inbound", "reject", id, { reason }),
    execute:  (id: number) => docAction("inbound", "execute",  id),
    complete: (id: number) => docAction("inbound", "complete", id),
    cancel:   (id: number) => docAction("inbound", "cancel",   id),
  },
  outbound: {
    list: (p?: { status?: string; page?: number; pageSize?: number }) =>
      docList<DocListItem & { work_order_code?: string; requestor_name?: string }>("outbound", p),
    get:    (id: number) => docGet<DocListItem & { lines: DocLine[] }>("outbound", id),
    create: (body: Record<string, unknown>) => docCreate("outbound", body),
    update: (id: number, body: Record<string, unknown>) => docUpdate("outbound", id, body),
    delete: (id: number) => docDelete("outbound", id),
    submit:   (id: number) => docAction("outbound", "submit",   id),
    approve:  (id: number) => docAction("outbound", "approve",  id),
    reject:   (id: number, reason?: string) => docAction("outbound", "reject", id, { reason }),
    execute:  (id: number) => docAction("outbound", "execute",  id),
    complete: (id: number) => docAction("outbound", "complete", id),
    cancel:   (id: number) => docAction("outbound", "cancel",   id),
  },
  requisition: {
    list: (p?: { status?: string; page?: number; pageSize?: number }) =>
      docList<DocListItem & { work_order_code?: string; requestor_name?: string }>("requisition", p),
    get:    (id: number) => docGet<DocListItem & { lines: DocLine[] }>("requisition", id),
    create: (body: Record<string, unknown>) => docCreate("requisition", body),
    update: (id: number, body: Record<string, unknown>) => docUpdate("requisition", id, body),
    delete: (id: number) => docDelete("requisition", id),
    submit:   (id: number) => docAction("requisition", "submit",   id),
    approve:  (id: number) => docAction("requisition", "approve",  id),
    reject:   (id: number, reason?: string) => docAction("requisition", "reject", id, { reason }),
    execute:  (id: number) => docAction("requisition", "execute",  id),
    complete: (id: number) => docAction("requisition", "complete", id),
    cancel:   (id: number) => docAction("requisition", "cancel",   id),
  },
  return: {
    list: (p?: { status?: string; page?: number; pageSize?: number }) =>
      docList<DocListItem & { work_order_code?: string; requestor_name?: string }>("return", p),
    get:    (id: number) => docGet<DocListItem & { lines: DocLine[] }>("return", id),
    create: (body: Record<string, unknown>) => docCreate("return", body),
    update: (id: number, body: Record<string, unknown>) => docUpdate("return", id, body),
    delete: (id: number) => docDelete("return", id),
    submit:   (id: number) => docAction("return", "submit",   id),
    reject:   (id: number, reason?: string) => docAction("return", "reject", id, { reason }),
    execute:  (id: number) => docAction("return", "execute",  id),
    complete: (id: number) => docAction("return", "complete", id),
    cancel:   (id: number) => docAction("return", "cancel",   id),
  },
  replenishment: {
    list: (p?: { status?: string; page?: number; pageSize?: number }) =>
      docList<DocListItem & { work_order_code?: string; requestor_name?: string }>("replenishment", p),
    get:    (id: number) => docGet<DocListItem & { lines: DocLine[] }>("replenishment", id),
    create: (body: Record<string, unknown>) => docCreate("replenishment", body),
    update: (id: number, body: Record<string, unknown>) => docUpdate("replenishment", id, body),
    delete: (id: number) => docDelete("replenishment", id),
    submit:   (id: number) => docAction("replenishment", "submit",   id),
    approve:  (id: number) => docAction("replenishment", "approve",  id),
    reject:   (id: number, reason?: string) => docAction("replenishment", "reject", id, { reason }),
    execute:  (id: number) => docAction("replenishment", "execute",  id),
    complete: (id: number) => docAction("replenishment", "complete", id),
    cancel:   (id: number) => docAction("replenishment", "cancel",   id),
  },

  // ── Incoming 来料原始档案 ──────────────────────────────────────────────
  createIncomingRecord: (data: Record<string,unknown>) =>
    apiClient.post("/api/wms/incoming", data),

  getIncomingRecords: (params?: Record<string,unknown>) =>
    apiClient.get("/api/wms/incoming", params) as Promise<{items:IncomingRecord[];total:number;offset:number;limit:number}>,

  getIncomingRecord: (id: number) =>
    apiClient.get(`/api/wms/incoming/${id}`) as Promise<IncomingRecord>,

  updateIncomingRecord: (id: number, data: Record<string,unknown>) =>
    apiClient.put(`/api/wms/incoming/${id}`, data),

  // ── IQC 来料检验 ──────────────────────────────────────────────────────
  getIqcRules: () => apiClient.get("/api/wms/iqc/rules") as Promise<IqcAqlRule[]>,

  getIqcSamplingPlans: (aql_level?: string) =>
    apiClient.get("/api/wms/iqc/sampling-plans", aql_level ? {aql_level} : undefined) as Promise<IqcSamplingPlan[]>,

  createIqcInspection: (data: Record<string,unknown>) =>
    apiClient.post("/api/wms/iqc/inspections", data),

  getIqcInspections: (params?: Record<string,unknown>) =>
    apiClient.get("/api/wms/iqc/inspections", params) as Promise<{items:IqcInspection[];total:number;offset:number;limit:number}>,

  getIqcInspection: (id: number) =>
    apiClient.get(`/api/wms/iqc/inspections/${id}`) as Promise<IqcInspection>,

  addIqcDefect: (inspectionId: number, data: Record<string,unknown>) =>
    apiClient.post(`/api/wms/iqc/inspections/${inspectionId}/defects`, data),

  completeIqcInspection: (id: number) =>
    apiClient.post(`/api/wms/iqc/inspections/${id}/complete`, {}),

  createSpecialApproval: (data: Record<string,unknown>) =>
    apiClient.post("/api/wms/iqc/special-approvals", data),

  approveSpecialApproval: (id: number, data: Record<string,unknown>) =>
    apiClient.patch(`/api/wms/iqc/special-approvals/${id}`, data),

  getSpecialApprovals: (status?: string) =>
    apiClient.get("/api/wms/iqc/special-approvals", status ? {status} : undefined) as Promise<IqcSpecialApproval[]>,


  // ── Material Loading / PDA上料 ───────────────────────────────────────────
  createMaterialLoading: (data: Record<string,unknown>) =>
    apiClient.post("/api/wms/material-loading", data) as Promise<{id:number;quality_gate_passed:boolean;failed_items:string[];gates:Record<string,boolean>}>,

  getMaterialLoading: (params?: Record<string,unknown>) =>
    apiClient.get("/api/wms/material-loading", params) as Promise<{items:MaterialLoadingRecord[];total:number}>,

  getSmtReelConsumption: (params?: Record<string,unknown>) =>
    apiClient.get("/api/mes/smt/reel-consumption", params) as Promise<{items:Array<Record<string,unknown>>;summary:Record<string,number>}> ,

  getPdaLoadingRecords: (params?: Record<string,unknown>) =>
    apiClient.get("/api/smt/loading/records", params) as Promise<{
      items: Array<{
        id:number; workOrderCode:string; lineCode:string; machineCode:string;
        channelCode:string; slotNo:string; feederCode:string; materialCode:string;
        materialNameZh:string; materialSn:string; lotNo:string; quantity:number;
        consumedQty:number; remainingQty:number; operator:string; status:string;
        qualityVerdict:string; boundAt:string; unboundAt:string; createdAt:string;
        sessionId:number; sessionStatus:string;
      }>;
      total:number;
      summary:{total:number;active:number;today:number;unverified:number;quantity:number;loading:number;released:number};
    }>,

  releaseMaterialLoading: (id: number, line_leader_id: string) =>
    apiClient.patch(`/api/wms/material-loading/${id}/release`, {line_leader_id}) as Promise<{affected:number}>,

  // ── Feeder Changes / 换料记录 ───────────────────────────────────────────
  createFeederChange: (data: Record<string,unknown>) =>
    apiClient.post("/api/wms/feeder-changes", data),

  getFeederChanges: (params?: Record<string,unknown>) =>
    apiClient.get("/api/wms/feeder-changes", params) as Promise<{items:FeederChange[]}>,

  // ── Line Stops / 停线记录 ───────────────────────────────────────────────
  createLineStop: (data: Record<string,unknown>) =>
    apiClient.post("/api/wms/line-stops", data),

  endLineStop: (id: number, data: Record<string,unknown>) =>
    apiClient.patch(`/api/wms/line-stops/${id}/end`, data),

  getLineStops: (params?: Record<string,unknown>) =>
    apiClient.get("/api/wms/line-stops", params) as Promise<{items:LineStop[]}>,

  // ── SN Traceability / SN追溯 ────────────────────────────────────────────
  linkSnMaterialLot: (data: Record<string,unknown>) =>
    apiClient.post("/api/wms/sn-material-lot", data),

  getSnMaterialLots: (sn: string) =>
    apiClient.get(`/api/wms/sn-material-lot/${sn}`) as Promise<SnMaterialLotRecord[]>,

  // ── Finished Goods / 成品 ───────────────────────────────────────────────
  createFinishedGood: (data: Record<string,unknown>) =>
    apiClient.post("/api/wms/finished-goods", data),

  getFinishedGoods: (params?: Record<string,unknown>) =>
    apiClient.get("/api/wms/finished-goods", params) as Promise<{items:FinishedGood[];total:number}>,

  oqcFinishedGood: (id: number, data: Record<string,unknown>) =>
    apiClient.patch(`/api/wms/finished-goods/${id}/oqc`, data),

  // ── Outbound / 出货 ─────────────────────────────────────────────────────
  createOutboundOrder: (data: Record<string,unknown>) =>
    apiClient.post("/api/wms/outbound-orders", data),

  addOutboundItems: (id: number, data: Record<string,unknown>) =>
    apiClient.post(`/api/wms/outbound-orders/${id}/items`, data),

  shipOutboundOrder: (id: number, data: Record<string,unknown>) =>
    apiClient.patch(`/api/wms/outbound-orders/${id}/ship`, data),

  getOutboundOrders: (params?: Record<string,unknown>) =>
    apiClient.get("/api/wms/outbound-orders", params) as Promise<{items:OutboundOrder[]}>,

  getOutboundOrder: (id: number) =>
    apiClient.get(`/api/wms/outbound-orders/${id}`) as Promise<OutboundOrder & {items:OutboundItem[]}>,

};
