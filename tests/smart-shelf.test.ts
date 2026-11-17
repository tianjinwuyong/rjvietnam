import { describe, expect, it, beforeEach } from "vitest";
import {
  SmartShelfClient,
  ShelfApiError,
  createMockShelfServer,
  type MockShelfServer,
  type ShelfSlot,
} from "../integrations/smart-shelf/src";

let mock: MockShelfServer;
let client: SmartShelfClient;

beforeEach(() => {
  mock = createMockShelfServer();
  client = new SmartShelfClient({
    baseUrl: "http://mock.local:8093",
    fetchImpl: mock.fetch,
  });
});

describe("SmartShelfClient — LightOnAllEmptyLocation", () => {
  it("lights on (color=1) for an existing shelf", async () => {
    const res = await client.lightOnAllEmptyLocation({
      shelfCode: "L001A",
      color: 1,
    });
    expect(res.Result).toBe("OK");
    expect(res.ErrorCode).toBe("OK");
    expect(mock.state.shelves.get("L001A")?.lightOn).toBe(true);
    expect(mock.state.shelves.get("L001A")?.lightColor).toBe(1);
  });

  it("lights off (color=0) for an existing shelf", async () => {
    await client.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 0 });
    expect(mock.state.shelves.get("L001A")?.lightOn).toBe(false);
    expect(mock.state.shelves.get("L001A")?.lightColor).toBe(0);
  });

  it("throws NG with code 300 when shelf does not exist", async () => {
    await expect(
      client.lightOnAllEmptyLocation({ shelfCode: "NOPE", color: 1 }),
    ).rejects.toMatchObject({ code: "300", endpoint: "/api/shelf/LightOnAllEmptyLocation" });
  });

  it("rejects invalid color — mock returns 400", async () => {
    await expect(
      client.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 2 as unknown as 1 }),
    ).rejects.toBeInstanceOf(ShelfApiError);
  });
});

describe("SmartShelfClient — ShelfIn (入库申请)", () => {
  it("places a label into the first empty slot", async () => {
    const res = await client.shelfIn({
      labelId: "TSN0001",
      shelfCode: "L001A",
      materialCode: "CS001",
      qty: 100,
    });
    expect(res.Result).toBe("OK");
    const shelf = mock.state.shelves.get("L001A")!;
    const filled = shelf.slots.find((s: ShelfSlot) => s.labelId === "TSN0001");
    expect(filled).toBeDefined();
    expect(filled!.locationCode).toBe("L001A-01");
  });

  it("rejects duplicate labelId on same shelf (code 300)", async () => {
    await client.shelfIn({ labelId: "TSN0001", shelfCode: "L001A" });
    await expect(
      client.shelfIn({ labelId: "TSN0001", shelfCode: "L001A" }),
    ).rejects.toMatchObject({ code: "300" });
  });

  it("rejects unknown shelf (code 300)", async () => {
    await expect(
      client.shelfIn({ labelId: "TSN0001", shelfCode: "NOPE" }),
    ).rejects.toMatchObject({ code: "300" });
  });

  it("requires labelId and shelfCode (code 400)", async () => {
    await expect(
      client.shelfIn({ shelfCode: "L001A" } as { labelId: string; shelfCode: string }),
    ).rejects.toMatchObject({ code: "400" });
  });
});

describe("SmartShelfClient — ShelfOut (出库申请)", () => {
  beforeEach(async () => {
    await client.shelfIn({ labelId: "TSN0001", shelfCode: "L001A" });
    await client.shelfIn({ labelId: "TSN0002", shelfCode: "L001A" });
  });

  it("removes listed labels and returns Success:true with default color 3", async () => {
    const res = await client.shelfOut({ labelIdList: ["TSN0001"] });
    expect(res.Result).toBe("OK");
    expect(res.Success).toBe(true);
    const shelf = mock.state.shelves.get("L001A")!;
    expect(shelf.slots.find((s: ShelfSlot) => s.labelId === "TSN0001")).toBeUndefined();
    expect(shelf.slots.find((s: ShelfSlot) => s.labelId === "TSN0002")).toBeDefined();
    expect(shelf.lightOn).toBe(true);
  });

  it("uses explicit color 0 (off) to turn lights off", async () => {
    await client.shelfOut({ labelIdList: ["TSN0001"], color: 0 });
    expect(mock.state.shelves.get("L001A")?.lightOn).toBe(false);
  });

  it("rejects when no listed label exists (code 300)", async () => {
    await expect(
      client.shelfOut({ labelIdList: ["MISSING-1", "MISSING-2"] }),
    ).rejects.toMatchObject({ code: "300" });
  });

  it("rejects empty labelIdList (code 400)", async () => {
    await expect(
      client.shelfOut({ labelIdList: [] }),
    ).rejects.toMatchObject({ code: "400" });
  });
});

describe("SmartShelfClient — InventoryRemoveLable (标签移除)", () => {
  beforeEach(async () => {
    await client.shelfIn({ labelId: "TSN0001", shelfCode: "L001A" });
  });

  it("removes the label and frees the slot", async () => {
    const res = await client.inventoryRemoveLable({ labelId: "TSN0001" });
    expect(res.Result).toBe("OK");
    const shelf = mock.state.shelves.get("L001A")!;
    expect(shelf.slots.find((s: ShelfSlot) => s.labelId === "TSN0001")).toBeUndefined();
    expect(mock.state.removedLabels).toContain("TSN0001");
  });

  it("rejects unknown labelId (code 300)", async () => {
    await expect(
      client.inventoryRemoveLable({ labelId: "DOES-NOT-EXIST" }),
    ).rejects.toMatchObject({ code: "300" });
  });

  it("requires labelId (code 400)", async () => {
    await expect(
      client.inventoryRemoveLable({} as { labelId: string }),
    ).rejects.toMatchObject({ code: "400" });
  });
});

describe("SmartShelfClient — network & envelope errors", () => {
  it("wraps network failures in ShelfApiError with code 500", async () => {
    const badClient = new SmartShelfClient({
      baseUrl: "http://mock.local:8093",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    await expect(
      badClient.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 1 }),
    ).rejects.toMatchObject({ code: "500" });
  });

  it("throws on HTTP 500 from the device", async () => {
    const errClient = new SmartShelfClient({
      baseUrl: "http://mock.local:8093",
      fetchImpl: (async () =>
        new Response("oops", { status: 500, statusText: "Server Error" })) as unknown as typeof fetch,
    });
    await expect(
      errClient.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 1 }),
    ).rejects.toBeInstanceOf(ShelfApiError);
  });

  it("throws on malformed JSON response", async () => {
    const badClient = new SmartShelfClient({
      baseUrl: "http://mock.local:8093",
      fetchImpl: (async () =>
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch,
    });
    await expect(
      badClient.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 1 }),
    ).rejects.toMatchObject({ code: "500" });
  });

  it("throws on envelope missing Result field", async () => {
    const badClient = new SmartShelfClient({
      baseUrl: "http://mock.local:8093",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ErrorCode: "OK", Message: "OK" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch,
    });
    await expect(
      badClient.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 1 }),
    ).rejects.toMatchObject({ code: "500" });
  });
});

describe("SmartShelfClient — client construction", () => {
  it("rejects non-http(s) baseUrl", () => {
    expect(() => new SmartShelfClient({ baseUrl: "ftp://nope" })).toThrow(/http\(s\)/);
  });

  it("strips trailing slashes from baseUrl", async () => {
    const c = new SmartShelfClient({
      baseUrl: "http://mock.local:8093///",
      fetchImpl: mock.fetch,
    });
    await c.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 1 });
    expect(mock.state.log[0].endpoint).toBe(
      "http://mock.local:8093/api/shelf/LightOnAllEmptyLocation",
    );
  });

  it("uses Content-Type application/json and POSTs JSON body", async () => {
    await client.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 1 });
    const entry = mock.state.log[0];
    expect(entry.body).toEqual({ shelfCode: "L001A", color: 1 });
  });

  it("honors a custom timeout", async () => {
    const slow = new SmartShelfClient({
      baseUrl: "http://mock.local:8093",
      fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        })) as unknown as typeof fetch,
      timeoutMs: 50,
    });
    await expect(
      slow.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 1 }),
    ).rejects.toMatchObject({ code: "500" });
  });
});
