import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loginStation } from './mesApi';

// The server demands x-station-key exactly when STATION_LOGIN_KEY is configured,
// so the client half of that contract has two parts: a provisioned terminal must
// present the key, and an unprovisioned one must send no header at all. An empty
// header would read as a wrong key (STATION_KEY_INVALID) instead of what it is
// (STATION_KEY_MISSING), and the floor would be told its key is bad when nothing
// was ever installed.

type Call = { url: string; init: RequestInit };

// mesApi.ts declares __STATION_AGENT__ with `declare global`, which is the
// contract the terminal image writes against; that declaration is why these
// assignments need no cast here.
const provision = (stationKey: string) => {
  globalThis.__STATION_AGENT__ = { stationKey };
};

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

const captureFetch = () => {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse({
      data: { token: 'jwt-from-station-login', expiresAt: '2026-11-21T00:00:00Z', user: { id: 1, roleKey: 'material_receiver' } },
    });
  });
  return calls;
};

const stationLoginCall = (calls: Call[]) => calls.find((entry) => entry.url.endsWith('/auth/station-login'));

const headerOf = (call: Call | undefined, name: string) => {
  const headers = (call?.init?.headers ?? {}) as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(headers, name) ? headers[name] : undefined;
};

describe('station login presents the device credential', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__STATION_AGENT__;
  });

  it('sends the injected station key', async () => {
    const calls = captureFetch();
    provision('terminal-provisioned-key');

    await loginStation('VN_MATERIAL_RECEIVER', 'AC-CABLE-01');

    const call = stationLoginCall(calls);
    expect(call).toBeTruthy();
    expect(headerOf(call, 'x-station-key')).toBe('terminal-provisioned-key');
    expect(JSON.parse(String(call!.init.body))).toEqual({ operator: 'VN_MATERIAL_RECEIVER', stationCode: 'AC-CABLE-01' });
  });

  it('sends no station header when the terminal was never provisioned', async () => {
    const calls = captureFetch();

    await loginStation('VN_MATERIAL_RECEIVER', 'AC-CABLE-01');

    const call = stationLoginCall(calls);
    expect(headerOf(call, 'x-station-key')).toBeUndefined();
    expect(headerOf(call, 'Content-Type')).toBe('application/json');
  });

  it('falls back to sessionStorage when nothing was injected', async () => {
    const calls = captureFetch();
    vi.stubGlobal('sessionStorage', { getItem: (name: string) => (name === 'station_key' ? 'key-from-session' : null) });

    await loginStation('VN_MATERIAL_RECEIVER', 'AC-CABLE-01');

    expect(headerOf(stationLoginCall(calls), 'x-station-key')).toBe('key-from-session');
  });

  it('prefers the provisioned value over a stale session one', async () => {
    // Both exist on a terminal that was re-provisioned while a tab still holds the
    // previous key; the image is the authority, or the scanner keeps sending the
    // key the factory rotated away.
    const calls = captureFetch();
    provision('current-key');
    vi.stubGlobal('sessionStorage', { getItem: (name: string) => (name === 'station_key' ? 'stale-key' : null) });

    await loginStation('VN_MATERIAL_RECEIVER', 'AC-CABLE-01');

    expect(headerOf(stationLoginCall(calls), 'x-station-key')).toBe('current-key');
  });
});
