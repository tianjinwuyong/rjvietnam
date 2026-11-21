import { apiClient, authStorage, ApiClientError, type ListEnvelope, type MutateEnvelope } from "./client";
import type { Bom, BomLine, BomEditHistoryEntry, BomEditAction, BomEditSource } from "../../../../packages/shared-types/src/factory";

export interface BomWithLines extends Omit<Bom, "lines"> {
  lines: BomLine[];
}
export interface BomImportChangeRequest { id:number;productCode:string;existingRevision:string;requestedRevision:string;sourceFileName:string;sourceFingerprint:string;status:string;requestedAt:string;reviewedAt?:string;reviewNote?:string;lineCount:number; }

// ── API client (real DB) ────────────────────────────────────────────

export const bomApi = {
  getImportChangeRequests(status="PENDING_REVIEW") { return apiClient.get<{items:BomImportChangeRequest[];total:number}>(`/bom-import-change-requests?status=${encodeURIComponent(status)}`); },
  decideImportChange(id:number,decision:"APPROVE"|"REJECT",note:string,newRevision?:string) { return apiClient.post<MutateEnvelope<{id:number;status:string;bomId?:number;newRevision?:string}>>(`/bom-import-change-requests/${id}/decision`,{decision,note,newRevision}); },
  /** GET /boms */
  async getBoms(params?: {
    productCode?: string;
    status?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListEnvelope<Bom>> {
    const qs = new URLSearchParams();
    if (params?.productCode) qs.set("productCode", params.productCode);
    if (params?.status) qs.set("status", params.status);
    if (params?.q) qs.set("q", params.q);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<Bom>>(`/boms${query ? `?${query}` : ""}`);
  },

  /** GET /boms/:id */
  async getBomById(id: number | string): Promise<BomWithLines> {
    return apiClient.get<BomWithLines>(`/boms/${id}`);
  },

  /** GET /boms/product/:code — latest active BOM for a product */
  async getBomByProduct(productCode: string): Promise<BomWithLines | null> {
    try {
      return await apiClient.get<BomWithLines>(`/boms/product/${encodeURIComponent(productCode)}`);
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.code === "NOT_FOUND") return null;
      throw err;
    }
  },

  /** POST /boms — create BOM with lines */
  async createBom(payload: {
    productCode: string;
    revision: string;
    status?: string;
    lines: Array<{
      materialCode: string;
      qtyPer: number;
      lossRate?: number;
      referenceDesignators?: string[];
    }>;
  }): Promise<{ id: number | string }> {
    const res = await apiClient.post<MutateEnvelope<{ id: number | string }>>("/boms", {
      payload,
    });
    return res.item;
  },

  /** PATCH /boms/:id — full BOM update (fields + lines) */
  async updateBom(id: number | string, payload: {
    productCode?: string;
    productNameZh?: string;
    productNameEn?: string;
    productNameVi?: string;
    revision?: string;
    status?: string;
    sourceFileName?: string;
    sourceFingerprint?: string;
    lines?: Array<{
      materialCode: string;
      chinaMaterialCode?: string;
      materialCategory?: string;
      name?: string;
      spec?: string;
      unit?: string;
      qtyPer: number;
      lossRate?: number;
      referenceDesignators?: string[];
      position?: string;
    }>;
  }): Promise<void> {
    await apiClient.patch<MutateEnvelope<unknown>>(`/boms/${id}`, { payload });
  },

  /** PATCH /boms/:id/status */
  async updateBomStatus(id: number | string, status: string): Promise<void> {
    await apiClient.patch<MutateEnvelope<unknown>>(`/boms/${id}/status`, {
      payload: { status },
    });
  },

  /** DELETE /boms/:id */
  async deleteBom(id: number | string): Promise<void> {
    await apiClient.delete<MutateEnvelope<unknown>>(`/boms/${id}`);
  },

  /** POST /boms/import — import BOM from parsed Excel data */
  async importBomFromExcel(payload: {
    productCode: string;
    productName?: string;
    revision?: string;
    status?: string;
    sourceFileName?: string;
    sourceFingerprint?: string;
    lines: Array<{
      materialCode: string;
      chinaMaterialCode?: string;
      name?: string;
      materialCategory?: string;
      spec?: string;
      unit?: string;
      qtyPer: number;
      lossRate?: number;
      position?: string;
    }>;
  }): Promise<{ id: number | string }> {
    // Real API would POST to /boms/import
    const res = await apiClient.post<MutateEnvelope<{ id: number | string }>>("/boms/import", { payload });
    return res.item;
  },

  /** GET /boms/:id/export — download BOM as Excel file */
  async exportBomToExcel(id: number | string): Promise<void> {
    const res = await apiClient.get<MutateEnvelope<BomWithLines>>(`/boms/${id}`);
    const bom = res.item;

    const XLSX = await import("xlsx");

    const wsData = [
      ["越南瑞晶 SMT 工厂系统 - BOM 导出"],
      ["产品编码", bom.productCode, "产品名称", bom.productNameZh ?? "", "版本", bom.revision],
      [],
      ["序号", "物料编码", "物料大类", "物料名称", "规格型号", "用量", "单位", "损耗率", "位号"],
      ...bom.lines.map((l, i) => [
        i + 1,
        l.materialCode,
        l.materialCategory ?? "",
        l.materialNameZh,
        l.spec ?? "",
        l.qtyPer,
        l.unit ?? "PCS",
        l.lossRate,
        l.position ?? (l.referenceDesignators ?? []).join(", "),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 6 }, { wch: 18 }, { wch: 12 }, { wch: 40 }, { wch: 40 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BOM");
    XLSX.writeFile(wb, `${bom.productCode}_BOM.xlsx`);
  },

  /** GET /boms/:id/history */
  async getBomHistory(bomId: number | string): Promise<BomEditHistoryEntry[]> {
    return apiClient.get<BomEditHistoryEntry[]>(`/boms/${bomId}/history`);
  },

  /** POST /boms/:id/history — record a new edit history entry */
  async addBomHistoryEntry(payload: {
    bomId: number | string;
    action: BomEditAction;
    source: BomEditSource;
    snapshot: Bom;
    changeSummary?: string;
    operatorName?: string;
  }): Promise<BomEditHistoryEntry> {
    const entry: BomEditHistoryEntry = {
      id: Date.now(),
      bomId: payload.bomId,
      action: payload.action,
      operatorName: payload.operatorName ?? "operator",
      operatedAt: new Date().toISOString(),
      source: payload.source,
      snapshot: payload.snapshot,
      changeSummary: payload.changeSummary,
    };
    const res = await apiClient.post<MutateEnvelope<BomEditHistoryEntry>>(`/boms/${payload.bomId}/history`, { payload: entry });
    return res.item;
  },

  // ── BOM AI Patrol ────────────────────────────────────────────
  async bomPatrol(): Promise<{
    timestamp: string;
    cycle: number;
    checks: Record<string, { status: "pass" | "fail"; count: number; detail: string }>;
    totalAnomalies: number;
  }> {
    return apiClient.get("/boms/patrol");
  },

  /** GET /boms/alerts */
  async bomAlerts(): Promise<Array<{
    id: string;
    type: string;
    severity: string;
    message: string;
    time: string;
    resolved: boolean;
  }>> {
    return apiClient.get("/boms/alerts");
  },
};
