import { describe, expect, it } from "vitest";
import { resolveOperator } from "../apps/web/src/aoi/operator";

describe("AOI operator attribution", () => {
  it("takes the operator recorded on the scanned board", () => {
    expect(resolveOperator({ operator: "VN_OP_007" }, "MO_LI_BIN")).toBe("VN_OP_007");
  });

  it("falls back to the signed-in user when the board carries nobody", () => {
    expect(resolveOperator({ operator: "" }, "VN_OP_007")).toBe("VN_OP_007");
    expect(resolveOperator(null, "  VN_OP_007  ")).toBe("VN_OP_007");
  });

  it("never invents an operator", () => {
    // The old code wrote "VN_OP_001" into every MES aoi_inspection event, which
    // framed one worker for boards nobody scanned in under. An empty operator is a
    // visible data gap; a fabricated one is a false record.
    expect(resolveOperator({ operator: "" }, "")).toBe("");
    expect(resolveOperator(null, undefined)).toBe("");
    expect(resolveOperator({ operator: "   " }, null)).toBe("");
  });

  it("agrees between the AOI record and the MES event for one inspection", () => {
    const board = { operator: "VN_OP_007" };
    const signedIn = "MO_LI_BIN";
    const forRecord = resolveOperator(board, signedIn);
    const forEvent = resolveOperator(board, signedIn);
    expect(forRecord).toBe(forEvent);
  });
});
