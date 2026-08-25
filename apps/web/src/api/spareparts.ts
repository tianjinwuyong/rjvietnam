import { apiClient, type ListEnvelope } from "./client";
import { spareParts, partsWearSchedules, partsConsumptionLogs, partsWearAlerts } from "../data";
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

let _useDemo = true;

function useDemo() { return _useDemo; }

export const sparePartsApi = {
  setLiveMode(live: boolean) { _useDemo = live; },

  async getParts(params?: { q?: string; equipmentModel?: string; status?: string; minStock?: boolean; limit?: number; offset?: number }): Promise<ListEnvelope<SparePart>> {
    if (useDemo()) {
      let items = [...spareParts];
      if (params?.q) {
        const q = params.q.toLowerCase();
        items = items.filter((p) => p.partNo.toLowerCase().includes(q) || (p.name_zh ?? "").toLowerCase().includes(q) || (p.name_en ?? "").toLowerCase().includes(q));
      }
      if (params?.equipmentModel) items = items.filter((p) => p.equipmentModel === params.equipmentModel);
      if (params?.status) items = items.filter((p) => p.status === params.status);
      if (params?.minStock) items = items.filter((p) => p.currentStock < p.minStock);
      return { items, total: items.length };
    }
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
    if (useDemo()) return { items: spareParts.filter((p) => p.currentStock < p.minStock), total: spareParts.filter((p) => p.currentStock < p.minStock).length };
    return apiClient.get("/spare-parts/low-stock");
  },

  async getWearAlerts(params?: { acknowledged?: boolean; severity?: string }): Promise<ListEnvelope<PartsWearAlert>> {
    if (useDemo()) {
      let items = [...partsWearAlerts];
      if (params?.acknowledged !== undefined) items = items.filter((a) => a.acknowledged === params.acknowledged);
      if (params?.severity) items = items.filter((a) => a.severity === params.severity);
      return { items, total: items.length };
    }
    const qp = new URLSearchParams();
    if (params?.acknowledged !== undefined) qp.set("acknowledged", String(params.acknowledged));
    if (params?.severity) qp.set("severity", params.severity);
    return apiClient.get(`/spare-parts/wear-alerts?${qp}`);
  },

  async getWearSchedule(params?: { equipmentId?: string; wearStatus?: string }): Promise<ListEnvelope<PartsWearSchedule>> {
    if (useDemo()) {
      let items = [...partsWearSchedules];
      if (params?.equipmentId) items = items.filter((w) => w.equipmentId === params.equipmentId);
      if (params?.wearStatus) items = items.filter((w) => w.wearStatus === params.wearStatus);
      return { items, total: items.length };
    }
    const qp = new URLSearchParams();
    if (params?.equipmentId) qp.set("equipmentId", params.equipmentId);
    if (params?.wearStatus) qp.set("wearStatus", params.wearStatus);
    return apiClient.get(`/spare-parts/wear-schedule?${qp}`);
  },

  async getConsumption(params?: { partId?: string; from?: string; to?: string; limit?: number }): Promise<ListEnvelope<PartsConsumptionLog>> {
    if (useDemo()) {
      let items = [...partsConsumptionLogs];
      if (params?.partId) items = items.filter((c) => c.partId === params.partId);
      return { items, total: items.length };
    }
    const qp = new URLSearchParams();
    if (params?.partId) qp.set("partId", params.partId);
    if (params?.from) qp.set("from", params.from);
    if (params?.to) qp.set("to", params.to);
    if (params?.limit) qp.set("limit", String(params.limit));
    return apiClient.get(`/spare-parts/consumption?${qp}`);
  },

  async getSummary(): Promise<SparePartsSummary> {
    if (useDemo()) {
      const low = spareParts.filter((p) => p.currentStock < p.minStock).length;
      const crit = partsWearSchedules.filter((w) => w.wearStatus === "critical" || w.wearStatus === "overdue").length;
      const warn = partsWearSchedules.filter((w) => w.wearStatus === "warning").length;
      const critAlert = partsWearAlerts.filter((a) => !a.acknowledged && a.severity === "critical").length;
      return {
        totalParts: spareParts.length,
        totalUnits: spareParts.reduce((s, p) => s + p.currentStock, 0),
        lowStockCount: low,
        totalWearSchedule: partsWearSchedules.length,
        criticalWear: crit,
        warningWear: warn,
        totalAlerts: partsWearAlerts.filter((a) => !a.acknowledged).length,
        criticalAlerts: critAlert,
        last30DaysConsumed: partsConsumptionLogs.reduce((s, c) => s + c.quantity, 0),
        last30DaysTransactions: partsConsumptionLogs.length,
      };
    }
    return apiClient.get("/spare-parts/stats/summary");
  },

  async recordConsume(partId: string, body: { quantity: number; equipmentId?: string; workOrderCode?: string; reason: string; operatorName?: string }): Promise<{ consumptionId: string }> {
    if (useDemo()) return { consumptionId: `PCL-DEMO-${Date.now()}` };
    return apiClient.post(`/spare-parts/${partId}/consume`, body);
  },

  async replacePart(partId: string, body: { equipmentId: string; installedAt?: string; runningHours?: number; replaceIntervalHours?: number; nextReplaceDue?: string }): Promise<{ wearScheduleId: string }> {
    if (useDemo()) return { wearScheduleId: `WS-DEMO-${Date.now()}` };
    return apiClient.patch(`/spare-parts/${partId}/replace`, body);
  },

  async acknowledgeAlert(partId: string, body: { alertId: string; operatorName?: string }): Promise<{ alertId: string }> {
    if (useDemo()) return { alertId: body.alertId };
    return apiClient.post(`/spare-parts/${partId}/acknowledge`, body);
  },

  async adjustStock(partId: string, body: { adjustment: number; reason?: string; operatorName?: string }): Promise<{ currentStock: number }> {
    if (useDemo()) {
      const part = spareParts.find((p) => p.id === partId);
      if (part) part.currentStock = Math.max(0, part.currentStock + body.adjustment);
      return { currentStock: part?.currentStock ?? 0 };
    }
    return apiClient.post(`/spare-parts/${partId}/adjust-stock`, body);
  },
};
