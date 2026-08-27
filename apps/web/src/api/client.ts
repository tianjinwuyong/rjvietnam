// NOTE: backend routes are split:
//   - auth: mounted on `api` router at /api (needs /api prefix)
//   - wms/pmc/mes/boms/hr: mounted on `app` router at / (no /api prefix)
function defaultApiBase(): string {
  if (typeof window !== "undefined" && window.location.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return "http://127.0.0.1:8080";
}

// Local development uses the API on this machine. Factory deployments can
// override it with VITE_API_BASE=http://192.168.6.155:8080.
const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const API_BASE = String(runtimeEnv?.VITE_API_BASE || defaultApiBase()).replace(/\/$/, "");
const API_AUTH_BASE = `${API_BASE}/api`;

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface Envelope<T> {
  data: T;
  meta?: { serverTime: string; [key: string]: unknown };
}

/**
 * Runtime shape after apiClient strips the outer `data` wrapper:
 * HTTP response  `{ data: { items: T[], total }, meta }`
 * → returns       { items: T[], total }
 */
export interface ListEnvelope<T> {
  items: T[];
  total: number;
  /** Compatibility shape used by the older HR endpoints. */
  data?: T[];
  meta?: { serverTime: string; [key: string]: unknown };
}

/**
 * Runtime shape after apiClient strips the outer `data` wrapper:
 * HTTP response  `{ data: { item: T, auditEventId }, meta }`
 * → returns       { item: T, auditEventId }
 */
export interface MutateEnvelope<T> {
  item: T;
  auditEventId?: number;
  meta?: { serverTime: string; [key: string]: unknown };
}

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function getToken(): string | null {
  return sessionStorage.getItem("auth_token");
}

function setToken(token: string) {
  sessionStorage.setItem("auth_token", token);
}

function clearToken() {
  sessionStorage.removeItem("auth_token");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    const contentType = res.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await res.json().catch(() => ({ error: { code: "HTTP_ERROR", message: `HTTP ${res.status}` } }))
      : { error: { code: "HTTP_NON_JSON", message: `接口 ${path} 返回了非 JSON 内容（HTTP ${res.status}）` } };
    const err: ApiError = body.error ?? { code: "HTTP_ERROR", message: `HTTP ${res.status}` };
    throw new ApiClientError(err.code, err.message, err.details);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new ApiClientError("HTTP_NON_JSON", `接口 ${path} 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。`);
  }
  const json: Envelope<T> = await res.json();
  return json.data as T;
}

type QueryValue = string | number | boolean | null | undefined;

function withQuery(path: string, query?: Record<string, unknown>): string {
  if (!query) return path;
  const source =
    query.params && typeof query.params === "object" && !Array.isArray(query.params)
      ? query.params as Record<string, unknown>
      : query;
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(source)) {
    const value = rawValue as QueryValue;
    if (
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
      value !== ""
    ) {
      params.set(key, String(value));
    }
  }
  const encoded = params.toString();
  if (!encoded) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${encoded}`;
}

export const apiClient = {
  get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return request<T>(withQuery(path, query), { method: "GET" });
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: body != null ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      body: body != null ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PUT",
      body: body != null ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
};

export const authStorage = {
  getToken,
  setToken,
  clearToken,
};

export { API_BASE };
