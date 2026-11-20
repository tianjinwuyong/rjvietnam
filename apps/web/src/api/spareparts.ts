import { apiClient, type ListEnvelope } from "./client";
import type { SparePart, PartsWearSchedule, PartsConsumptionLog, PartsWearAlert } from "../../../../packages/shared-types/src/factory";

export type { SparePart, PartsWearSchedule, PartsConsumptionLog, PartsWearAlert };

interface SparePartsSummary {
  totalParts: number;
  totalUnits: number;
  lowStockCount: number;
  totalWearSchedule: number;
  criticalWear: number;
  warningWear: number;
  totalAlerts: number;
  criticalAlerts: number;
  last30DaysConsumed: number;
  last30DaysTransactions: number;
}

// Every call goes to the API. This module used to keep a `_useDemo` switch that defaulted
// to true, so a production build served fabricated parts, wear schedules and consumption
// logs until someone flipped it at runtime -- and nothing did.
export const sparePartsApi = {
  async getParts(params?: { q?: string; equipmentModel?: string; status?: string; minStock?: boolean; limit?: number; offset?: number }): Promise<ListEnvelope<SparePart>> {
    const qp = new URLSearchParams();
    if (params?.q) qp.set("q", params.q);
    if (params?.equipmentModel) qp.set("equipmentModel", params.equipmentModel);
    if (params?.status) qp.set("status", params.status);
    if (params?.minStock) qp.set("minStock", "true");
    if (params?.limit) qp.set("limit", String(params.limit));
    if (params?.offset) qp.set("offset", String(params.offset));
    return apiClient.get(`/spare-parts?${qp}`);
  },

  async getLowStock(): Promise<ListEnvelope<SparePart>> {
    return apiClient.get("/spare-parts/low-stock");
  },

  async getWearAlerts(params?: { acknowledged?: boolean; severity?: string }): Promise<ListEnvelope<PartsWearAlert>> {
    const qp = new URLSearchParams();
    if (params?.acknowledged !== undefined) qp.set("acknowledged", String(params.acknowledged));
    if (params?.severity) qp.set("severity", params.severity);
    return apiClient.get(`/spare-parts/wear-alerts?${qp}`);
  },

  async getWearSchedule(params?: { equipmentId?: string; wearStatus?: string }): Promise<ListEnvelope<PartsWearSchedule>> {
    const qp = new URLSearchParams();
    if (params?.equipmentId) qp.set("equipmentId", params.equipmentId);
    if (params?.wearStatus) qp.set("wearStatus", params.wearStatus);
    return apiClient.get(`/spare-parts/wear-schedule?${qp}`);
  },

  async getConsumption(params?: { partId?: string; from?: string; to?: string; limit?: number }): Promise<ListEnvelope<PartsConsumptionLog>> {
    const qp = new URLSearchParams();
    if (params?.partId) qp.set("partId", params.partId);
    if (params?.from) qp.set("from", params.from);
    if (params?.to) qp.set("to", params.to);
    if (params?.limit) qp.set("limit", String(params.limit));
    return apiClient.get(`/spare-parts/consumption?${qp}`);
  },

  async getSummary(): Promise<SparePartsSummary> {
    return apiClient.get("/spare-parts/stats/summary");
  },

  async recordConsume(partId: string, body: { quantity: number; equipmentId?: string; workOrderCode?: string; reason: string; operatorName?: string }): Promise<{ consumptionId: string }> {
    return apiClient.post(`/spare-parts/${partId}/consume`, body);
  },

  async replacePart(partId: string, body: { equipmentId: string; installedAt?: string; runningHours?: number; replaceIntervalHours?: number; nextReplaceDue?: string }): Promise<{ wearScheduleId: string }> {
    return apiClient.patch(`/spare-parts/${partId}/replace`, body);
  },

  async acknowledgeAlert(partId: string, body: { alertId: string; operatorName?: string }): Promise<{ alertId: string }> {
    return apiClient.post(`/spare-parts/${partId}/acknowledge`, body);
  },

  async adjustStock(partId: string, body: { adjustment: number; reason?: string; operatorName?: string }): Promise<{ currentStock: number }> {
    return apiClient.post(`/spare-parts/${partId}/adjust-stock`, body);
  },
};
