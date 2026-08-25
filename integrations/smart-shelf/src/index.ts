export type ShelfOutColor = 0 | 1 | 3 | 4 | 5 | 6 | 7;
export type ShelfSlot = { locationCode?: string; labelId?: string | null; materialCode?: string; qty?: number };
export type ShelfRecord = { code: string; slots: ShelfSlot[]; lightOn: boolean; lightColor: number };
export type MockShelfState = {
  shelves: Map<string, ShelfRecord>;
  removedLabels: string[];
  log: Array<{ endpoint: string; body: Record<string, unknown> }>;
};
export type MockShelfServer = { fetch: typeof fetch; state: MockShelfState; reset: () => void; close: () => void };
export type ShelfApiResponse = { Result: "OK" | "NG"; ErrorCode: string; Message: string; Success?: boolean; [key: string]: unknown };
export type ShelfOutApiResponse = ShelfApiResponse & { Success?: boolean };

export class ShelfApiError extends Error {
  constructor(message: string, public code = "500", public endpoint = "") { super(message); this.name = "ShelfApiError"; }
}

export class SmartShelfClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
    const baseUrl = config.baseUrl ?? "http://127.0.0.1:8093";
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error("Smart shelf baseUrl must use http(s)");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  async connect() { await this.getStatus(); }
  async disconnect() {}
  async getStatus() { return { connected: true }; }
  async getShelf(_id: string) { return null; }
  async setLeds(shelfId: string, leds: Array<{ color?: number }>) {
    await this.lightOnAllEmptyLocation({ shelfCode: shelfId, color: (leds[0]?.color ?? 0) as 0 | 1 | 3 });
  }
  lightOnAllEmptyLocation(body: { shelfCode: string; color: 0 | 1 | 3 }) { return this.post("LightOnAllEmptyLocation", body); }
  shelfIn(body: { labelId: string; shelfCode: string; materialCode?: string; qty?: number }) { return this.post("ShelfIn", body); }
  shelfOut(body: { labelIdList: string[]; color?: number }) { return this.post("ShelfOut", body); }
  inventoryRemoveLable(body: { labelId: string }) { return this.post("InventoryRemoveLable", body); }

  private async post(path: string, body: object): Promise<ShelfApiResponse> {
    const endpoint = `/api/shelf/${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
      });
      if (!response.ok) throw new ShelfApiError(`Shelf HTTP ${response.status}`, String(response.status), endpoint);
      let data: ShelfApiResponse;
      try { data = await response.json() as ShelfApiResponse; }
      catch { throw new ShelfApiError("Invalid shelf JSON response", "500", endpoint); }
      if (!data || !["OK", "NG"].includes(data.Result)) throw new ShelfApiError("Invalid shelf response envelope", "500", endpoint);
      if (data.Result === "NG") throw new ShelfApiError(data.Message || "Shelf rejected request", data.ErrorCode || "500", endpoint);
      return data;
    } catch (error) {
      if (error instanceof ShelfApiError) throw error;
      throw new ShelfApiError(error instanceof Error ? error.message : "Shelf request failed", "500", endpoint);
    } finally { clearTimeout(timer); }
  }
}

export function createMockShelfServer(): MockShelfServer {
  const makeState = (): MockShelfState => ({
    shelves: new Map(["L001A", "L001B", "L002A", "L002B"].map(code => [code, {
      code,
      slots: Array.from({ length: 8 }, (_, i) => ({ locationCode: `${code}-${String(i + 1).padStart(2, "0")}` })),
      lightOn: false, lightColor: 0,
    }])), removedLabels: [], log: [],
  });
  let state = makeState();
  const envelope = (Result: "OK" | "NG", ErrorCode = "OK", Message = "OK", extra = {}) =>
    new Response(JSON.stringify({ Result, ErrorCode, Message, ...extra }), { status: 200, headers: { "Content-Type": "application/json" } });
  const mock = {
    get state() { return state; },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = String(input); let body: Record<string, any> = {};
      try { body = JSON.parse(String(init?.body ?? "{}")); } catch { return envelope("NG", "400", "Invalid JSON"); }
      state.log.push({ endpoint, body });
      const action = endpoint.split("/").pop();
      if (action === "LightOnAllEmptyLocation") {
        const shelf = state.shelves.get(body.shelfCode);
        if (!shelf) return envelope("NG", "300", "Shelf not found");
        if (![0, 1, 3].includes(body.color)) return envelope("NG", "400", "Invalid color");
        shelf.lightColor = body.color; shelf.lightOn = body.color !== 0; return envelope("OK");
      }
      if (action === "ShelfIn") {
        if (!body.labelId || !body.shelfCode) return envelope("NG", "400", "labelId and shelfCode required");
        const shelf = state.shelves.get(body.shelfCode);
        if (!shelf) return envelope("NG", "300", "Shelf not found");
        if ([...state.shelves.values()].some(s => s.slots.some(x => x.labelId === body.labelId))) return envelope("NG", "300", "Duplicate label");
        const slot = shelf.slots.find(x => !x.labelId); if (!slot) return envelope("NG", "300", "Shelf full");
        Object.assign(slot, { labelId: body.labelId, materialCode: body.materialCode, qty: body.qty }); return envelope("OK");
      }
      if (action === "ShelfOut") {
        if (!Array.isArray(body.labelIdList) || body.labelIdList.length === 0) return envelope("NG", "400", "labelIdList required");
        let found = false;
        for (const shelf of state.shelves.values()) for (const slot of shelf.slots) if (body.labelIdList.includes(slot.labelId)) {
          found = true; delete slot.labelId; delete slot.materialCode; delete slot.qty;
          shelf.lightColor = body.color ?? 3; shelf.lightOn = shelf.lightColor !== 0;
        }
        return found ? envelope("OK", "OK", "OK", { Success: true }) : envelope("NG", "300", "Label not found");
      }
      if (action === "InventoryRemoveLable") {
        if (!body.labelId) return envelope("NG", "400", "labelId required");
        for (const shelf of state.shelves.values()) for (const slot of shelf.slots) if (slot.labelId === body.labelId) {
          delete slot.labelId; delete slot.materialCode; delete slot.qty; state.removedLabels.push(body.labelId); return envelope("OK");
        }
        return envelope("NG", "300", "Label not found");
      }
      return new Response("", { status: 404 });
    }) as typeof fetch,
    reset: () => { state = makeState(); }, close: () => {},
  };
  return mock;
}
