// ── MES API client for scanner-station ────────────────────────────────────────

const API_BASE = '/api';

// ── Token store — persisted to localStorage so it survives page refresh ────────
const TOKEN_KEY = 'mes_station_token';
const OPERATOR_KEY = 'mes_station_operator';
const STATION_KEY = 'mes_station_code';

function _loadToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function _saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

let _stationToken: string | null = _loadToken();

export function setStationToken(token: string | null): void {
  _stationToken = token;
  _saveToken(token);
}

/** Returns the currently stored token (null if none or expired) */
export function getStationToken(): string | null {
  return _stationToken;
}

export function getStoredOperator(): string | null {
  try { return localStorage.getItem(OPERATOR_KEY); } catch { return null; }
}

export function getStoredStationCode(): string | null {
  try { return localStorage.getItem(STATION_KEY); } catch { return null; }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_stationToken) h['Authorization'] = `Bearer ${_stationToken}`;
  return h;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

interface StationLoginResult {
  token: string;
  user: { id: number; username: string; displayName: string; locale: string; roleKey: string; permissions: string[] };
  expiresAt: string;
}

/** POST /auth/station-login — operator SN + stationCode → JWT */
export async function loginStation(operator: string, stationCode: string): Promise<StationLoginResult> {
  const res = await fetch(`${API_BASE}/auth/station-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator, stationCode }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const result = (data.data ?? data) as StationLoginResult;
  _stationToken = result.token;
  _saveToken(result.token);
  // Persist operator + station so we can re-login on station change
  try {
    localStorage.setItem(OPERATOR_KEY, operator);
    localStorage.setItem(STATION_KEY, stationCode);
  } catch {}
  return result;
}

/** POST /auth/logout — clear token server-side (best-effort) */
export async function logoutStation(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: authHeaders(),
    });
  } catch {}
  setStationToken(null);
  try {
    localStorage.removeItem(OPERATOR_KEY);
    localStorage.removeItem(STATION_KEY);
  } catch {}
}

export interface UpstreamCheckResult {
  hasNg: boolean;
  verdict: 'BLOCK_NG' | 'OK' | 'UNKNOWN';
  mustRepair?: boolean;
  failCount?: number;
  repairStatus?: string;        // 'pending' | 'repaired' | 'scrapped'
  upstreamEvents: Array<{
    id: number;
    result: string;
    stationCode: string;
    sequence_order: number;
    occurredAt: string;
    repairStatus?: string;
  }>;
}

export interface NgDefectPayload {
  sn: string;
  stationCode: string;
  defectCode?: string;
  defectDescription?: string;
  operator?: string;
  lineCode?: string;
}

export interface PostEventPayload {
  stationCode: string;
  pcbSerial: string;
  result: string;
  eventType: string;
  defectCode?: string;
  defectDescription?: string;
  operator?: string;
  workOrderCode?: string;
}

/** POST /mes/events — requires JWT auth */
export async function postStationEvent(payload: PostEventPayload): Promise<unknown> {
  const res = await fetch(`${API_BASE}/mes/events`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ payload }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** GET /mes/events/upstream-check/:pcbSerial?stationCode=X */
export async function getUpstreamCheck(
  pcbSerial: string,
  stationCode: string,
): Promise<UpstreamCheckResult> {
  const res = await fetch(
    `${API_BASE}/mes/events/upstream-check/${encodeURIComponent(pcbSerial)}?stationCode=${encodeURIComponent(stationCode)}`,
  );
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.data ?? data;
}

/** GET /mes/events/upstream-check/:pcbSerial — standalone upstream check for data source SNs */
export async function checkSnUpstream(sn: string): Promise<UpstreamCheckResult | null> {
  try {
    const res = await fetch(
      `${API_BASE}/mes/events/upstream-check/${encodeURIComponent(sn)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.data ?? data) as UpstreamCheckResult;
  } catch {
    return null;
  }
}

/** GET /api/stations — list all stations for the selector */
export async function getStations() {
  const res = await fetch(`${API_BASE}/stations`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.data ?? data.items ?? data;
}

/** SSE subscription to NG_DEFECT broadcasts from all stations */
export function subscribeNgDefect(
  onEvent: (payload: NgDefectPayload) => void,
  stationCode?: string,
): () => void {
  const node = stationCode ? `station_op_${stationCode}` : 'station_op';
  const url = `${API_BASE}/pda/events?node=${node}&types=NG_DEFECT`;
  const es = new EventSource(url);
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'CONNECTED') return;
      if (msg.type === 'NG_DEFECT') {
        onEvent(msg.payload ?? {});
      }
    } catch {
      // ignore parse errors
    }
  };
  return () => es.close();
}

/** Check if MES API is reachable */
export async function checkApiOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** POST /mes/heartbeat/:stationCode — station liveness ping (no auth required) */
export async function postHeartbeat(stationCode: string, operator?: string, lineCode?: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/mes/heartbeat/${encodeURIComponent(stationCode)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator, lineCode }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** GET /wms/work-orders/:code — validate a work order code */
export async function getWorkOrder(code: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${API_BASE}/wms/work-orders/${encodeURIComponent(code)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.data ?? data) as Record<string, unknown>;
  } catch {
    return null;
  }
}
