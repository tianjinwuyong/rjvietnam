import { describe, expect, it, beforeEach } from "vitest";
import {
  explainWorkOrderCode,
  generateWorkOrderCode,
  getNextSerial,
  isVoidedCode,
  normalizeNumericLineCode,
  resetSerialCounters,
  validateWorkOrderCode,
} from "../packages/business-rules/src/workOrderCoding";

describe("work order coding", () => {
  beforeEach(() => {
    resetSerialCounters();
  });

  // ── Encoding structure (rule 3.1) ────────────────────────────────

  it("generates the 11 digit Vietnam Ruijing SMT code", () => {
    expect(
      generateWorkOrderCode({
        date: new Date("2026-06-16T08:00:00+07:00"),
        workOrderType: 1,
        lineCode: "L001",
        serialNo: 8,
      }),
    ).toBe("26061010008");
  });

  it("rejects non-integer serialNo", () => {
    expect(() =>
      generateWorkOrderCode({
        date: new Date("2026-06-16"),
        workOrderType: 1,
        lineCode: "L001",
        serialNo: -1,
      }),
    ).toThrow("serialNo must be an integer from 1 to 9999");
  });

  // ── Auto serial counter (rule 3.2.3, 3.2.4) ─────────────────────

  it("auto-generates serial when serialNo is omitted", () => {
    const date = new Date("2026-06-16");
    const wo1 = generateWorkOrderCode({ date, workOrderType: 1, lineCode: "L001" });
    expect(wo1).toBe("26061010001"); // first call → serial 0001

    const wo2 = generateWorkOrderCode({ date, workOrderType: 1, lineCode: "L001" });
    expect(wo2).toBe("26061010002"); // second call → serial 0002
  });

  it("keeps separate counters per month+type+line", () => {
    const date = new Date("2026-06-16");
    // Same month, different type
    expect(generateWorkOrderCode({ date, workOrderType: 1, lineCode: "L001" })).toBe("26061010001");
    expect(generateWorkOrderCode({ date, workOrderType: 2, lineCode: "L001" })).toBe("26062010001"); // type 2 starts at 0001
    // Same month, different line
    expect(generateWorkOrderCode({ date, workOrderType: 1, lineCode: "L002" })).toBe("26061020001"); // line 02 starts at 0001
  });

  it("resets counters when month changes (rule 3.2.4)", () => {
    const june = new Date("2026-06-16");
    expect(generateWorkOrderCode({ date: june, workOrderType: 1, lineCode: "L001" })).toBe("26061010001");

    const july = new Date("2026-07-01");
    expect(generateWorkOrderCode({ date: july, workOrderType: 1, lineCode: "L001" })).toBe("26071010001"); // resets to 0001
  });

  it("getNextSerial returns incrementing values per key", () => {
    const date = new Date("2026-06-16");
    expect(getNextSerial(date, 1, "L001")).toBe(1);
    expect(getNextSerial(date, 1, "L001")).toBe(2);
    expect(getNextSerial(date, 2, "L001")).toBe(1); // different type
  });

  // ── Line codes (rule 4.4) ────────────────────────────────────────

  it("normalizes all documented line code formats", () => {
    // Document defines: L001→01, L002→02, L003→03, L004→04, 返工线→99
    expect(normalizeNumericLineCode("L001")).toBe("01");
    expect(normalizeNumericLineCode("L002")).toBe("02");
    expect(normalizeNumericLineCode("L003")).toBe("03");
    expect(normalizeNumericLineCode("L004")).toBe("04");
    expect(normalizeNumericLineCode("L099")).toBe("99");
    expect(normalizeNumericLineCode("SMT-02")).toBe("02");
    expect(normalizeNumericLineCode("99")).toBe("99");
  });

  it("generates codes for all documented production lines", () => {
    const date = new Date("2026-06-16");
    // SMT line (01) -量产 type 1
    expect(generateWorkOrderCode({ date, workOrderType: 1, lineCode: "L001" })).toBe("26061010001");
    // Semi-auto line (02) -量产 type 1
    expect(generateWorkOrderCode({ date, workOrderType: 1, lineCode: "L002" })).toBe("26061020001");
    // Packaging line (03) -量产 type 1
    expect(generateWorkOrderCode({ date, workOrderType: 1, lineCode: "L003" })).toBe("26061030001");
    // Manual line (04) -量产 type 1
    expect(generateWorkOrderCode({ date, workOrderType: 1, lineCode: "L004" })).toBe("26061040001");
    // Rework line (99) -返工 type 3
    expect(generateWorkOrderCode({ date, workOrderType: 3, lineCode: "L099" })).toBe("26063990001");
  });

  it("generates code matching doc example 26063990003 (rule 5.4)", () => {
    const date = new Date("2026-06-16");
    // First call = 0001, second = 0002, third = 0003
    generateWorkOrderCode({ date, workOrderType: 3, lineCode: "L099" });
    generateWorkOrderCode({ date, workOrderType: 3, lineCode: "L099" });
    expect(generateWorkOrderCode({ date, workOrderType: 3, lineCode: "L099" })).toBe("26063990003");
  });

  // ── Validation (rule 3.2.2) ──────────────────────────────────────

  it("validates and explains existing codes", () => {
    expect(validateWorkOrderCode("26061010008")).toBe(true);
    expect(validateWorkOrderCode("WO-26061010008")).toBe(false);
    expect(validateWorkOrderCode("")).toBe(false);
    expect(validateWorkOrderCode("2606101000A")).toBe(false);
    expect(validateWorkOrderCode("260610100081")).toBe(false); // 12 digits
    expect(explainWorkOrderCode("26061010008")).toEqual({
      year: 2026,
      month: 6,
      workOrderType: 1,
      lineCode: "01",
      serialNo: 8,
    });
  });

  it("explains rework line code correctly", () => {
    expect(explainWorkOrderCode("26063990003")).toEqual({
      year: 2026,
      month: 6,
      workOrderType: 3,
      lineCode: "99",
      serialNo: 3,
    });
  });

  // ── Voided code placeholder (rule 3.2.5) ─────────────────────────

  it("isVoidedCode returns false by default", () => {
    expect(isVoidedCode("26061010008")).toBe(false);
    expect(isVoidedCode("26063990003")).toBe(false);
  });
});
