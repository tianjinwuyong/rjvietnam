import { describe, expect, it } from "vitest";
import { validateInventoryTransaction } from "./inventory";

const base = {
  materialLotId: "LOT-STAGING-001",
  quantity: 10,
  operator: "operator-staging",
};

describe("staging inventory transaction rules", () => {
  it("requires a work order for line issue actions", () => {
    expect(validateInventoryTransaction({ ...base, action: "ISSUE_TO_LINE" })).toContain(
      "ISSUE_TO_LINE requires workOrderCode",
    );
    expect(validateInventoryTransaction({ ...base, action: "ISSUE_TO_LINE", workOrderCode: "WO-STAGING-001" })).toEqual([]);
  });

  it("requires both locations for transfer and a destination for quarantine", () => {
    expect(validateInventoryTransaction({ ...base, action: "TRANSFER" })).toEqual([
      "TRANSFER requires fromLocationCode",
      "TRANSFER requires toLocationCode",
    ]);
    expect(validateInventoryTransaction({ ...base, action: "MOVE_TO_QUARANTINE" })).toContain(
      "MOVE_TO_QUARANTINE requires toLocationCode",
    );
  });

  it("rejects non-positive quantities without touching external systems", () => {
    expect(validateInventoryTransaction({ ...base, action: "RECEIVE", quantity: 0 })).toContain(
      "quantity must be greater than 0",
    );
  });
});
