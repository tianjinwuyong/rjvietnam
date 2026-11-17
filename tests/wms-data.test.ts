import { describe, expect, it } from "vitest";
import type { InventoryAction } from "../packages/business-rules/src/inventory";
import {
  storageLocations,
  materialLots,
  inventoryTransactions,
  poReceiveItems,
  iqcTasks,
  pickOrders,
} from "../apps/web/src/data";

const VALID_IQC_STATUSES = ["pending", "hold", "released", "rejected"] as const;
const VALID_LOCATION_STATUSES = ["active", "full", "inactive", "locked"] as const;
const VALID_PO_RECEIVE_STATUSES = ["pending", "partial", "complete"] as const;
const VALID_IQC_TASK_STATUSES = ["pending", "hold", "passed", "failed"] as const;
const VALID_PICK_ORDER_STATUSES = ["pending", "picking", "picked", "issued", "partial"] as const;
const VALID_INVENTORY_ACTIONS: InventoryAction[] = [
  "RECEIVE", "IQC_RELEASE", "PUT_AWAY", "RESERVE",
  "PICK", "ISSUE_TO_LINE", "RETURN_FROM_LINE", "SCRAP", "ADJUST",
];

const VALID_PRIORITIES = ["urgent", "normal", "low"] as const;
const VALID_PICK_ITEM_STATUSES = ["pending", "picked", "partial"] as const;

// ── Storage Locations ────────────────────────────────────────

describe("storageLocations data integrity", () => {
  it("has at least one entry", () => {
    expect(storageLocations.length).toBeGreaterThan(0);
  });

  it("every entry has a unique code", () => {
    const codes = storageLocations.map((loc) => loc.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every entry has a unique id", () => {
    const ids = storageLocations.map((loc) => loc.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has a valid status", () => {
    for (const loc of storageLocations) {
      expect(VALID_LOCATION_STATUSES).toContain(loc.status);
    }
  });

  it("every entry has a non-empty code", () => {
    for (const loc of storageLocations) {
      expect(loc.code.trim().length).toBeGreaterThan(0);
    }
  });

  it("every entry has non-empty multilingual name", () => {
    for (const loc of storageLocations) {
      expect(loc.name_zh.trim().length).toBeGreaterThan(0);
      expect(loc.name_en.trim().length).toBeGreaterThan(0);
      expect(loc.name_vi.trim().length).toBeGreaterThan(0);
    }
  });

  it("has the iqc-hold area location", () => {
    expect(storageLocations.find((loc) => loc.code === "IQC-HOLD-01")).toBeDefined();
  });

  it("has the reject area location", () => {
    expect(storageLocations.find((loc) => loc.code === "REJECT-01")).toBeDefined();
  });
});

// ── Material Lots ──────────────────────────────────────────

describe("materialLots data integrity", () => {
  it("has at least one entry", () => {
    expect(materialLots.length).toBeGreaterThan(0);
  });

  it("every entry has a unique id", () => {
    const ids = materialLots.map((lot) => lot.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has a valid iqcStatus", () => {
    for (const lot of materialLots) {
      expect(VALID_IQC_STATUSES).toContain(lot.iqcStatus);
    }
  });

  it("every entry has a non-empty lotNo", () => {
    for (const lot of materialLots) {
      expect(lot.lotNo.trim().length).toBeGreaterThan(0);
    }
  });

  it("every entry has non-negative qty", () => {
    for (const lot of materialLots) {
      expect(lot.qty).toBeGreaterThanOrEqual(0);
    }
  });

  it("every entry has non-negative reservedQty", () => {
    for (const lot of materialLots) {
      expect(lot.reservedQty).toBeGreaterThanOrEqual(0);
    }
  });

  it("reservedQty never exceeds qty", () => {
    for (const lot of materialLots) {
      expect(lot.reservedQty ?? 0).toBeLessThanOrEqual(lot.qty ?? 0);
    }
  });

  it("status is never closed or voided for active lots", () => {
    for (const lot of materialLots) {
      expect(["closed", "voided"]).not.toContain(lot.iqcStatus);
    }
  });

  it("iqc hold lots reference the IQC-HOLD location", () => {
    const holdLots = materialLots.filter((lot) => lot.iqcStatus === "hold");
    for (const lot of holdLots) {
      if (lot.locationCode) {
        expect(lot.locationCode).toBe("IQC-HOLD-01");
      }
    }
  });

  it("covers the expected demo IQC statuses", () => {
    const statuses = new Set(materialLots.map((lot) => lot.iqcStatus));
    expect(statuses.has("hold")).toBe(true);
    expect(statuses.has("released")).toBe(true);
    // No "rejected" lots in current demo data
    expect(statuses.size).toBeGreaterThanOrEqual(2);
  });
});

// ── Inventory Transactions ─────────────────────────────────

describe("inventoryTransactions data integrity", () => {
  it("has at least one entry", () => {
    expect(inventoryTransactions.length).toBeGreaterThan(0);
  });

  it("every entry has a unique id", () => {
    const ids = inventoryTransactions.map((tx) => tx.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has a valid action", () => {
    for (const tx of inventoryTransactions) {
      expect(VALID_INVENTORY_ACTIONS).toContain(tx.action);
    }
  });

  it("every entry has a non-empty txNo", () => {
    for (const tx of inventoryTransactions) {
      expect(tx.txNo.trim().length).toBeGreaterThan(0);
    }
  });

  it("every entry has positive or zero qty", () => {
    for (const tx of inventoryTransactions) {
      expect(tx.qty).toBeGreaterThan(0);
    }
  });

  it("every entry has a materialLotId that exists in materialLots", () => {
    const lotIds = new Set(materialLots.map((lot) => lot.id));
    for (const tx of inventoryTransactions) {
      expect(lotIds.has(tx.materialLotId)).toBe(true);
    }
  });

  it("every RECEIVE transaction has toLocation set", () => {
    for (const tx of inventoryTransactions) {
      if (tx.action === "RECEIVE") {
        expect(tx.toLocation).toBeDefined();
        expect(tx.toLocation!.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("every PUT_AWAY transaction has fromLocation and toLocation", () => {
    for (const tx of inventoryTransactions) {
      if (tx.action === "PUT_AWAY") {
        expect(tx.fromLocation).toBeDefined();
        expect(tx.toLocation).toBeDefined();
      }
    }
  });

  it("every PICK transaction has fromLocation", () => {
    for (const tx of inventoryTransactions) {
      if (tx.action === "PICK") {
        expect(tx.fromLocation).toBeDefined();
      }
    }
  });

  it("every ISSUE_TO_LINE transaction has fromLocation and workOrderCode", () => {
    for (const tx of inventoryTransactions) {
      if (tx.action === "ISSUE_TO_LINE") {
        expect(tx.fromLocation).toBeDefined();
        expect(tx.workOrderCode).toBeDefined();
      }
    }
  });

  it("every entry with workOrderCode references a non-empty code", () => {
    for (const tx of inventoryTransactions) {
      if (tx.workOrderCode) {
        expect(tx.workOrderCode.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("covers the main WMS flow actions: RECEIVE, IQC_RELEASE, PUT_AWAY, PICK, ISSUE_TO_LINE", () => {
    const actions = new Set(inventoryTransactions.map((tx) => tx.action));
    expect(actions.has("RECEIVE")).toBe(true);
    expect(actions.has("IQC_RELEASE")).toBe(true);
    expect(actions.has("PUT_AWAY")).toBe(true);
    expect(actions.has("PICK")).toBe(true);
    expect(actions.has("ISSUE_TO_LINE")).toBe(true);
  });

  it("all transactions have valid ISO 8601 dates", () => {
    for (const tx of inventoryTransactions) {
      const d = new Date(tx.occurredAt);
      expect(d.getTime()).not.toBeNaN();
    }
  });
});

// ── PO Receive Items ──────────────────────────────────────

describe("poReceiveItems data integrity", () => {
  it("has entries with various statuses", () => {
    const statuses = new Set(poReceiveItems.map((item) => item.status));
    expect(statuses.size).toBeGreaterThanOrEqual(2);
  });

  it("every entry has a valid status", () => {
    for (const item of poReceiveItems) {
      expect(VALID_PO_RECEIVE_STATUSES).toContain(item.status);
    }
  });

  it("every entry has non-empty poNumber and materialCode", () => {
    for (const item of poReceiveItems) {
      expect((item.poNumber ?? "").trim().length).toBeGreaterThan(0);
      expect((item.materialCode ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("expectedQty is always positive", () => {
    for (const item of poReceiveItems) {
      expect(item.expectedQty).toBeGreaterThan(0);
    }
  });

  it("receivedQty is within expected range", () => {
    for (const item of poReceiveItems) {
      expect(item.receivedQty ?? 0).toBeGreaterThanOrEqual(0);
      expect(item.receivedQty ?? 0).toBeLessThanOrEqual(item.expectedQty ?? 0);
    }
  });

  it("partial and complete items have non-zero receivedQty", () => {
    for (const item of poReceiveItems) {
      if (item.status === "partial" || item.status === "complete") {
        expect(item.receivedQty).toBeGreaterThan(0);
      }
    }
  });
});

// ── IQC Tasks ─────────────────────────────────────────────

describe("iqcTasks data integrity", () => {
  it("has at least one entry", () => {
    expect(iqcTasks.length).toBeGreaterThan(0);
  });

  it("every entry has a valid status", () => {
    for (const task of iqcTasks) {
      expect(VALID_IQC_TASK_STATUSES).toContain(task.status);
    }
  });

  it("every entry has a valid priority", () => {
    for (const task of iqcTasks) {
      expect(VALID_PRIORITIES).toContain(task.priority);
    }
  });

  it("every entry references a materialLotId that exists", () => {
    const lotIds = new Set(materialLots.map((lot) => lot.id));
    for (const task of iqcTasks) {
      expect(lotIds.has(task.materialLotId)).toBe(true);
    }
  });

  it("completed tasks have completedAt set", () => {
    for (const task of iqcTasks) {
      if (task.status === "passed" || task.status === "rejected") {
        expect(task.completedAt).toBeDefined();
        expect(task.completedAt!.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ── Pick Orders ───────────────────────────────────────────

describe("pickOrders data integrity", () => {
  it("has at least one entry", () => {
    expect(pickOrders.length).toBeGreaterThan(0);
  });

  it("every entry has a valid status", () => {
    for (const order of pickOrders) {
      expect(VALID_PICK_ORDER_STATUSES).toContain(order.status);
    }
  });

  it("every entry has a non-empty workOrderCode", () => {
    for (const order of pickOrders) {
      expect(order.workOrderCode.trim().length).toBeGreaterThan(0);
    }
  });

  it("every entry has at least one item", () => {
    for (const order of pickOrders) {
      expect(order.items.length).toBeGreaterThan(0);
    }
  });

  it("every item has a valid status", () => {
    for (const order of pickOrders) {
      for (const item of order.items) {
        expect(VALID_PICK_ITEM_STATUSES).toContain(item.status);
      }
    }
  });

  it("every item has non-empty materialCode and lotNo", () => {
    for (const order of pickOrders) {
      for (const item of order.items) {
        expect((item.materialCode ?? "").trim().length).toBeGreaterThan(0);
        expect((item.lotNo ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("pickedQty never exceeds requiredQty", () => {
    for (const order of pickOrders) {
      for (const item of order.items) {
        expect(item.pickedQty).toBeLessThanOrEqual(item.requiredQty);
      }
    }
  });

  it("completed pick orders have completedAt set", () => {
    for (const order of pickOrders) {
      if (order.status === "issued") {
        expect(order.completedAt).toBeDefined();
        expect(order.completedAt!.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ── Cross-module references ─────────────────────────────────

describe("cross-reference WMS data integrity", () => {
  it("all material lot IDs referenced in transactions exist", () => {
    const lotIds = new Set(materialLots.map((lot) => lot.id));
    for (const tx of inventoryTransactions) {
      expect(lotIds.has(tx.materialLotId))
        .toBe(true);
    }
  });

  it("all IQC task materialLotIds reference existing lots", () => {
    const lotIds = new Set(materialLots.map((lot) => lot.id));
    for (const task of iqcTasks) {
      expect(lotIds.has(task.materialLotId)).toBe(true);
    }
  });

  it("all pick order item lotNos reference existing lots", () => {
    const lotNos = new Set(materialLots.map((lot) => lot.lotNo));
    for (const order of pickOrders) {
      for (const item of order.items) {
        expect(lotNos.has(item.lotNo ?? "")).toBe(true);
      }
    }
  });

  it("storage location codes in transactions reference valid locations", () => {
    const locationCodes = new Set(storageLocations.map((loc) => loc.code));
    for (const tx of inventoryTransactions) {
      if (tx.fromLocation) {
        expect(locationCodes.has(tx.fromLocation)).toBe(true);
      }
      if (tx.toLocation) {
        expect(locationCodes.has(tx.toLocation)).toBe(true);
      }
    }
  });

  it("material lot location codes reference valid storage locations", () => {
    const locationCodes = new Set(storageLocations.map((loc) => loc.code));
    for (const lot of materialLots) {
      if (lot.locationCode) {
        expect(locationCodes.has(lot.locationCode)).toBe(true);
      }
    }
  });
});
