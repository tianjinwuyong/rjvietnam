import { describe, expect, it } from "vitest";
import { receivingActions, receivingState, validateInboundReceiving } from "../packages/business-rules/src/warehouse-receiving";

const base = { scanValue: "MAT-QR-001", materialCode: "CAP-001", lotNo: "LOT-001", quantity: 24, operator: "VN006", qcDecision: "PASS" as const, locationCode: "RAW-A1-1-1" };

describe("warehouse receiving vertical slice", () => {
  it("requires scan, material, lot, quantity and operator", () => {
    const result = validateInboundReceiving({ ...base, scanValue: "", materialCode: "", lotNo: "", quantity: 0, operator: "" });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(["scanValue is required", "materialCode is required", "lotNo is required", "quantity must be greater than 0", "operator is required"]));
  });

  it("does not allow a passed lot to bypass put-away location capture", () => {
    expect(validateInboundReceiving({ ...base, locationCode: "" }).errors).toContain("PASS requires locationCode");
  });

  it("keeps held and failed material out of put-away", () => {
    expect(receivingActions({ ...base, qcDecision: "HOLD", locationCode: "" })).toEqual(["RECEIVE", "IQC_HOLD"]);
    expect(receivingActions({ ...base, qcDecision: "FAIL", locationCode: "" })).toEqual(["RECEIVE", "IQC_REJECT"]);
  });

  it("returns the complete posted ledger sequence for a released lot", () => {
    expect(receivingActions(base)).toEqual(["RECEIVE", "IQC_RELEASE", "PUT_AWAY"]);
    expect(receivingState("PASS")).toMatchObject({ iqcStatus: "released", canPutAway: true });
  });
});
