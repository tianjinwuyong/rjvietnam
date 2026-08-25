import { describe, expect, it } from "vitest";
import { createScannerPlugin, normalizeInternationalScan } from "./scanner";
import type { PdaContext } from "../contracts";

const context: PdaContext = {
  deviceId: "staging-pda-01",
  hostIp: "127.0.0.1",
  stationCode: "STG-SCAN-01",
  lineDomain: "manual-line",
  locale: "vi-VN",
  configurationVersion: "staging-test",
};

const action = (type: string, payload: unknown, traceId = "trace-test") => ({ type, payload, traceId });

describe("international scanner workflow", () => {
  it("rejects unsupported action types before scanner gates", async () => {
    let gateCalls = 0;
    const plugin = createScannerPlugin({ duplicateCheck: async () => { gateCalls++; return false; } });
    const result = await plugin.execute(action("scanner.unknown", { rawValue: "SN-STAGING-001" }, "trace-unsupported"), context);

    expect(result).toMatchObject({
      ok: false,
      decision: "REJECT",
      code: "UNSUPPORTED_ACTION",
      traceId: "trace-unsupported",
    });
    expect(gateCalls).toBe(0);
  });

  it("normalizes scanner framing noise and preserves identifier text", () => {
    expect(normalizeInternationalScan("\uFEFF  ab\u00A0123\r\n")).toBe("AB 123");
    expect(normalizeInternationalScan("  linh kien-01 ")).toBe("LINH KIEN-01");
    expect(normalizeInternationalScan("\u677f\u6735-\u2605A123")).toBe("\u677f\u6735-\u2605A123");
  });

  it("rejects invalid scans before external gates", async () => {
    let duplicateCalls = 0;
    const plugin = createScannerPlugin({ pattern: /^SN-[A-Z0-9]+$/, duplicateCheck: async () => { duplicateCalls++; return false; } });
    const result = await plugin.execute(action("scanner.scan", { rawValue: "bad value" }), context);
    expect(result).toMatchObject({ ok: false, decision: "REJECT", code: "INVALID_SCAN" });
    expect(duplicateCalls).toBe(0);
  });

  it("holds local and MES duplicates", async () => {
    let clock = 1000;
    const plugin = createScannerPlugin({ now: () => clock, duplicateWindowMs: 500, duplicateCheck: async ({ normalizedValue }) => normalizedValue === "SN-MES" });
    const first = await plugin.execute(action("scanner.scan", { rawValue: "sn-local" }), context);
    const localDuplicate = await plugin.execute(action("scanner.scan", { rawValue: " SN-LOCAL\n" }), context);
    clock += 501;
    const mesDuplicate = await plugin.execute(action("scanner.scan", { rawValue: "sn-mes" }), context);
    expect(first).toMatchObject({ ok: true, decision: "CAPTURED", code: "SCAN_CAPTURED" });
    expect(localDuplicate).toMatchObject({ ok: false, decision: "HOLD", code: "DUPLICATE_SCAN" });
    expect(mesDuplicate).toMatchObject({ ok: false, decision: "HOLD", code: "DUPLICATE_SCAN" });
    expect(mesDuplicate.data).toMatchObject({ source: "mes", normalizedValue: "SN-MES" });
  });

  it("rejects NG scans and retains gate failures for recovery", async () => {
    let shouldFail = true;
    const plugin = createScannerPlugin({ ngCheck: async ({ normalizedValue }) => {
      if (shouldFail) throw new Error(`staging gate unavailable for ${normalizedValue}`);
      return { blocked: normalizedValue === "SN-NG", code: "CONFIRMED_NG" };
    } });
    const unavailable = await plugin.execute(action("scanner.scan", { rawValue: "sn-recover" }, "trace-1"), context);
    shouldFail = false;
    const recovered = await plugin.execute(action("scanner.recover", { normalizedValue: "sn-recover" }, "trace-2"), context);
    const ng = await plugin.execute(action("scanner.scan", { rawValue: "sn-ng" }, "trace-3"), context);
    const missing = await plugin.execute(action("scanner.recover", { normalizedValue: "unknown" }, "trace-4"), context);
    expect(unavailable).toMatchObject({ ok: false, decision: "HOLD", code: "SCANNER_GATE_UNAVAILABLE", retryable: true });
    expect(recovered).toMatchObject({ ok: true, decision: "CAPTURED", code: "SCAN_CAPTURED", traceId: "trace-2" });
    expect(ng).toMatchObject({ ok: false, decision: "REJECT", code: "CONFIRMED_NG" });
    expect(missing).toMatchObject({ ok: false, decision: "HOLD", code: "NO_PENDING_SCAN", retryable: false });
  });
});
