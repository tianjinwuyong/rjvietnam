import { describe, expect, it } from "vitest";
import { advanceInspectionLevel, INITIAL_INSPECTION_LEVEL_COUNTERS, isQrSourceType, nextAfterIqc, nextAfterMrb } from "./iqcDefectLoopRules";

describe("IQC defect loop rules", () => {
  it("accepts exactly the four QR receiving sources", () => {
    expect(["PO_RECEIPT", "LINE_RETURN", "REWORK_RETURN", "SUBCONTRACT_RETURN"].every(isQrSourceType)).toBe(true);
    expect(isQrSourceType("IQC")).toBe(false);
    expect(isQrSourceType("QUARANTINE")).toBe(false);
  });

  it("routes IQC pass to finished goods and fail to defect warehouse", () => {
    expect(nextAfterIqc("PASS")).toBe("FINISHED_GOODS");
    expect(nextAfterIqc("FAIL")).toBe("DEFECT_WAREHOUSE");
  });

  it("only routes MRB rework back through QR receiving", () => {
    expect(nextAfterMrb("REWORK")).toBe("QR_RECEIVING");
    expect(nextAfterMrb("SCRAP")).toBe("SCRAP");
    expect(nextAfterMrb("VENDOR_RETURN")).toBe("SUPPLIER_RETURN");
  });

  it("applies automatic five/ten-batch transitions and manual gates", () => {
    let level: any = "NORMAL";
    let counters = { ...INITIAL_INSPECTION_LEVEL_COUNTERS };
    for (const result of ["PASS", "PASS", "PASS", "FAIL", "FAIL"] as const) ({ level, counters } = advanceInspectionLevel(level, counters, { type: "RESULT", result }));
    expect(level).toBe("TIGHTENED");
    for (let i = 0; i < 5; i += 1) ({ level, counters } = advanceInspectionLevel(level, counters, { type: "RESULT", result: "PASS" }));
    expect(level).toBe("NORMAL");
    for (let i = 0; i < 10; i += 1) ({ level, counters } = advanceInspectionLevel(level, counters, { type: "RESULT", result: "PASS" }));
    expect(level).toBe("REDUCED");
    for (let i = 0; i < 10; i += 1) ({ level, counters } = advanceInspectionLevel(level, counters, { type: "RESULT", result: "PASS" }));
    expect(advanceInspectionLevel(level, counters, { type: "EXEMPT_APPROVED" }).level).toBe("EXEMPT");
  });

  it("requires manual recovery from suspended and manual abnormal returns", () => {
    let level: any = "TIGHTENED";
    let counters = { ...INITIAL_INSPECTION_LEVEL_COUNTERS };
    for (let i = 0; i < 5; i += 1) ({ level, counters } = advanceInspectionLevel(level, counters, { type: "RESULT", result: "FAIL" }));
    expect(level).toBe("SUSPENDED");
    expect(advanceInspectionLevel(level, counters, { type: "SUPPLIER_IMPROVEMENT_CONFIRMED" }).level).toBe("TIGHTENED");
    expect(advanceInspectionLevel("EXEMPT", counters, { type: "ABNORMAL_RETURN_TO_NORMAL" }).level).toBe("NORMAL");
  });

  it("requires five consecutive accepts in tightened inspection", () => {
    let counters = { ...INITIAL_INSPECTION_LEVEL_COUNTERS, tightenedAccepts: 4, tightenedRejects: 0 };
    const interrupted = advanceInspectionLevel("TIGHTENED", counters, { type: "RESULT", result: "FAIL" });
    expect(interrupted.level).toBe("TIGHTENED");
    expect(interrupted.counters.tightenedAccepts).toBe(0);
    counters = interrupted.counters;
    for (let i = 0; i < 4; i += 1) ({ counters } = advanceInspectionLevel("TIGHTENED", counters, { type: "RESULT", result: "PASS" }));
    expect(advanceInspectionLevel("TIGHTENED", counters, { type: "RESULT", result: "PASS" }).level).toBe("NORMAL");
  });
});
