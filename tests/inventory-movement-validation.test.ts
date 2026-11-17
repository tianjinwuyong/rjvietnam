import { describe, expect, it } from "vitest";
import { validateInventoryTransaction } from "../packages/business-rules/src/inventory";

const base = {
  materialLotId: "lot-staging-001",
  quantity: 10,
  operator: "staging-operator",
} as const;

describe("staging inventory movement validation", () => {
  it("requires both endpoints for an internal transfer", () => {
    expect(validateInventoryTransaction({ ...base, action: "TRANSFER" })).toEqual([
      "TRANSFER requires fromLocationCode",
      "TRANSFER requires toLocationCode",
    ]);
    expect(validateInventoryTransaction({
      ...base,
      action: "TRANSFER",
      fromLocationCode: "WH-A-01",
      toLocationCode: "WH-B-01",
    })).toEqual([]);
  });

  it.each(["IQC_HOLD", "MOVE_TO_QUARANTINE", "VENDOR_RETURN"] as const)(
    "%s requires a destination location",
    (action) => {
      expect(validateInventoryTransaction({ ...base, action })).toEqual([
        `${action} requires toLocationCode`,
      ]);
      expect(validateInventoryTransaction({
        ...base,
        action,
        toLocationCode: "QUARANTINE-01",
      })).toEqual([]);
    },
  );
});
