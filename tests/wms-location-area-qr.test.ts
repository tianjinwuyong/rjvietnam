import { describe, expect, it } from "vitest";
import { __test_only_areaQrFor } from "../apps/web/src/wms/WmsLocationManagement";

const areaQrFor = __test_only_areaQrFor;

describe("areaQrFor — warehouse canvas area QR", () => {
  it("returns the canonical WMS-AREA:<UPPER> format with no position suffix", () => {
    expect(areaQrFor("test14")).toBe("WMS-AREA:TEST14");
    expect(areaQrFor("test6")).toBe("WMS-AREA:TEST6");
    expect(areaQrFor("RECV-TEST")).toBe("WMS-AREA:RECV-TEST");
  });

  it("strips an existing P##-## position suffix from the input label (was the bug class)", () => {
    // The old buggy code would have appended " P01-01" — make sure that never
    // comes back even when the input already looks like a polluted area name.
    expect(areaQrFor("test14 P01-01")).toBe("WMS-AREA:TEST14");
    expect(areaQrFor("test6 P01-01")).toBe("WMS-AREA:TEST6");
    expect(areaQrFor("前台 P03-02")).toBe("WMS-AREA:前台".toUpperCase().replace(/\s+/g, "-"));
  });

  it("strips an existing R##-C## suffix (rack convention) too", () => {
    expect(areaQrFor("RECV R01-C01")).toBe("WMS-AREA:RECV");
  });

  it("collapses whitespace and uppercases", () => {
    expect(areaQrFor("test 6")).toBe("WMS-AREA:TEST-6");
    expect(areaQrFor("  Test 6  ")).toBe("WMS-AREA:TEST-6");
  });

  it("falls back to AREA when the label is empty after stripping", () => {
    expect(areaQrFor("")).toBe("WMS-AREA:AREA");
    expect(areaQrFor("   ")).toBe("WMS-AREA:AREA");
  });

  it("NEVER appends a position suffix (regression: this caused data corruption)", () => {
    // Frozen format: must be exactly WMS-AREA:<LABEL> with no trailing space
    // and no P##-## / R##-C## tokens. If this test fails, the canvas DB will
    // be polluted again on the next save.
    for (const label of ["test14", "test6", "test3", "前台", "RECV", "Area-1"]) {
      const out = areaQrFor(label);
      expect(out).not.toMatch(/\sP\d{2}-\d{2}$/);
      expect(out).not.toMatch(/\sR\d+-C\d+$/);
      expect(out).toMatch(/^WMS-AREA:/);
    }
  });
});
