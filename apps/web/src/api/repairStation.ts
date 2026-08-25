import { apiClient, API_BASE, authStorage } from "./client";
import { buildRepairStationCommand, type RepairStationCommandType } from "../mes/repairStationIntegration";

export interface RepairStationContextResponse {
  sn: string;
  workOrderNo: string;
  generatedAt: string;
  mes: { available: boolean; workOrder?: Record<string, unknown> | null; events?: unknown[]; error?: string };
  wms: { available: boolean; lots: Array<Record<string, unknown>>; error?: string };
  qms: { available: boolean; case?: Record<string, unknown> | null; evidence?: unknown[]; error?: string };
}

export const repairStationApi = {
  async downloadWorkOrdersExcel(params?: { status?: string; stationCode?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.stationCode) query.set("stationCode", params.stationCode);
    if (params?.limit) query.set("limit", String(Math.min(params.limit, 5000)));
    const response = await fetch(`${API_BASE}/api/repair-station/export?${query.toString()}`, {
      headers: authStorage.getToken() ? { Authorization: `Bearer ${authStorage.getToken()}` } : {},
    });
    if (!response.ok) throw new Error(`work order export failed (${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `repair-work-orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
  },
  getContext(sn: string, workOrderNo?: string, lotNo?: string) {
    return apiClient.get<RepairStationContextResponse>("/api/repair-station/context", {
      sn,
      workOrderNo: workOrderNo || undefined,
      lotNo: lotNo || undefined,
    });
  },
  sendCommand(input: {
    type: RepairStationCommandType;
    stationCode: string;
    sn: string;
    workOrderNo?: string;
    operator: string;
    payload?: Record<string, unknown>;
  }) {
    return apiClient.post<{ accepted: boolean; replay: boolean; eventId: string; authority: "MES" }>(
      "/api/repair-station/commands",
      buildRepairStationCommand({ ...input, payload: input.payload || {} }),
    );
  },
};
