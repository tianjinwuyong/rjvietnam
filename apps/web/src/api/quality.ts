import { apiClient, type ListEnvelope } from "./client";

export interface QualityRecord {
  id: string;
  inspectionNo: string;
  station: string;
  workOrderCode: string;
  result: string;
  occurredAt: string;
  inspectionType: string;
  operator: string;
  // Extended fields (joined / optional)
  defectCode?: string;
  pcbSerial?: string;
}

// ── AOI Types ──────────────────────────────────────────────────────────

export interface AoiInspectionRecord {
  id: string;
  pcbSerial: string;
  workOrderCode: string;
  machineCode: string;
  program: string;
  result: "PASS" | "FAIL";
  defectCount: number;
  defectCodes: string[];
  defectLocations: string[];
  inspectedAt: string;
  operator: string;
  boardId?: string;
  stationCode?: string;
}

export interface AoiDefectCode {
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  category: string;
  description?: string;
}

export interface AoiStats {
  total: number;
  pass: number;
  fail: number;
  yieldRate: number;
  defectPareto: Array<{ defectCode: string; count: number; percentage: number }>;
}

export const qualityApi = {
  /** GET /quality/records */
  getRecords(params?: {
    station?: string;
    workOrderCode?: string;
    result?: string;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.station) qs.set("station", params.station);
    if (params?.workOrderCode) qs.set("workOrderCode", params.workOrderCode);
    if (params?.result) qs.set("result", params.result);
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<QualityRecord>>(
      `/quality/records${query ? `?${query}` : ""}`
    );
  },

  // ── AOI Station Endpoints ────────────────────────────────────────

  /** GET /quality/aoi/records */
  getAoiRecords(params?: {
    stationCode?: string;
    workOrderCode?: string;
    result?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.stationCode) qs.set("stationCode", params.stationCode);
    if (params?.workOrderCode) qs.set("workOrderCode", params.workOrderCode);
    if (params?.result) qs.set("result", params.result);
    if (params?.fromDate) qs.set("fromDate", params.fromDate);
    if (params?.toDate) qs.set("toDate", params.toDate);
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<AoiInspectionRecord>>(
      `/quality/aoi/records${query ? `?${query}` : ""}`
    );
  },

  /** POST /quality/aoi/records */
  createAoiRecord(payload: {
    pcbSerial: string;
    workOrderCode: string;
    machineCode: string;
    program: string;
    result: "PASS" | "FAIL";
    defectCount?: number;
    defectCodes?: string[];
    defectLocations?: string[];
    boardId?: string;
    operator?: string;
  }) {
    return apiClient.post<{ id: string; success: boolean }>(
      "/quality/aoi/records",
      { payload }
    );
  },

  /** GET /quality/aoi/defect-codes */
  getDefectCodes(params?: { category?: string }) {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    const query = qs.toString();
    return apiClient.get<ListEnvelope<AoiDefectCode>>(
      `/quality/aoi/defect-codes${query ? `?${query}` : ""}`
    );
  },

  /** GET /quality/aoi/stats */
  getAoiStats(params?: { stationCode?: string; workOrderCode?: string; fromDate?: string; toDate?: string }) {
    const qs = new URLSearchParams();
    if (params?.stationCode) qs.set("stationCode", params.stationCode);
    if (params?.workOrderCode) qs.set("workOrderCode", params.workOrderCode);
    if (params?.fromDate) qs.set("fromDate", params.fromDate);
    if (params?.toDate) qs.set("toDate", params.toDate);
    const query = qs.toString();
    return apiClient.get<AoiStats>(
      `/quality/aoi/stats${query ? `?${query}` : ""}`
    );
  },

  /** GET /quality/aoi/defect-pareto */
  getDefectPareto(params?: { stationCode?: string; workOrderCode?: string; fromDate?: string; toDate?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.stationCode) qs.set("stationCode", params.stationCode);
    if (params?.workOrderCode) qs.set("workOrderCode", params.workOrderCode);
    if (params?.fromDate) qs.set("fromDate", params.fromDate);
    if (params?.toDate) qs.set("toDate", params.toDate);
    if (params?.limit) qs.set("limit", String(params?.limit ?? 10));
    const query = qs.toString();
    return apiClient.get<Array<{ defectCode: string; count: number; percentage: number }>>(
      `/quality/aoi/defect-pareto${query ? `?${query}` : ""}`
    );
  },
};
