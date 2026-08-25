import { apiClient, authStorage, ApiClientError, type ListEnvelope, type MutateEnvelope } from "./client";
import type { Bom, BomLine, BomEditHistoryEntry, BomEditAction, BomEditSource } from "../../../../packages/shared-types/src/factory";
import { demoBoms, type DemoBom, type DemoBomLine } from "./bom-demo-data";

export interface BomWithLines extends Omit<Bom, "lines"> {
  lines: BomLine[];
}
export interface BomImportChangeRequest { id:number;productCode:string;existingRevision:string;requestedRevision:string;sourceFileName:string;sourceFingerprint:string;status:string;requestedAt:string;reviewedAt?:string;reviewNote?:string;lineCount:number; }

// ── Demo-mode in-memory store ─────────────────────────────────────
// Full material lines extracted from database/seeds/002_bom_seed.sql

const LS_KEY = "demo_boms";

function loadStoredBoms(): DemoBom[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveBoms(boms: DemoBom[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(boms));
  } catch {}
}

const _seedBoms = demoBoms.map((d) => d.bom as DemoBom);

const demoStore: { boms: DemoBom[]; nextId: () => string; addBom: (b: DemoBom) => void } = {
  boms: [..._seedBoms, ...loadStoredBoms()],
  nextId: () => String(Date.now()),
  addBom(bom: DemoBom) {
    this.boms.push(bom);
    saveBoms(this.boms.slice(_seedBoms.length));
  },
};

// In-memory BOM edit history (demo mode)
const demoHistoryStore: BomEditHistoryEntry[] = [];

function isDemoMode(): boolean {
  return !authStorage.getToken();
}

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

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
    if (isDemoMode()) {
      let items: Bom[] = demoStore.boms.map(({ lines: _, ...rest }) => rest);
      if (params?.q) {
        const q = params.q.toLowerCase();
        items = items.filter((b) => (b.productCode?.toLowerCase().includes(q) ?? false) || (b.productNameZh?.toLowerCase().includes(q) ?? false));
      }
      const total = items.length;
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? 20;
      return delay({ items: items.slice(offset, offset + limit), total });
    }
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
    if (isDemoMode()) {
      const bom = demoStore.boms.find((b) => String(b.id) === String(id));
      if (!bom) throw new ApiClientError("NOT_FOUND", `BOM ${id} not found`);
      const { lines, ...rest } = bom;
      return delay({ ...rest, lines } as BomWithLines);
    }
    return apiClient.get<BomWithLines>(`/boms/${id}`);
  },

  /** GET /boms/product/:code — latest active BOM for a product */
  async getBomByProduct(productCode: string): Promise<BomWithLines | null> {
    if (isDemoMode()) {
      const bom = demoStore.boms.find((b) => b.productCode === productCode);
      return delay(bom ? ({ ...bom, lines: bom.lines } as BomWithLines) : null);
    }
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
    if (isDemoMode()) {
      const id = demoStore.nextId();
      const lines = payload.lines.map((l, i) => ({
        id: i + 1,
        materialCode: l.materialCode,
        materialNameZh: l.materialCode,
        materialNameEn: l.materialCode,
        materialNameVi: l.materialCode,
        qtyPer: l.qtyPer,
        lossRate: l.lossRate ?? 0,
        referenceDesignators: l.referenceDesignators ?? [],
      }));
      const bom: DemoBom = {
        id, productId: id,
        productCode: payload.productCode,
        productNameZh: payload.productCode,
        productNameEn: payload.productCode,
        productNameVi: payload.productCode,
        revision: payload.revision,
        status: (payload.status ?? "draft") as Bom["status"],
        materialCount: lines.length,
        lineCount: lines.length,
        lines,
      };
      demoStore.addBom(bom);
      return delay({ id });
    }
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
    if (isDemoMode()) {
      const bom = demoStore.boms.find((b) => String(b.id) === String(id));
      if (!bom) throw new ApiClientError("NOT_FOUND", `BOM ${id} not found`);
      if (payload.productCode !== undefined) bom.productCode = payload.productCode;
      if (payload.productNameZh !== undefined) bom.productNameZh = payload.productNameZh;
      if (payload.productNameEn !== undefined) bom.productNameEn = payload.productNameEn;
      if (payload.productNameVi !== undefined) bom.productNameVi = payload.productNameVi;
      if (payload.revision !== undefined) bom.revision = payload.revision;
      if (payload.status !== undefined) bom.status = payload.status as Bom["status"];
      if (payload.lines !== undefined) {
        bom.lines = payload.lines.map((l, i) => ({
          id: i + 1,
          materialCode: l.materialCode,
          chinaMaterialCode: l.chinaMaterialCode ?? "",
          materialCategory: l.materialCategory ?? "",
          materialNameZh: l.name ?? l.materialCode,
          materialNameEn: l.name ?? l.materialCode,
          materialNameVi: l.name ?? l.materialCode,
          spec: l.spec ?? "",
          unit: l.unit ?? "PCS",
          qtyPer: l.qtyPer,
          lossRate: l.lossRate ?? 0,
          referenceDesignators: l.referenceDesignators ?? (l.position ? [l.position] : []),
          position: l.position ?? "",
        }));
        bom.materialCount = bom.lines.length;
        bom.lineCount = bom.lines.length;
      }
      saveBoms(demoStore.boms.slice(_seedBoms.length));
      return delay(undefined);
    }
    await apiClient.patch<MutateEnvelope<unknown>>(`/boms/${id}`, { payload });
  },

  /** PATCH /boms/:id/status */
  async updateBomStatus(id: number | string, status: string): Promise<void> {
    if (isDemoMode()) {
      const bom = demoStore.boms.find((b) => String(b.id) === String(id));
      if (bom) bom.status = status as Bom["status"];
      return delay(undefined);
    }
    await apiClient.patch<MutateEnvelope<unknown>>(`/boms/${id}/status`, {
      payload: { status },
    });
  },

  /** DELETE /boms/:id */
  async deleteBom(id: number | string): Promise<void> {
    if (isDemoMode()) {
      const idx = demoStore.boms.findIndex((b) => String(b.id) === String(id));
      if (idx >= 0) demoStore.boms.splice(idx, 1);
      return delay(undefined);
    }
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
    if (isDemoMode()) {
      const id = demoStore.nextId();
      const bomLines = payload.lines.map((l, i) => ({
        id: i + 1,
        materialCode: l.materialCode,
        chinaMaterialCode: (l as any).chinaMaterialCode ?? "",
        materialCategory: l.materialCategory ?? "",
        materialNameZh: l.name ?? l.materialCode,
        materialNameEn: l.name ?? l.materialCode,
        materialNameVi: l.name ?? l.materialCode,
        spec: l.spec ?? "",
        unit: l.unit ?? "PCS",
        qtyPer: l.qtyPer,
        lossRate: l.lossRate ?? 0,
        referenceDesignators: l.position ? [l.position] : [],
        position: l.position ?? "",
      }));
      const bom: DemoBom = {
        id,
        productId: id,
        productCode: payload.productCode,
        productNameZh: payload.productName ?? payload.productCode,
        productNameEn: payload.productName ?? payload.productCode,
        productNameVi: payload.productName ?? payload.productCode,
        revision: payload.revision ?? "V1.0",
        status: (payload.status ?? "active") as Bom["status"],
        materialCount: bomLines.length,
        lineCount: bomLines.length,
        lines: bomLines,
      };
      demoStore.addBom(bom);
      return delay({ id });
    }
    // Real API would POST to /boms/import
    const res = await apiClient.post<MutateEnvelope<{ id: number | string }>>("/boms/import", { payload });
    return res.item;
  },

  /** GET /boms/:id/export — download BOM as Excel file */
  async exportBomToExcel(id: number | string): Promise<void> {
    const bom = isDemoMode()
      ? demoStore.boms.find((b) => String(b.id) === String(id))
      : null;
    if (!bom) throw new Error(`BOM ${id} not found`);

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
    if (isDemoMode()) {
      return delay(
        demoHistoryStore
          .filter((h) => String(h.bomId) === String(bomId))
          .sort((a, b) => (a.operatedAt < b.operatedAt ? 1 : -1))
      );
    }
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
    if (isDemoMode()) {
      demoHistoryStore.push(entry);
      return delay(entry);
    }
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
    if (isDemoMode()) {
      return delay({
        timestamp: new Date().toISOString(),
        cycle: Date.now(),
        checks: {
          phantom: { status: "fail" as const, count: 8, detail: "BOM#42 BOM#55 引用已停用物料" },
          duplicate: { status: "fail" as const, count: 50, detail: "物料 R1001 在 BOM#12 出现3次" },
          zeroQty: { status: "fail" as const, count: 7, detail: "BOM#38 行12 用量=0" },
          orphan: { status: "fail" as const, count: 16, detail: "BOM#3 BOM#9 无有效父项" },
          costAnomaly: { status: "fail" as const, count: 1, detail: "物料 X002 单价 ¥28,000 异常" },
          missing: { status: "pass" as const, count: 0, detail: "所有 BOM 均已分配产品" },
        },
        totalAnomalies: 82,
      });
    }
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
    if (isDemoMode()) {
      const alerts = [
        { id: "1", type: "phantom", severity: "high", message: "物料 R1001 在 BOM#42 中引用含停用子项", time: new Date(Date.now() - 3600000).toISOString(), resolved: false },
        { id: "2", type: "duplicate", severity: "medium", message: "物料 C2002 在 BOM#12 中重复 3 次", time: new Date(Date.now() - 7200000).toISOString(), resolved: false },
        { id: "3", type: "orphan", severity: "high", message: "BOM#9 无有效父项（孤儿 BOM）", time: new Date(Date.now() - 14400000).toISOString(), resolved: true },
        { id: "4", type: "zeroQty", severity: "medium", message: "BOM#38 行12 用量为 0", time: new Date(Date.now() - 28800000).toISOString(), resolved: false },
        { id: "5", type: "costAnomaly", severity: "low", message: "物料 X002 单价 ¥28,000 超出均值 300%", time: new Date(Date.now() - 86400000).toISOString(), resolved: false },
      ];
      return delay(alerts);
    }
    return apiClient.get("/boms/alerts");
  },
};
