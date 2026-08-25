import { apiClient, type ListEnvelope } from "../../api/client";

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
  lineCode?: string;
  recordNo?: string;
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
  defectPareto: AoiParetoEntry[];
}

export interface AoiParetoEntry {
  defectCode: string;
  count: number;
  percentage: number;
  nameZh?: string;
  nameEn?: string;
  nameVi?: string;
}

export interface AoiStation {
  stationCode: string;
  stationName: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  lineCode: string;
  machineCode: string;
  programName: string;
  status: string;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export const aoiApi = {
  /** GET /quality/aoi/records */
  getRecords(params?: {
    stationCode?: string;
    workOrderCode?: string;
    result?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  }) {
    return apiClient.get<ListEnvelope<AoiInspectionRecord>>(`/quality/aoi/records${qs(params ?? {})}`);
  },

  /** POST /quality/aoi/records */
  createRecord(payload: {
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
    stationCode?: string;
    lineCode?: string;
  }) {
    return apiClient.post<{ id: string; success: boolean; recordNo: string }>(
      "/quality/aoi/records",
      { payload }
    );
  },

  /** GET /quality/aoi/defect-codes */
  getDefectCodes(params?: { category?: string }) {
    return apiClient.get<ListEnvelope<AoiDefectCode>>(`/quality/aoi/defect-codes${qs(params ?? {})}`);
  },

  /** GET /quality/aoi/stats */
  getStats(params?: {
    stationCode?: string;
    workOrderCode?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    return apiClient.get<AoiStats>(`/quality/aoi/stats${qs(params ?? {})}`);
  },

  /** GET /quality/aoi/defect-pareto */
  getDefectPareto(params?: {
    stationCode?: string;
    workOrderCode?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }) {
    return apiClient.get<AoiParetoEntry[]>(
      `/quality/aoi/defect-pareto${qs({ limit: 10, ...(params ?? {}) })}`
    );
  },

  /** GET /quality/aoi/stations */
  getStations(params?: { lineCode?: string; status?: string }) {
    return apiClient.get<ListEnvelope<AoiStation>>(`/quality/aoi/stations${qs(params ?? {})}`);
  },
};
