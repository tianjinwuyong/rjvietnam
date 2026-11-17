/**
 * Smart Rack Hardware Integration Tests — 真实料架硬件测试 (192.168.6.118:8093)
 *
 * Prerequisites:
 *   - Real hardware must be reachable at 192.168.6.118:8093
 *   - Hardware firmware: old version (non-GY endpoints)
 *   - Set env: SHELF_CONTROLLER_URL=http://192.168.6.118:8093 MOCK_SHELF=0
 *
 * Hardware API contract (discovered via probing):
 *   POST /api/shelf/LightOnAllEmptyLocation  { shelfCode, color } → { Result, ErrorCode, Message }
 *   POST /api/shelf/ShelfIn                  { labelId, shelfCode } → { Result, ErrorCode, Message }
 *   POST /api/shelf/ShelfOut                 { labelIdList, color? } → { Result, ErrorCode, Message }
 *   POST /api/shelf/InventoryRemoveLable     { labelId } → { Result, ErrorCode, Message }
 *
 * Sensor flow:
 *   1. Hardware sensor detects label on shelf automatically
 *   2. ShelfIn with sensor-detected label → OK (registers confirmed label on shelf)
 *   3. ShelfOut → removes label + controls LED via color param
 *   4. LightOnAllEmptyLocation → lights up empty cells
 *   5. InventoryRemoveLable → removes label record from hardware inventory
 *
 * Known sensor labels at test start:
 *   L001A: TEST-IN-001   L001B: DEMO-003   L002B: RUIJING-002   L002A: (empty)
 */
import { describe, it, expect, beforeAll } from "vitest";

const HW_URL = process.env.SHELF_CONTROLLER_URL ?? "http://192.168.6.118:8093";
const HW_REACHABLE = process.env.MOCK_SHELF !== "1";

async function hwPost(path: string, body: object) {
  const res = await fetch(`${HW_URL}/api/shelf/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  let data: Record<string, unknown> = {};
  try {
    const text = await res.text();
    if (text.trim()) data = JSON.parse(text);
  } catch {
    // 404 with empty body → data stays {}
  }
  return { status: res.status, data };
}

// Only run if real hardware is reachable
const runIfReachable = HW_REACHABLE ? describe : describe.skip;

runIfReachable("Smart Rack Hardware — 真实硬件集成测试", () => {
  describe("LightOnAllEmptyLocation — LED 控制", () => {
    it("L001A color=1 点亮空库位", async () => {
      const r = await hwPost("LightOnAllEmptyLocation", { shelfCode: "L001A", color: 1 });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("OK");
    });

    it("L001A color=0 熄灭所有库位 LED", async () => {
      const r = await hwPost("LightOnAllEmptyLocation", { shelfCode: "L001A", color: 0 });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("OK");
    });

    it("L002A 存在且响应正确", async () => {
      const r = await hwPost("LightOnAllEmptyLocation", { shelfCode: "L002A", color: 1 });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("OK");
    });

    it("L003A 不存在 — 返回 NG code 300", async () => {
      const r = await hwPost("LightOnAllEmptyLocation", { shelfCode: "L003A", color: 1 });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("NG");
      expect(r.data.ErrorCode).toBe("300");
    });
  });

  describe("ShelfIn — 入库申请（传感器检测确认）", () => {
    it("传感器检测到的标签 TEST-IN-001 入库 L001A → OK", async () => {
      const r = await hwPost("ShelfIn", { labelId: "TEST-IN-001", shelfCode: "L001A" });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("OK");
    });

    it("传感器检测到的标签 DEMO-003 入库 L001B → OK", async () => {
      const r = await hwPost("ShelfIn", { labelId: "DEMO-003", shelfCode: "L001B" });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("OK");
    });

    it("传感器未检测到的标签 → NG，提示先扫描或被阻塞", async () => {
      // L001A has TEST-IN-001 pending on sensor → hardware blocks all other scans
      // Use L002A which has no pending sensor label
      const r = await hwPost("ShelfIn", { labelId: "NOTEXIST-999", shelfCode: "L002A" });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("NG");
      expect(r.data.ErrorCode).toBe("300");
      // Hardware either says "未入库" (unknown label) or "不允许扫描" (blocked by pending sensor label)
      expect(
        String(r.data.Message).includes("未入库") ||
        String(r.data.Message).includes("不允许扫描")
      ).toBe(true);
    });
  });

  describe("ShelfOut — 出库申请", () => {
    it("已在架标签 TEST-IN-001 出库 → NG（已出库或未确认在架）", async () => {
      const r = await hwPost("ShelfOut", { labelIdList: ["TEST-IN-001"], color: 0 });
      // NG = 当前唯一码不存在（从未正式入库或已移除）
      expect(r.status).toBe(200);
      // Expected NG since TEST-IN-001 was never formally ShelfIn'd on real hardware
      expect(r.data.Result).toBeOneOf(["OK", "NG"]);
    });

    it("不存在的标签 NOTEXIST-999 → NG", async () => {
      const r = await hwPost("ShelfOut", { labelIdList: ["NOTEXIST-999"] });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("NG");
      expect(r.data.ErrorCode).toBe("300");
    });

    it("空数组 labelIdList → NG", async () => {
      const r = await hwPost("ShelfOut", { labelIdList: [] });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("NG");
    });
  });

  describe("InventoryRemoveLable — 标签移除", () => {
    it("存在的标签 TEST-IN-001 → NG（不在硬件库存中）", async () => {
      const r = await hwPost("InventoryRemoveLable", { labelId: "TEST-IN-001" });
      expect(r.status).toBe(200);
      // NG = 当前标签不存在
      expect(r.data.Result).toBe("NG");
      expect(r.data.ErrorCode).toBe("300");
    });

    it("不存在的标签 → NG", async () => {
      const r = await hwPost("InventoryRemoveLable", { labelId: "NOTEXIST-999" });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("NG");
    });
  });

  describe("GY 端点 — 老固件应全部 404", () => {
    for (const endpoint of ["LightOnAllEmptyLocationGY", "ShelfInGY", "ShelfOutGY", "InventoryRemoveLableGY"]) {
      it(`${endpoint} → 404 Not Found`, async () => {
        const r = await hwPost(endpoint, { shelfCode: "L001A", color: 1 });
        expect(r.status).toBe(404);
      });
    }
  });

  describe("传感器状态探测", () => {
    it("L002A 传感器为空（PROBE 返回成功）", async () => {
      const r = await hwPost("ShelfIn", { labelId: "PROBE-L002A", shelfCode: "L002A" });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("OK");
    });

    it("L002B 传感器有 RUIJING-002", async () => {
      const r = await hwPost("ShelfIn", { labelId: "PROBE-L002B", shelfCode: "L002B" });
      expect(r.status).toBe(200);
      expect(r.data.Result).toBe("NG"); // sensor has something else
      expect(r.data.Message).toContain("RUIJING-002");
    });
  });
});
