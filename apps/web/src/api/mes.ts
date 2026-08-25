import { apiClient, type ListEnvelope } from "./client";

// ── DTOs ───────────────────────────────────────────────────────────

export interface ProductionLine {
  id: number;
  lineCode: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  status: "running" | "changeover" | "down" | "idle";
  stationCount?: number;
  activeRuns?: number;
  currentWorkOrderCode?: string;
}

export interface Station {
  id: number;
  code: string;
  stationType: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  requiredScan: boolean;
  lineCode: string;
  lineNameZh?: string;
  sequenceOrder?: number;
  status?: "running" | "idle" | "down" | "offline" | "ng";
}

export interface StationWithEvents {
  station: Station;
  recentEvents: StationEvent[];
}

export interface LineDetail {
  line: ProductionLine;
  currentRun: MesRun | null;
  recentEvents: StationEvent[];
  stations: Station[];
}

export interface ProcessRoute {
  id: number;
  code: string;
  revision: string;
  status: "draft" | "active" | "superseded";
  productCode: string;
  createdAt: string;
}

export interface ProcessRouteStep {
  stepNo: number;
  stationType: string;
  stationId?: number;
  stationCode?: string;
  requiredScan: boolean;
  requiredInspection: boolean;
  outputRule: "pass_through" | "route_fail_to_repair" | "close_work_order";
}

export interface ProcessRouteDetail extends ProcessRoute {
  productNameZh?: string;
  productNameEn?: string;
  productNameVi?: string;
  steps: ProcessRouteStep[];
}

export interface OeeComponents {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

export interface MesRun {
  id: number;
  workOrderCode: string;
  workOrderType?: 1 | 2 | 3;
  productCode: string;
  lineCode: string;
  lineNameZh?: string;
  status: "draft" | "released" | "running" | "hold" | "closed" | "cancelled" | "voided";
  plannedQty: number;
  completedQty: number;
}

export interface MesRunDetail extends MesRun {
  oeeComponents?: OeeComponents;
  downtimeMinutes?: number;
  eventStats?: { passCount: number; failCount: number };
  openDowntimes?: Downtime[];
}

export interface FeederBinding {
  id: number;
  feederNo: string;
  reelCode: string;
  boundAt: string;
  unboundAt: string | null;
  workOrderCode: string;
  lineCode: string;
  machineCode: string;
  lotNo: string;
  materialCode: string;
  operator: string;
}

export interface PcbSerial {
  id: number;
  serialNo: string;
  workOrderCode: string;
  productCode?: string;
  lineCode?: string;
  status: "wip" | "passed" | "failed" | "scrapped" | "closed";
  createdAt: string;
}

export interface PcbSerialDetail {
  pcb: PcbSerial;
  events: StationEvent[];
}

export interface StationEvent {
  id: number;
  eventType: string;
  result: "PASS" | "FAIL" | "REPAIRING" | "CLOSED" | string;
  occurredAt: string;
  traceKey?: string;
  stationCode?: string;
  stationNameZh?: string;
  stationType?: string;
  machineCode?: string;
  pcbSerial?: string;
  operator?: string;
}

export interface Downtime {
  id: number;
  downtimeNo: string;
  lineCode?: string;
  stationCode?: string;
  reasonCode?: string;
  reasonDetail?: string;
  startAt: string;
  endAt?: string | null;
  status: "open" | "closed" | "voided";
  closedAt?: string | null;
  operator?: string;
}

export interface PcbTrace {
  pcb: PcbSerial & { workOrderId?: number };
  events: StationEvent[];
  materialBindings: FeederBinding[];
}

export interface BomReconciliationGate {
  work_order_id: number;
  work_order_code: string;
  bom_id: number;
  bom_revision: string;
  bom_line_count: number;
  reconciled_line_count: number;
  total_remaining_qty: string;
  product_binding_allowed: boolean;
}

export interface BomReconciliationLine {
  work_order_id: number;
  bom_line_id: number;
  material_id: number;
  material_code: string;
  material_name: string;
  materialNameEn?: string;
  materialNameVi?: string;
  required_qty: string;
  written_off_qty: string;
  remaining_qty: string;
  naming_version_matches: boolean;
  fully_reconciled: boolean;
}

// ── Stagnation Tracking ──────────────────────────────────────────────

export interface StagnationLog {
  id: number;
  sn: string;
  pcbNo?: string;
  stationCode: string;
  lineCode: string;
  stagnationMinutes: number;
  stagnationLevel: "normal" | "warning" | "alert" | "critical";
  status: "open" | "resolved" | "escalated";
  customerCode?: string;
  productModel?: string;
  laserQrDate?: string;
  workOrderCode?: string;
  createdAt: string;
  resolvedAt?: string;
  /** Warehouse / storage location where the stagnant PCB is held */
  whLocation?: string;
  /** Station code where stagnation originated */
  fromStationCode?: string;
  /** Target/next station the PCB was awaiting */
  toStationCode?: string;
  /** Overdue time expressed in months (Excel column H) */
  overdueMonths?: number;
  /** Operator notes */
    notes?: string;
    /** PO number this PCB belongs to */
    poNumber?: string;
  }

export interface StagnationAlert extends StagnationLog {
  warningMinutes?: number;
  alertMinutes?: number;
  criticalMinutes?: number;
}

export interface StagnationThreshold {
  stationCode: string;
  stationType?: string;
  lineCode?: string;
  warningMinutes: number;
  alertMinutes: number;
  criticalMinutes: number;
  status: string;
}

// ── Scrap Management ─────────────────────────────────────────────────

export interface ScrapRecord {
  id: number;
  sn: string;
  pcbNo?: string;
  productModel?: string;
  scrapStation: string;
  lineCode: string;
  scrapReasonCode: string;
  scrapReasonName?: string;
  scrapReasonDetail?: string;
  responsiblePerson?: string;
  quantity: number;
  status: "pending" | "approved" | "rejected";
  poNumber?: string;
  workOrderCode?: string;
  createdAt: string;
  approvedAt?: string;
  laserQrDate?: string;
  notes?: string;
}

export interface ScrapReasonCode {
  code: string;
  name_zh: string;
  name_en?: string;
  name_vi?: string;
  category: string;
  requireResponsible: boolean;
  requireDetail: boolean;
}

// ── Fool-Proof Rules ──────────────────────────────────────────────────────

export interface FoolProofRule {
  id: number;
  stationCode: string;
  stationName: string;
  lineCode: string;
  lineName: string;
  feederSlot: string;
  materialCode: string;
  materialName: string;
  materialReelCode?: string;
  ruleType: "material" | "reel" | "both";
  status: "active" | "disabled";
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialFeederAssignment {
  id: number; lineCode: string; machineCode: string; channelCode: string; slotNo: string;
  feederCode: string; materialCode: string; workOrderCode?: string; status: string;
}

// ── First Article Inspection ───────────────────────────────────────────────

export interface FirstArticleCheckItem {
  id: number;
  inspectionId: number;
  checkType: "bom_match" | "position" | "direction" | "quantity" | "visual";
  materialCode?: string;
  expectedValue?: string;
  actualValue?: string;
  result: "PASS" | "FAIL";
  notes?: string;
}

export interface FirstArticleInspection {
  id: number;
  workOrderCode?: string;
  stationCode: string;
  stationName: string;
  lineCode?: string;
  result: "PASS" | "FAIL";
  checkedBy?: string;
  checkedAt: string;
  lotNo?: string;
  remarks?: string;
  createdAt: string;
}

// ── Material Verification ──────────────────────────────────────────────────

export interface MaterialVerification {
  id: number;
  workOrderCode?: string;
  stationCode: string;
  stationName: string;
  lineCode?: string;
  feederSlot?: string;
  materialCode?: string;
  expectedReel?: string;
  actualReel?: string;
  matchResult: "PASS" | "FAIL";
  verifiedBy?: string;
  verifiedAt: string;
  createdAt: string;
}

// ── Station Flow Records ─────────────────────────────────────────────

export interface StationFlowRecord {
  id: number;
  sn: string;
  pcbNo?: string;
  stationCode: string;
  stationType?: string;
  lineCode: string;
  eventType: "arrival" | "departure" | "inspection" | "hold";
  arrivalTime: string;
  departureTime?: string;
  dwellMinutes?: number;
  isStagnation: boolean;
  stagnationLevel?: "normal" | "warning" | "alert" | "critical";
  result?: string;
  operatorName?: string;
  machineCode?: string;
  nextStationCode?: string;
  productModel?: string;
  poNumber?: string;
  qualityCheckResult?: string;
  workOrderCode?: string;
  laserQrDate?: string;
  notes?: string;
}

// ── Full Traceability ───────────────────────────────────────────────

export interface FullTrace {
  pcb: PcbSerial & { workOrderId?: number };
  flow: StationFlowRecord[];
  stagnation: StagnationLog[];
  scraps: ScrapRecord[];
}

// ── Helpers ────────────────────────────────────────────────────────

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// ── API client ─────────────────────────────────────────────────────

export const mesApi = {
  // ── Lines ──────────────────────────────────────────────────────
  /** GET /mes/lines */
  getLines(params?: { status?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<ProductionLine>>(`/mes/lines${qs(params ?? {})}`);
  },
  /** GET /mes/lines/{lineCode} */
  getLine(lineCode: string) {
    return apiClient.get<LineDetail>(`/mes/lines/${encodeURIComponent(lineCode)}`);
  },

  // ── Stations ───────────────────────────────────────────────────
  /** GET /mes/stations */
  getStations(params?: { lineCode?: string; stationType?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<Station>>(`/mes/stations${qs(params ?? {})}`);
  },
  /** GET /mes/stations/{code} */
  getStation(code: string) {
    return apiClient.get<StationWithEvents>(`/mes/stations/${encodeURIComponent(code)}`);
  },
  /** GET /mes/stations/:code/ng-defects — NG defect records for a station */
  getStationNgDefects(code: string, limit = 50) {
    return apiClient.get<ListEnvelope<{ id: number; occurredAt: string; lineName: string; stationCode: string; pcbSerial: string; result: string; defectCode: string; defectDesc: string; operator: string }>>(
      `/mes/stations/${encodeURIComponent(code)}/ng-defects?limit=${limit}`
    );
  },
  /** GET /mes/stations/:code/status — lightweight real-time status (2s polling) */
  getStationStatus(code: string) {
    return apiClient.get<{
      stationCode: string; stationStatus: string; lineCode: string;
      today: { pass: number; fail: number; total: number };
      lastEvent: { result: string; eventType: string; occurredAt: string; pcbSerial: string } | null;
      lastNg: { occurredAt: string; sn: string; defectCode: string; defectDesc: string } | null;
      isOnline: boolean; lastSeen: string | null;
    }>(`/mes/stations/${encodeURIComponent(code)}/status`);
  },
  /** GET /mes/heartbeats — all station heartbeat statuses */
  getHeartbeats() {
    return apiClient.get<{ heartbeats: Array<{ stationCode: string; lastSeen: string; lineCode: string }> }>(`/mes/heartbeats`);
  },

  // ── Process routes ─────────────────────────────────────────────
  /** GET /mes/process-routes */
  getProcessRoutes(params?: { productCode?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<ProcessRoute>>(`/mes/process-routes${qs(params ?? {})}`);
  },
  /** GET /mes/process-routes/{id} */
  getProcessRoute(id: number | string) {
    return apiClient.get<ProcessRouteDetail>(`/mes/process-routes/${id}`);
  },
  /** GET /mes/process-routes/{id}/steps */
  getProcessRouteSteps(id: number | string) {
    return apiClient.get<ListEnvelope<ProcessRouteStep>>(`/mes/process-routes/${id}/steps`);
  },

  getNgRouteConfigurationBootstrap() {
    return apiClient.get<{ configuration: any; validation: { valid: boolean; errors: string[] }; source: string }>("/mes/route-configurations/bootstrap");
  },
  getNgRouteConfigurations() {
    return apiClient.get<ListEnvelope<any>>("/mes/route-configurations");
  },
  createNgRouteConfiguration(configuration: any, reason: string) {
    return apiClient.post<{ item: any }>("/mes/route-configurations", { configuration, reason });
  },
  submitNgRouteConfiguration(id: number | string, reason: string) {
    return apiClient.post<{ item: any }>(`/mes/route-configurations/${id}/submit`, { reason });
  },
  approveNgRouteConfiguration(id: number | string, reason: string) {
    return apiClient.post<{ item: any }>(`/mes/route-configurations/${id}/approve`, { reason });
  },
  publishNgRouteConfiguration(id: number | string, reason: string) {
    return apiClient.post<{ item: any }>(`/mes/route-configurations/${id}/publish`, { reason });
  },

  // ── Runs ───────────────────────────────────────────────────────
  /** GET /mes/runs */
  getRuns(params?: { lineCode?: string; workOrderCode?: string; status?: string; fromDate?: string; toDate?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<MesRun>>(`/mes/runs${qs(params ?? {})}`);
  },
  /** POST /mes/runs (start or stop) */
  startOrStopRun(action: "start" | "stop", payload: { lineCode: string; workOrderCode: string; reason?: string }) {
    return apiClient.post<{ item: { action: string; workOrderCode: string; status: string } }>(
      "/mes/runs",
      { action, payload },
    );
  },
  /** GET /mes/runs/{id} — with OEE components, downtime, events */
  getRun(id: number | string) {
    return apiClient.get<MesRunDetail>(`/mes/runs/${id}`);
  },
  /** POST /mes/runs/{id}/close */
  closeRun(id: number | string, reason?: string) {
    return apiClient.post<{ item: { id: number; status: string } }>(
      `/mes/runs/${id}/close`,
      { action: "close", payload: { reason } },
    );
  },

  // ── Feeder bindings ────────────────────────────────────────────
  /** GET /mes/feeder-bindings */
  getFeederBindings(params?: { workOrderCode?: string; lineCode?: string; machineCode?: string; bound?: boolean; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<FeederBinding>>(`/mes/feeder-bindings${qs(params ?? {})}`);
  },
  /** POST /mes/feeder-bindings */
  bindFeeder(payload: {
    workOrderCode: string;
    lineCode: string;
    machineCode: string;
    lotNo: string;
    feederNo: string;
    reelCode: string;
    operator: string;
  }) {
    return apiClient.post<{ item: FeederBinding }>(
      "/mes/feeder-bindings",
      { action: "bind", payload },
    );
  },
  /** PATCH /mes/feeder-bindings/{id} */
  releaseFeeder(id: number | string, reason?: string) {
    return apiClient.patch<{ item: FeederBinding }>(
      `/mes/feeder-bindings/${id}`,
      { action: "release", payload: { reason } },
    );
  },
  /** DELETE /mes/feeder-bindings/{id} */
  unbindFeeder(id: number | string) {
    return apiClient.delete<{ item: { id: number; deleted: boolean } }>(`/mes/feeder-bindings/${id}`);
  },

  // ── PCB serials ────────────────────────────────────────────────
  /** GET /mes/pcb-serials */
  getPcbSerials(params?: { workOrderCode?: string; lineCode?: string; status?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<PcbSerial>>(`/mes/pcb-serials${qs(params ?? {})}`);
  },
  /** POST /mes/pcb-serials */
  registerPcbSerial(payload: { serialNo: string; workOrderCode: string }) {
    return apiClient.post<{ item: PcbSerial }>(
      "/mes/pcb-serials",
      { action: "register", payload },
    );
  },
  /** GET /mes/pcb-serials/{serialNo} */
  getPcbSerial(serialNo: string) {
    return apiClient.get<PcbSerialDetail>(`/mes/pcb-serials/${encodeURIComponent(serialNo)}`);
  },

  // ── Station events ─────────────────────────────────────────────
  /** GET /mes/events */
  getEvents(params?: { lineCode?: string; workOrderCode?: string; pcbSerial?: string; eventType?: string; fromDate?: string; toDate?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<StationEvent>>(`/mes/events${qs(params ?? {})}`);
  },
  /** POST /mes/events */
  postEvent(payload: {
    pcbSerial: string;
    stationCode: string;
    machineCode?: string;
    operator?: string;
    eventType: string;
    result: "PASS" | "FAIL" | "REPAIRING" | "CLOSED";
    occurredAt?: string;
  }) {
    return apiClient.post<{ item: StationEvent }>(
      "/mes/events",
      { action: "station_scan", payload },
    );
  },

  // ── Downtime ───────────────────────────────────────────────────
  /** GET /mes/downtimes */
  getDowntimes(params?: { lineCode?: string; status?: "open" | "closed" | "voided"; fromDate?: string; toDate?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<Downtime>>(`/mes/downtimes${qs(params ?? {})}`);
  },
  /** POST /mes/downtimes */
  openDowntime(payload: { lineCode: string; stationCode?: string; reasonCode: string; reasonDetail?: string; operator: string }) {
    return apiClient.post<{ item: Downtime }>(
      "/mes/downtimes",
      { action: "open", payload },
    );
  },
  /** PATCH /mes/downtimes/{id} */
  closeDowntime(id: number | string, payload: { actionTaken: string; operator: string }) {
    return apiClient.patch<{ item: Downtime }>(
      `/mes/downtimes/${id}`,
      { action: "close", payload },
    );
  },

  // ── Cross-cutting trace ────────────────────────────────────────
  /** GET /mes/trace/{serialNo} */
  getTrace(serialNo: string) {
    return apiClient.get<PcbTrace>(`/mes/trace/${encodeURIComponent(serialNo)}`);
  },

  getBomReconciliation(workOrderId: number | string) {
    return apiClient.get<{ ok: boolean; gate: BomReconciliationGate | null; lines: BomReconciliationLine[] }>(
      `/mes/work-orders/${workOrderId}/bom-reconciliation`,
    );
  },
  initializeBomReconciliation(workOrderId: number | string) {
    return apiClient.post<{ ok: boolean; inserted: number; gate: BomReconciliationGate | null }>(
      `/mes/work-orders/${workOrderId}/bom-reconciliation/initialize`, {},
    );
  },

  // ── Stagnation Tracking ───────────────────────────────────────
  /** GET /mes/stagnation — mirrors Excel 产品呆滞管控 filter bar */
  getStagnation(params?: {
    status?: string; level?: string; lineCode?: string; stationCode?: string;
    customer?: string; model?: string;
    fromStation?: string; toStation?: string;
    overdueMonthsMin?: number;
    poNumber?: string;
    limit?: number; offset?: number;
  }) {
    return apiClient.get<ListEnvelope<StagnationLog>>(`/mes/stagnation${qs(params ?? {})}`);
  },
  /** GET /mes/stagnation/alerts */
  getStagnationAlerts(params?: { lineCode?: string }) {
    return apiClient.get<ListEnvelope<StagnationAlert>>(`/mes/stagnation/alerts${qs(params ?? {})}`);
  },
  /** PATCH /mes/stagnation/:id/resolve */
  resolveStagnation(id: number, notes?: string) {
    return apiClient.patch<{ item: { id: number; status: string } }>(
      `/mes/stagnation/${id}/resolve`,
      { payload: { notes } },
    );
  },
  /** GET /mes/stagnation/thresholds */
  getStagnationThresholds(params?: { lineCode?: string }) {
    return apiClient.get<ListEnvelope<StagnationThreshold>>(`/mes/stagnation/thresholds${qs(params ?? {})}`);
  },

  // ── Scrap Management ──────────────────────────────────────────
  /** GET /mes/scraps */
  getScraps(params?: { status?: string; lineCode?: string; stationCode?: string; fromDate?: string; toDate?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<ScrapRecord>>(`/mes/scraps${qs(params ?? {})}`);
  },
  /** POST /mes/scraps */
  createScrap(payload: {
    sn: string;
    pcbNo?: string;
    productModel?: string;
    scrapStation: string;
    lineCode: string;
    scrapReasonCode: string;
    scrapReasonDetail?: string;
    responsiblePerson?: string;
    poNumber?: string;
    notes?: string;
  }) {
    return apiClient.post<{ item: { id: number; sn: string; status: string } }>(
      "/mes/scraps",
      { payload },
    );
  },
  /** PATCH /mes/scraps/:id */
  updateScrap(id: number, payload: { status?: string; notes?: string }) {
    return apiClient.patch<{ item: { id: number; status: string } }>(
      `/mes/scraps/${id}`,
      { payload },
    );
  },
  /** GET /mes/scrap-reason-codes */
  getScrapReasonCodes(params?: { category?: string }) {
    return apiClient.get<ListEnvelope<ScrapReasonCode>>(`/mes/scrap-reason-codes${qs(params ?? {})}`);
  },

  // ── Fool-Proof Rules ──────────────────────────────────────────────
  getFoolProofRules(params?: { stationCode?: string; lineCode?: string; status?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<FoolProofRule>>(`/mes/fool-proof-rules${qs(params ?? {})}`);
  },
  getMaterialFeederAssignments(params?: { lineCode?: string; workOrderCode?: string; status?: string }) {
    return apiClient.get<ListEnvelope<MaterialFeederAssignment>>(`/mes/material-feeder-assignments${qs(params ?? {})}`);
  },
  createMaterialFeederAssignment(payload: { lineCode: string; machineCode: string; channelCode: string; slotNo: string; feederCode: string; materialCode: string; workOrderCode?: string }) {
    return apiClient.post<{ item: { id: number } }>(`/mes/material-feeder-assignments`, { payload });
  },
  createFoolProofRule(payload: { stationId: number; lineId?: number; feederSlot: string; materialId?: number; materialReelCode?: string; ruleType?: string; notes?: string }) {
    return apiClient.post<{ id: number }>(`/mes/fool-proof-rules`, payload);
  },
  updateFoolProofRule(id: number, payload: { materialId?: number; materialReelCode?: string; ruleType?: string; status?: string; notes?: string }) {
    return apiClient.patch<{ id: number }>(`/mes/fool-proof-rules/${id}`, payload);
  },
  deleteFoolProofRule(id: number) {
    return apiClient.delete<{ id: number; deleted: boolean }>(`/mes/fool-proof-rules/${id}`);
  },

  // ── First Article Inspections ─────────────────────────────────────
  getFirstArticleInspections(params?: { workOrderCode?: string; stationCode?: string; result?: string; fromDate?: string; toDate?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<FirstArticleInspection>>(`/mes/first-article-inspections${qs(params ?? {})}`);
  },
  getFirstArticleInspection(id: number) {
    return apiClient.get<FirstArticleInspection & { checkItems: FirstArticleCheckItem[] }>(`/mes/first-article-inspections/${id}`);
  },
  createFirstArticleInspection(payload: {
    workOrderId: number; stationId: number; lineId?: number; result: string;
    checkedBy?: string; checkedAt?: string; lotNo?: string; remarks?: string;
    checkItems?: Array<{ checkType: string; materialCode?: string; expectedValue?: string; actualValue?: string; result: string; notes?: string }>;
  }) {
    return apiClient.post<{ id: number }>(`/mes/first-article-inspections`, payload);
  },

  // ── Material Verifications ────────────────────────────────────────
  getMaterialVerifications(params?: { workOrderCode?: string; stationCode?: string; matchResult?: string; fromDate?: string; toDate?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<MaterialVerification>>(`/mes/material-verifications${qs(params ?? {})}`);
  },
  createMaterialVerification(payload: {
    workOrderId?: number; lineId?: number; stationId: number; feederSlot?: string;
    materialCode?: string; expectedReel?: string; actualReel?: string;
    matchResult: string; verifiedBy?: string;
  }) {
    return apiClient.post<{ id: number }>(`/mes/material-verifications`, payload);
  },

  // ── Station Flow Records ───────────────────────────────────────────
  getStationFlow(params?: { sn?: string; pcbNo?: string; lineCode?: string; fromDate?: string; toDate?: string; limit?: number; offset?: number }) {
    return apiClient.get<ListEnvelope<StationFlowRecord>>(`/mes/station-flow${qs(params ?? {})}`);
  },
  getFullTrace(serialNo: string) {
    return apiClient.get<FullTrace>(`/mes/trace/${encodeURIComponent(serialNo)}`);
  },

  /** Check upstream stations for NG history of a given SN.
   *  Used by downstream stations to catch boards that failed upstream. */
  getUpstreamCheck(pcbSerial: string, stationCode: string) {
    return apiClient.get<UpstreamCheckResult>(
      `/mes/events/upstream-check/${encodeURIComponent(pcbSerial)}?stationCode=${encodeURIComponent(stationCode)}`,
    );
  },

  // ── Factory Simulation Status ─────────────────────────────────────────
  getFactorySimStatus(): Promise<FactorySimStatus> {
    return apiClient.get<FactorySimStatus>("/factory-sim/status");
  },

  // ── Feeder Loading Records ───────────────────────────────────────────
  getFeederLoadingRecords(workOrderCode: string) {
    return apiClient.get<ListEnvelope<FeederLoadingRecord>>(
      `/mes/feeder-loading/${encodeURIComponent(workOrderCode)}`,
    );
  },

  // ── Station Types CRUD ──────────────────────────────────────────────
  /** GET /mes/station-types */
  getStationTypes() {
    return apiClient.get<ListEnvelope<StationType>>("/mes/station-types");
  },
  /** POST /mes/station-types */
  createStationType(payload: CreateStationType) {
    return apiClient.post<{ data: StationType }>("/mes/station-types", { payload });
  },
  /** PUT /mes/station-types/:id */
  updateStationType(id: number, payload: UpdateStationType) {
    return apiClient.patch<{ data: StationType }>(`/mes/station-types/${id}`, { payload });
  },
  /** DELETE /mes/station-types/:id */
  deleteStationType(id: number) {
    return apiClient.delete<{ data: StationType }>(`/mes/station-types/${id}`);
  },

  // ── Station Master CRUD ─────────────────────────────────────────────
  /** POST /mes/stations */
  createStation(payload: CreateStation) {
    return apiClient.post<{ data: StationMaster }>("/mes/stations", { payload });
  },
  /** PUT /mes/stations/:code */
  updateStation(code: string, payload: UpdateStation) {
    return apiClient.patch<{ data: StationMaster }>(`/mes/stations/${encodeURIComponent(code)}`, { payload });
  },
  /** DELETE /mes/stations/:code */
  deleteStation(code: string) {
    return apiClient.delete<{ data: StationMaster }>(`/mes/stations/${encodeURIComponent(code)}`);
  },

  // ── Journey Tracking ─────────────────────────────────────────────────────
  /** GET /api/journey/sn/:sn — SN完整行程 */
  getSnJourney(sn: string) {
    return apiClient.get<{ ok: boolean; sn: string; pastEvents: any[]; ngDefectRecords: any[]; repairWorkOrders: any[] }>(`/api/journey/sn/${encodeURIComponent(sn)}`);
  },
  /** GET /api/journey/sns — SN行程列表 */
  getSnJourneyList(params?: { workOrderCode?: string; stage?: string; status?: string; limit?: number }) {
    return apiClient.get<{ ok: boolean; items: any[] }>(`/api/journey/sns${qs(params ?? {})}`);
  },
  /** GET /api/journey/box/:containerId — 箱物流行程 */
  getBoxJourney(containerId: string) {
    return apiClient.get<{ ok: boolean; containerId: string; pastEvents: any[] }>(`/api/journey/box/${encodeURIComponent(containerId)}`);
  },
  /** GET /api/journey/boxes — 箱行程列表 */
  getBoxJourneyList(params?: { workOrderCode?: string; stage?: string; palletCode?: string; limit?: number }) {
    return apiClient.get<{ ok: boolean; items: any[] }>(`/api/journey/boxes${qs(params ?? {})}`);
  },
};

export interface UpstreamCheckResult {
  hasNg: boolean;
  hasPass: boolean;
  verdict: 'BLOCK_NG' | 'OK' | 'UNKNOWN';
  upstreamEvents: Array<{
    id: number;
    eventType: string;
    result: string;
    occurredAt: string;
    traceKey?: string;
    stationCode: string;
    sequence_order: number;
    operatorName?: string;
    /** Present for fail events at the current station — repair_status from ng_defect_records */
    repairStatus?: string;
  }>;
  stationCode: string;
  lineCode: string;
  lineName: string;
  pcbSerial: string;
  upstreamStationCodes: string[];
  note?: string;
  /** Number of FAIL events for this SN at the current station (ICT/FCT retest tracking) */
  failCount?: number;
  /** True when failCount >= 2 — board must go to repair before more retests */
  mustRepair?: boolean;
  /** Number of PENDING NG defect records blocking downstream entry */
  pendingNgCount?: number;
  /** True when this SN has a duplicate attempt logged at an upstream station */
  hasDuplicate?: boolean;
  /** Most recent duplicate attempt details */
  duplicateInfo?: {
    id: number;
    station_code: string;
    action: string;
    decision: string;
    operator: string | null;
    occurred_at: string;
  };
}

// ── Factory Simulation Status ─────────────────────────────────────────

export interface FactorySimLineRun {
  line_id: number;
  line_code: string;
  running: number;
  idle: number;
  paused: number;
  completed: number;
  total_output: number;
  last_started: string | null;
}

export interface FactorySimStagnation {
  total: number;
  open: number;
  critical: number;
}

export interface FactorySimScrap {
  total: number;
  pending: number;
  approved: number;
}

export interface FactorySimDowntime {
  total: number;
  open_dt: number;
  escalated: number;
  downtime_min_24h: number;
}

export interface FactorySimStatus {
  runs: FactorySimLineRun[];
  stagnation: FactorySimStagnation;
  scrap: FactorySimScrap;
  downtime: FactorySimDowntime;
}

export interface FeederLoadingRecord {
  id: number;
  workOrderCode: string;
  lineCode?: string;
  slotNo: string;
  lotNo: string;
  materialCode?: string;
  qty?: number;
  operator?: string;
  operatorName?: string;
  loadedAt: string;
  feederNo?: string;
}

// ── Station Types ────────────────────────────────────────────────────────────

export interface StationType {
  id: number;
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  category: "smt" | "post_smt" | "packaging" | "oqc" | "auxiliary";
  has_hardware: boolean;
  has_software: boolean;
  status: string;
  created_at: string;
}

export interface CreateStationType {
  code: string;
  name_zh: string;
  name_en?: string;
  name_vi?: string;
  category: "smt" | "post_smt" | "packaging" | "oqc" | "auxiliary";
  has_hardware?: boolean;
  has_software?: boolean;
}

export interface UpdateStationType {
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
  category?: "smt" | "post_smt" | "packaging" | "oqc" | "auxiliary";
  has_hardware?: boolean;
  has_software?: boolean;
}

// ── Station Master ─────────────────────────────────────────────────────────────

export interface StationMaster {
  id: number;
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  line_id: number;
  station_type_id: number;
  equipment_code: string | null;
  status: string;
  created_at: string;
}

export interface CreateStation {
  code: string;
  name_zh: string;
  name_en?: string;
  name_vi?: string;
  line_id: number;
  station_type_id: number;
  equipment_code?: string;
  status?: string;
}

export interface UpdateStation {
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
  equipment_code?: string;
  status?: string;
}
