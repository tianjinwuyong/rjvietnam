import { describe, expect, it } from "vitest";
import {
  type InventoryTransactionDraft,
  validateInventoryTransaction,
} from "../packages/business-rules/src/inventory";

describe("inventory transaction validation — SCRAP", () => {
  // SCRAP is the WMS action for disposing damaged / expired / quarantined material.
  // It must not silently allow negative qty or missing operator / lot.

  it("accepts a minimal valid SCRAP transaction", () => {
    const tx: InventoryTransactionDraft = {
      action: "SCRAP",
      materialLotId: "lot-cap-001",
      quantity: 50,
      operator: "VN_WH_010",
    };
    expect(validateInventoryTransaction(tx)).toEqual([]);
  });

  it("accepts SCRAP with optional fromLocation and reason", () => {
    const tx: InventoryTransactionDraft = {
      action: "SCRAP",
      materialLotId: "lot-cap-001",
      quantity: 120,
      fromLocationCode: "IQC-HOLD-01",
      operator: "VN_WH_010",
    };
    expect(validateInventoryTransaction(tx)).toEqual([]);
  });

  it("rejects SCRAP with non-positive quantity", () => {
    const tx: InventoryTransactionDraft = {
      action: "SCRAP",
      materialLotId: "lot-cap-001",
      quantity: 0,
      operator: "VN_WH_010",
    };
    expect(validateInventoryTransaction(tx)).toContain("quantity must be greater than 0");
  });

  it("rejects SCRAP missing operator", () => {
    const tx: InventoryTransactionDraft = {
      action: "SCRAP",
      materialLotId: "lot-cap-001",
      quantity: 10,
      operator: "",
    };
    expect(validateInventoryTransaction(tx)).toContain("operator is required");
  });

  it("rejects SCRAP missing materialLotId", () => {
    const tx: InventoryTransactionDraft = {
      action: "SCRAP",
      materialLotId: "",
      quantity: 10,
      operator: "VN_WH_010",
    };
    expect(validateInventoryTransaction(tx)).toContain("materialLotId is required");
  });

  it("SCRAP does not require workOrderCode (unlike PICK/ISSUE/RESERVE)", () => {
    const tx: InventoryTransactionDraft = {
      action: "SCRAP",
      materialLotId: "lot-cap-001",
      quantity: 10,
      operator: "VN_WH_010",
    };
    const errors = validateInventoryTransaction(tx);
    expect(errors.some((e) => e.includes("workOrderCode"))).toBe(false);
  });
});
