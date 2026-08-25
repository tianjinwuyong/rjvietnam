// Smart Shelf API client
//
// All endpoints hit the Express app router at /wms/shelf/*
// Auth token is read from localStorage via apiClient.
// MOCK_SHELF=1 env var activates in-memory mock on the server side.

import { apiClient } from "../api/client";

export const SHELF_API_BASE = ""; // Uses same origin as app

export type ShelfResult = {
  success: boolean;
  Result?: "OK" | "NG";
  ErrorCode?: string;
  Message?: string;
  error?: string;
  shelfCode?: string;
  labelId?: string;
  cellNumber?: string;
};

async function post<TBody>(path: string, body: TBody): Promise<ShelfResult> {
  try {
    const res = await apiClient.post<ShelfResult>(path, body);
    return res;
  } catch (err) {
    return {
      success: false,
      ErrorCode: "NETWORK",
      Message: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ── GET: Rack status & cell data ──────────────────────────────────

/** 料架总体状态（各料架占用/空置数量） */
export async function fetchRackStatus(shelfCode?: string) {
  const qs = shelfCode ? `?shelfCode=${shelfCode}` : "";
  return apiClient.get<{ racks: { rows: RackSummaryRow[] } }>(`/wms/shelf/rack-status${qs}`);
}

/** 单个料架完整库位网格 */
export async function fetchRackCells(shelfCode: string) {
  return apiClient.get<RackCellApiResponse>(`/wms/shelf/rack-cells/${shelfCode}`);
}

/** 查找某物料在料架上的批次 */
export async function fetchMaterialLotsOnRack(materialCode: string, shelfCode?: string) {
  const qs = new URLSearchParams({ materialCode });
  if (shelfCode) qs.set("shelfCode", shelfCode);
  return apiClient.get<{ success: boolean; data: { items: MaterialLotOnRack[] } }>(`/wms/shelf/material-lots?${qs}`);
}

/** 料架事务历史 */
export async function fetchRackTransactions(params: { shelfCode?: string; action?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params.shelfCode) qs.set("shelfCode", params.shelfCode);
  if (params.action) qs.set("action", params.action);
  if (params.limit) qs.set("limit", String(params.limit));
  return apiClient.get<{ success: boolean; data: { items: RackTransaction[]; total: number } }>(`/wms/shelf/rack-transactions?${qs}`);
}

// ── POST: Rack operations ─────────────────────────────────────────

/** 点亮料架库位 LED */
export function lightEmptyLocations(shelfCode: string, turnOn: boolean) {
  return post("/wms/shelf/rack-light", {
    shelfCode,
    color: turnOn ? 1 : 0,
  });
}

/** 点亮指定库位 */
export function lightCell(shelfCode: string, cellNumber: string, color: number, operator?: string) {
  return post("/wms/shelf/rack-light", {
    shelfCode,
    cellNumber,
    color,
    operator,
  });
}

/** 料架入库 — 将卷盘放入料架 */
export function shelfIn(opts: { shelfCode: string; cellNumber?: string; labelId: string; materialCode?: string; lotNo?: string; qty?: number; operator?: string }) {
  return post("/wms/shelf/rack-in", opts);
}

/** 料架出库 — 从料架取出卷盘 */
export function shelfOut(opts: { labelId: string; shelfCode?: string; operator?: string }) {
  return post("/wms/shelf/rack-out", opts);
}

// ── Types ──────────────────────────────────────────────────────────

export type RackSummaryRow = {
  shelf_code: string;
  total_cells: number;
  occupied_cells: number;
  empty_cells: number;
  reserved_cells: number;
  fault_cells: number;
  material_codes: string[] | null;
};

export type RackCellApiResponse = {
  shelfCode: string;
  totalCells: number;
  occupiedCells: number;
  emptyCells: number;
  cells: { rows: RackCellRow[] };
};

export type RackCellRow = {
  cell_number: string;
  cell_status: string;
  last_light_cmd: number | null;
  last_light_at: string | null;
  labelId: string | null;
  materialCode: string | null;
  materialNameZh: string | null;
  lotNo: string | null;
  qty: number | null;
  storageCode: string | null;
};

export type MaterialLotOnRack = {
  shelfCode: string;
  cellNumber: string;
  lotNo: string;
  labelId: string;
  qty: number;
  materialCode: string;
  materialNameZh: string;
  ledColor: number | null;
};

export type RackTransaction = {
  id: string;
  label_id: string;
  shelf_code: string;
  cell_number: string;
  action: string;
  material_code: string | null;
  lot_no: string | null;
  qty: number | null;
  operator_id: string | null;
  operator_name: string | null;
  created_at: string;
  operatorDisplayName?: string;
};
