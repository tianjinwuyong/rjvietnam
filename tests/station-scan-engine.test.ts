import { describe, expect, it } from "vitest";
import { normalizeScannedSerial } from "../apps/station-agent/src/scanEngine";

describe("station-agent scanner normalization", () => {
  it("removes framing whitespace and preserves Unicode identifiers", () => {
    expect(normalizeScannedSerial("  vn-板卡-ß-001\r\n")).toBe("VN-板卡-SS-001");
  });

  it("canonicalizes case so local and MES lookups use one key", () => {
    expect(normalizeScannedSerial("\t pcb-a01-009 \n")).toBe("PCB-A01-009");
  });

  it("returns an empty key for whitespace-only scans", () => {
    expect(normalizeScannedSerial(" \r\n\t ")).toBe("");
  });
});
