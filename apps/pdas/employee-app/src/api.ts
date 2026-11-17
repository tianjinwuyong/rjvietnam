const API = "http://10.0.2.2:8080";

export function getToken(): string | null {
  return sessionStorage.getItem("emp_token");
}

export function setToken(token: string | null) {
  if (token) sessionStorage.setItem("emp_token", token);
  else sessionStorage.removeItem("emp_token");
}

export function getUsername(): string {
  return sessionStorage.getItem("emp_username") ?? "";
}

export function setUsername(name: string) {
  sessionStorage.setItem("emp_username", name);
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers as Record<string, string>),
    },
  });
  if (res.status === 401) {
    setToken(null);
    throw new Error("unauthorized");
  }
  const body = await res.json();
  if (!body.success && !body.data) throw new Error(body.error ?? body.message ?? "API error");
  return (body.data ?? body) as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

export default api;
