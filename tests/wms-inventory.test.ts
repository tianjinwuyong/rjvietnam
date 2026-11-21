import { describe, expect, it } from "vitest";
import { validateInventoryTransaction, type InventoryAction } from "../packages/business-rules/src/inventory";

const ALL_ACTIONS: InventoryAction[] = [
  "RECEIVE",
  "IQC_RELEASE",
  "PUT_AWAY",
  "RESERVE",
  "PICK",
  "ISSUE_TO_LINE",
  "RETURN_FROM_LINE",
  "SCRAP",
  "ADJUST",
];

const validTx = {
  materialLotId: "lot-001",
  quantity: 100,
  operator: "VN_WH_010",
};

describe("validateInventoryTransaction", () => {
  it("rejects unsupported actions at the API boundary", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "DELETE_ALL" as InventoryAction,
    });
    expect(errors).toContain("unsupported inventory action");
  });

  // ── Required field validation (applies to all actions) ────────

  it("returns empty errors for a valid RECEIVE transaction", () => {
    expect(
      validateInventoryTransaction({ ...validTx, action: "RECEIVE" }),
    ).toEqual([]);
  });

  it("rejects missing materialLotId for any action", () => {
    for (const action of ALL_ACTIONS) {
      const errors = validateInventoryTransaction({
        ...validTx,
        action,
        materialLotId: "",
      });
      expect(errors).toContain("materialLotId is required");
    }
  });

  it("rejects missing operator for any action", () => {
    for (const action of ALL_ACTIONS) {
      const errors = validateInventoryTransaction({
        ...validTx,
        action,
        operator: "",
      });
      expect(errors).toContain("operator is required");
    }
  });

  it("rejects whitespace-only required identifiers", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "RECEIVE",
      materialLotId: "   ",
      operator: "\t",
    });
    expect(errors).toContain("materialLotId is required");
    expect(errors).toContain("operator is required");
  });

  it("rejects whitespace-only action-specific identifiers", () => {
    expect(validateInventoryTransaction({
      ...validTx,
      action: "RESERVE",
      workOrderCode: "   ",
    })).toContain("RESERVE requires workOrderCode");

    expect(validateInventoryTransaction({
      ...validTx,
      action: "PUT_AWAY",
      toLocationCode: "\t",
    })).toContain("PUT_AWAY requires toLocationCode");

    expect(validateInventoryTransaction({
      ...validTx,
      action: "TRANSFER",
      fromLocationCode: " ",
      toLocationCode: "B02-01-01",
    })).toContain("TRANSFER requires fromLocationCode");
  });

  it("rejects zero quantity for any action", () => {
    for (const action of ALL_ACTIONS) {
      const errors = validateInventoryTransaction({
        ...validTx,
        action,
        quantity: 0,
      });
      expect(errors).toContain("quantity must be greater than 0");
    }
  });

  it("rejects negative quantity for any action", () => {
    for (const action of ALL_ACTIONS) {
      const errors = validateInventoryTransaction({
        ...validTx,
        action,
        quantity: -5,
      });
      expect(errors).toContain("quantity must be greater than 0");
    }
  });

  it("rejects NaN quantity for any action", () => {
    for (const action of ALL_ACTIONS) {
      const errors = validateInventoryTransaction({
        ...validTx,
        action,
        quantity: NaN,
      });
      expect(errors).toContain("quantity must be greater than 0");
    }
  });

  // ── Action-specific validation: RESERVE ─────────────────────

  it("requires workOrderCode for RESERVE", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "RESERVE",
    });
    expect(errors).toContain("RESERVE requires workOrderCode");
  });

  it("accepts RESERVE when workOrderCode is provided", () => {
    expect(
      validateInventoryTransaction({
        ...validTx,
        action: "RESERVE",
        workOrderCode: "26061010008",
      }),
    ).toEqual([]);
  });

  // ── Action-specific validation: PICK ────────────────────────

  it("requires workOrderCode for PICK", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "PICK",
    });
    expect(errors).toContain("PICK requires workOrderCode");
  });

  it("accepts PICK when workOrderCode is provided", () => {
    expect(
      validateInventoryTransaction({
        ...validTx,
        action: "PICK",
        workOrderCode: "26061010008",
      }),
    ).toEqual([]);
  });

  // ── Action-specific validation: ISSUE_TO_LINE ───────────────

  it("requires workOrderCode for ISSUE_TO_LINE", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "ISSUE_TO_LINE",
    });
    expect(errors).toContain("ISSUE_TO_LINE requires workOrderCode");
  });

  it("accepts ISSUE_TO_LINE when workOrderCode is provided", () => {
    expect(
      validateInventoryTransaction({
        ...validTx,
        action: "ISSUE_TO_LINE",
        workOrderCode: "26061010008",
      }),
    ).toEqual([]);
  });

  // ── Action-specific validation: PUT_AWAY ────────────────────

  it("requires toLocationCode for PUT_AWAY", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "PUT_AWAY",
    });
    expect(errors).toContain("PUT_AWAY requires toLocationCode");
  });

  it("accepts PUT_AWAY when toLocationCode is provided", () => {
    expect(
      validateInventoryTransaction({
        ...validTx,
        action: "PUT_AWAY",
        toLocationCode: "A01-01-01",
      }),
    ).toEqual([]);
  });

  // ── Actions that should NOT require workOrderCode ──────────

  it("does NOT require workOrderCode for RECEIVE", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "RECEIVE",
    });
    expect(errors).not.toContain(expect.stringMatching(/requires workOrderCode/));
  });

  it("does NOT require workOrderCode for IQC_RELEASE", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "IQC_RELEASE",
    });
    expect(errors).not.toContain(expect.stringMatching(/requires workOrderCode/));
  });

  it("does NOT require workOrderCode for PUT_AWAY", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "PUT_AWAY",
      toLocationCode: "A01-01-01",
    });
    expect(errors).not.toContain(expect.stringMatching(/requires workOrderCode/));
  });

  it("does NOT require workOrderCode for RETURN_FROM_LINE", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "RETURN_FROM_LINE",
    });
    expect(errors).not.toContain(expect.stringMatching(/requires workOrderCode/));
  });

  it("does NOT require workOrderCode for SCRAP", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "SCRAP",
    });
    expect(errors).not.toContain(expect.stringMatching(/requires workOrderCode/));
  });

  it("does NOT require workOrderCode for ADJUST", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "ADJUST",
    });
    expect(errors).not.toContain(expect.stringMatching(/requires workOrderCode/));
  });

  // ── Actions that do NOT require toLocationCode ─────────────

  it("does NOT require toLocationCode for RECEIVE (warehouse may define default)", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "RECEIVE",
    });
    expect(errors).not.toContain(expect.stringMatching(/toLocationCode/));
  });

  it("does NOT require toLocationCode for PICK", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "PICK",
      workOrderCode: "26061010008",
    });
    expect(errors).not.toContain(expect.stringMatching(/toLocationCode/));
  });

  it("does NOT require toLocationCode for ISSUE_TO_LINE", () => {
    const errors = validateInventoryTransaction({
      ...validTx,
      action: "ISSUE_TO_LINE",
      workOrderCode: "26061010008",
    });
    expect(errors).not.toContain(expect.stringMatching(/toLocationCode/));
  });

  // ── Edge cases ─────────────────────────────────────────────

  it("returns multiple errors for completely empty transaction", () => {
    const errors = validateInventoryTransaction({
      action: "RECEIVE",
      materialLotId: "",
      quantity: 0,
      operator: "",
    });
    expect(errors).toContain("materialLotId is required");
    expect(errors).toContain("operator is required");
    expect(errors).toContain("quantity must be greater than 0");
    expect(errors.length).toBe(3);
  });

  it("accepts valid transaction with all optional fields", () => {
    expect(
      validateInventoryTransaction({
        action: "ISSUE_TO_LINE",
        materialLotId: "lot-pcb-240616",
        quantity: 9600,
        fromLocationCode: "B02-01-01",
        workOrderCode: "26061010008",
        operator: "VN_WH_010",
      }),
    ).toEqual([]);
  });

  // ── Boundary conditions ─────────────────────────────────────

  it("accepts minimum valid quantity (1)", () => {
    expect(
      validateInventoryTransaction({
        ...validTx,
        action: "RECEIVE",
        quantity: 1,
      }),
    ).toEqual([]);
  });

  it("accepts very large quantity", () => {
    expect(
      validateInventoryTransaction({
        ...validTx,
        action: "RECEIVE",
        quantity: 999_999_999,
      }),
    ).toEqual([]);
  });

  // ── All 9 actions: valid minimal form ───────────────────────

  it("accepts valid RECEIVE", () => {
    expect(validateInventoryTransaction({ ...validTx, action: "RECEIVE" })).toEqual([]);
  });

  it("accepts valid IQC_RELEASE", () => {
    expect(validateInventoryTransaction({ ...validTx, action: "IQC_RELEASE" })).toEqual([]);
  });

  it("accepts valid PUT_AWAY with toLocationCode", () => {
    expect(validateInventoryTransaction({
      ...validTx, action: "PUT_AWAY", toLocationCode: "A01-01-01",
    })).toEqual([]);
  });

  it("accepts valid RESERVE with workOrderCode", () => {
    expect(validateInventoryTransaction({
      ...validTx, action: "RESERVE", workOrderCode: "26061010008",
    })).toEqual([]);
  });

  it("accepts valid PICK with workOrderCode", () => {
    expect(validateInventoryTransaction({
      ...validTx, action: "PICK", workOrderCode: "26061010008",
    })).toEqual([]);
  });

  it("accepts valid ISSUE_TO_LINE with workOrderCode", () => {
    expect(validateInventoryTransaction({
      ...validTx, action: "ISSUE_TO_LINE", workOrderCode: "26061010008",
    })).toEqual([]);
  });

  it("accepts valid RETURN_FROM_LINE", () => {
    expect(validateInventoryTransaction({ ...validTx, action: "RETURN_FROM_LINE" })).toEqual([]);
  });

  it("accepts valid SCRAP", () => {
    expect(validateInventoryTransaction({ ...validTx, action: "SCRAP" })).toEqual([]);
  });

  it("accepts valid ADJUST", () => {
    expect(validateInventoryTransaction({ ...validTx, action: "ADJUST" })).toEqual([]);
  });

  it("requires both locations for TRANSFER", () => {
    expect(validateInventoryTransaction({ ...validTx, action: "TRANSFER" })).toEqual([
      "TRANSFER requires fromLocationCode",
      "TRANSFER requires toLocationCode",
    ]);
  });

  it("accepts TRANSFER when source and destination are provided", () => {
    expect(validateInventoryTransaction({
      ...validTx,
      action: "TRANSFER",
      fromLocationCode: "A01-01-01",
      toLocationCode: "B02-01-01",
    })).toEqual([]);
  });

  it("requires a hold location for IQC_HOLD", () => {
    expect(validateInventoryTransaction({ ...validTx, action: "IQC_HOLD" })).toContain(
      "IQC_HOLD requires toLocationCode",
    );
  });

  it("requires a quarantine location for MOVE_TO_QUARANTINE", () => {
    expect(validateInventoryTransaction({ ...validTx, action: "MOVE_TO_QUARANTINE" })).toContain(
      "MOVE_TO_QUARANTINE requires toLocationCode",
    );
  });

  it("requires a return location for VENDOR_RETURN", () => {
    expect(validateInventoryTransaction({ ...validTx, action: "VENDOR_RETURN" })).toContain(
      "VENDOR_RETURN requires toLocationCode",
    );
  });
});
