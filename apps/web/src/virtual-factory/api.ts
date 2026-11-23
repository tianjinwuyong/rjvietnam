// Data access for the virtual factory scene.
// Relative /api URLs: the standalone vite dev server proxies them to 127.0.0.1:8080,
// and a future console embed is same-origin behind nginx — no base-URL rework needed.

import type { TickerEvent, TickerKind, VirtualEmployee } from "./types";

/** Bootstrap a dev JWT with the documented seeded dev credentials (standalone entry only). */
export async function loginDev(apiBase = ""): Promise<string> {
  const res = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Factory@123" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  const token: unknown = payload?.data?.token ?? payload?.token;
  if (typeof token !== "string" || !token) throw new Error("no token in login response");
  return token;
}

export async function fetchEmployees(token: string, apiBase = ""): Promise<VirtualEmployee[]> {
  const res = await fetch(`${apiBase}/api/factory/virtual-employees`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  const items: unknown = payload?.data?.items;
  if (!Array.isArray(items)) throw new Error("unexpected payload shape");
  return items as VirtualEmployee[];
}

let eventSeq = 0;

function event(kind: TickerKind, key: string, vars?: Record<string, string | number>, employeeId?: string): TickerEvent {
  return { id: ++eventSeq, at: Date.now(), kind, key, vars, employeeId };
}

function displayName(emp: VirtualEmployee): string {
  return emp.display_name || emp.name || emp.id;
}

/**
 * Narrate the delta between two polls as locale-independent events (key + raw vars).
 * Only meaningful changes produce ticker lines (task deltas, approvals, mode/status/shift changes).
 */
export function diffEmployees(prev: VirtualEmployee[], next: VirtualEmployee[]): TickerEvent[] {
  const out: TickerEvent[] = [];
  const before = new Map(prev.map(e => [e.id, e]));
  for (const emp of next) {
    const old = before.get(emp.id);
    const name = displayName(emp);
    if (!old) {
      if (emp.enabled !== false) out.push(event("info", "ticker.enabled", { name }));
      continue;
    }
    const openDelta = Number(emp.taskCounts?.OPEN ?? 0) - Number(old.taskCounts?.OPEN ?? 0);
    const waitDelta = Number(emp.taskCounts?.WAITING_APPROVAL ?? 0) - Number(old.taskCounts?.WAITING_APPROVAL ?? 0);
    const doneDelta = Number(emp.taskCounts?.DONE ?? 0) - Number(old.taskCounts?.DONE ?? 0);
    if (openDelta > 0) out.push(event("task", "ticker.newOpen", { name, n: openDelta }, emp.id));
    if (waitDelta > 0) out.push(event("approval", "ticker.approval", { name, n: waitDelta }, emp.id));
    if (doneDelta > 0) out.push(event("task", "ticker.done", { name, n: doneDelta }, emp.id));
    if (emp.mode !== old.mode) {
      out.push(event("mode", "ticker.modeChanged", { name, mode: emp.mode ?? "" }, emp.id));
    }
    if (emp.status !== old.status) {
      out.push(event("status", "ticker.statusChanged", { name, status: emp.status ?? "" }, emp.id));
    }
    if (emp.enabled !== old.enabled) {
      out.push(event("info", emp.enabled === false ? "ticker.disabled" : "ticker.enabled", { name }, emp.id));
    }
  }
  return out;
}

export function connectedEvent(count: number): TickerEvent {
  return event("info", "ticker.connected", { n: count });
}
