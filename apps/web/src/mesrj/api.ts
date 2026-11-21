// MES-ruijing API 客户端 —— 信封与源系统一致 {success, msg, data}
// （OA 用 {code:0,msg,data} 由 apiClient 剥壳；mesrj 信封不同，独立封装）
import { API_BASE, authStorage } from "../api/client";

export class MesrjApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MesrjApiError";
  }
}

async function requestEnvelope<T>(method: string, path: string, body?: unknown): Promise<{ success?: boolean; msg?: string; data?: T }> {
  const headers: Record<string, string> = {};
  const token = authStorage.getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}/api/mesrj${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new MesrjApiError(`接口 ${path} 返回了非 JSON 内容（HTTP ${res.status}）`);
  }
  const json = (await res.json()) as { success?: boolean; msg?: string; data?: T };
  if (!res.ok || json.success === false) {
    throw new MesrjApiError(json.msg || `HTTP ${res.status}`);
  }
  return json;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const json = await requestEnvelope<T>(method, path, body);
  return (json.data ?? json) as T;
}

export const mesrjApi = {
  get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    let full = path;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== "" && v !== null && v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) full += (path.includes("?") ? "&" : "?") + qs;
    }
    return request<T>("GET", full);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>("POST", path, body);
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>("PUT", path, body);
  },
  del<T>(path: string): Promise<T> {
    return request<T>("DELETE", path);
  },
};

/**
 * 需要拿到后端提示语时用（辅料管控的「回温达标 / 寿命预警」等说明性文案
 * 在信封的 msg 字段里，data 里没有 —— 普通 post 只返回 data，会丢掉）。
 */
export const mesrjMsg = {
  async post<T = unknown>(path: string, body?: unknown): Promise<{ msg: string; data: T }> {
    const json = await requestEnvelope<T>("POST", path, body);
    return { msg: json.msg || "", data: (json.data ?? null) as T };
  },
  async get<T = unknown>(path: string, query?: Record<string, unknown>): Promise<{ msg: string; data: T }> {
    let full = path;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== "" && v !== null && v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) full += (path.includes("?") ? "&" : "?") + qs;
    }
    const json = await requestEnvelope<T>("GET", full);
    return { msg: json.msg || "", data: (json.data ?? null) as T };
  },
  async del<T = unknown>(path: string): Promise<{ msg: string; data: T }> {
    const json = await requestEnvelope<T>("DELETE", path);
    return { msg: json.msg || "", data: (json.data ?? null) as T };
  },
};

// ── 类型（对应后端 mesrj.js 返回结构）────────────────────────────────────────

export interface MesrjPaged<T> {
  total: number;
  page: number;
  size: number;
  rows: T[];
}

export interface MesrjMenuChild {
  code: string;
  name: string;
  perm?: string | null;
}

export interface MesrjMenuGroup {
  code: string;
  name: string;
  perm?: string | null;
  perm_any?: string[] | null;
  children?: MesrjMenuChild[];
}

export type MesrjRow = Record<string, unknown>;
