import { describe, expect, it, vi } from "vitest";
import { createMaterialUsagePlugin, createPdaRuntime, createProductGatePlugin, createScannerPlugin, createSmtMaterialLoadingPlugin, normalizeInternationalScan, resolvePdaModules } from "../packages/pda-components/src";

const context = {
  deviceId: "PDA-01",
  hostIp: "192.168.6.52",
  stationCode: "manu_pda",
  lineDomain: "manual-line",
  locale: "zh-CN" as const,
  operatorId: "OP-01",
  workOrderCode: "WO-TEST",
  configurationVersion: "test-v1",
};

describe("PDA component runtime", () => {
  it("composes scanner and writes the common audit envelope", async () => {
    const auditSink = vi.fn();
    const runtime = createPdaRuntime({ context, plugins: [createScannerPlugin()], auditSink });
    const result = await runtime.execute("scanner.scan", { rawValue: " sn-001 " });
    expect(result).toMatchObject({ ok: true, decision: "CAPTURED", data: { normalizedValue: "SN-001" } });
    expect(auditSink).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "scanner", stationCode: "manu_pda", decision: "CAPTURED" }));
  });

  it("suppresses accidental duplicate scans", async () => {
    let time = 1000;
    const runtime = createPdaRuntime({ context, plugins: [createScannerPlugin({ now: () => time })] });
    await runtime.execute("scanner.scan", { rawValue: "SN-001" });
    time += 100;
    const duplicate = await runtime.execute("scanner.scan", { rawValue: "SN-001" });
    expect(duplicate).toMatchObject({ ok: false, decision: "HOLD", code: "DUPLICATE_SCAN" });
  });

  it("treats global scan patterns as stateless across repeated scans", async () => {
    let time = 1000;
    const runtime = createPdaRuntime({
      context,
      plugins: [createScannerPlugin({ pattern: /^SN-\d+$/g, now: () => time })],
    });

    const first = await runtime.execute("scanner.scan", { rawValue: "SN-001" });
    time += 1000;
    const second = await runtime.execute("scanner.scan", { rawValue: "SN-002" });

    expect(first).toMatchObject({ ok: true, decision: "CAPTURED" });
    expect(second).toMatchObject({ ok: true, decision: "CAPTURED" });
  });

  it("normalizes international scanner framing without dropping non-Latin identifiers", () => {
    expect(normalizeInternationalScan("\uFEFF  vn- éß  \r\n 01  ")).toBe("VN- ÉSS 01");
    expect(normalizeInternationalScan("  中文-01  ")).toBe("中文-01");
  });

  it("consults the MES duplicate and NG checks before capture", async () => {
    const duplicateCheck = vi.fn(async ({ normalizedValue }: { normalizedValue: string }) => normalizedValue === "SN-DUP");
    const ngCheck = vi.fn(async ({ normalizedValue }: { normalizedValue: string }) => ({ blocked: normalizedValue === "SN-NG", code: "ACTIVE_CONFIRMED_NG" }));
    const runtime = createPdaRuntime({ context, plugins: [createScannerPlugin({ duplicateCheck, ngCheck })] });

    expect(await runtime.execute("scanner.scan", { rawValue: " sn-dup " })).toMatchObject({ ok: false, decision: "HOLD", code: "DUPLICATE_SCAN" });
    expect(await runtime.execute("scanner.scan", { rawValue: "SN-NG" })).toMatchObject({ ok: false, decision: "REJECT", code: "ACTIVE_CONFIRMED_NG" });
    expect(duplicateCheck).toHaveBeenCalledTimes(2);
    expect(ngCheck).toHaveBeenCalledTimes(1);
  });

  it("recovers a scan held while the MES gate is unavailable", async () => {
    let available = false;
    const runtime = createPdaRuntime({
      context,
      plugins: [createScannerPlugin({ ngCheck: async () => { if (!available) throw new Error("offline"); return { blocked: false }; } })],
    });
    expect(await runtime.execute("scanner.scan", { rawValue: " vn-01 " })).toMatchObject({ ok: false, decision: "HOLD", code: "SCANNER_GATE_UNAVAILABLE", retryable: true });
    available = true;
    expect(await runtime.execute("scanner.recover", { normalizedValue: "VN-01" })).toMatchObject({ ok: true, decision: "CAPTURED", code: "SCAN_CAPTURED", data: { normalizedValue: "VN-01" } });
    expect(await runtime.execute("scanner.recover", { normalizedValue: "VN-01" })).toMatchObject({ ok: false, code: "NO_PENDING_SCAN" });
  });

  it("fails closed when Product Gate is unavailable", async () => {
    const runtime = createPdaRuntime({
      context,
      plugins: [createProductGatePlugin({ evaluate: async () => { throw new Error("offline"); } })],
    });
    const result = await runtime.execute("product-gate.evaluate", { identifier: "SN-001" }, { idempotencyKey: "gate-1" });
    expect(result).toMatchObject({ ok: false, decision: "HOLD", code: "PRODUCT_GATE_UNAVAILABLE", retryable: true });
  });

  it("uses one APK profile while always retaining the base safety modules", () => {
    const modules = resolvePdaModules({
      profileId: "warehouse-receiving",
      version: "1",
      nameKey: "pda.profile.receiving",
      defaultLocale: "vi-VN",
      enabledModules: ["scanner", "receiving", "printing", "iqc-evidence"],
      permissions: ["wms.receiving.create"],
      effectiveAt: "2026-08-04T00:00:00Z",
    });
    expect(modules).toEqual(expect.arrayContaining(["scanner", "auth", "alarm", "language", "sync", "diagnostics", "receiving", "printing", "iqc-evidence"]));
    expect(modules.filter((id) => id === "scanner")).toHaveLength(1);
  });

  it("captures machine, channel, feeder and material in strict order", async () => {
    const validate = vi.fn(async () => ({ allowed: true, code: "FOUR_WAY_MATCH" }));
    const confirm = vi.fn(async () => ({ loadingId: "LOAD-1", code: "LOADING_RECORDED" }));
    const runtime = createPdaRuntime({ context, plugins: [createSmtMaterialLoadingPlugin({ validate, confirm })] });
    for (const rawValue of ["NPM-01", "L1", "FDR-001", "MAT-001"]) {
      await runtime.execute("smt-loading.scan", { rawValue });
    }
    const checked = await runtime.execute("smt-loading.validate", {}, { idempotencyKey: "validate-1" });
    expect(checked).toMatchObject({ ok: true, decision: "ALLOW", code: "FOUR_WAY_MATCH" });
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ machineCode: "NPM-01", channelCode: "L1", feederCode: "FDR-001", materialCode: "MAT-001" }));
    const saved = await runtime.execute("smt-loading.confirm", {}, { idempotencyKey: "confirm-1" });
    expect(saved).toMatchObject({ ok: true, decision: "COMPLETED", code: "LOADING_RECORDED", data: { loadingId: "LOAD-1" } });
  });

  it("routes usage facts to the manual-line MES process", async () => {
    const report = vi.fn(async () => ({ usageEventId: "USE-1", code: "USAGE_RECORDED", remainingQuantity: 46 }));
    const runtime = createPdaRuntime({ context, plugins: [createMaterialUsagePlugin({ report })] });
    const result = await runtime.execute("material-usage.report", {
      machineCode: "MANUAL-01",
      channelCode: "CH-01",
      feederCode: "BIN-01",
      materialCode: "MAT-001",
      quantityUsed: 2,
      unit: "PCS",
      productIdentifier: "PCBA-001",
      occurredAt: "2026-08-04T01:00:00Z",
    }, { idempotencyKey: "usage-1", traceId: "trace-usage-1" });
    expect(result).toMatchObject({ ok: true, decision: "COMPLETED", code: "USAGE_RECORDED" });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ processDomain: "manual-line", workOrderCode: "WO-TEST", quantityUsed: 2, productIdentifier: "PCBA-001" }));
  });

  it("blocks a manual usage module from crossing into another MES domain", async () => {
    const report = vi.fn();
    const runtime = createPdaRuntime({ context: { ...context, lineDomain: "smt" }, plugins: [createMaterialUsagePlugin({ report })] });
    const result = await runtime.execute("material-usage.report", {
      machineCode: "NPM-01", channelCode: "CH-01", feederCode: "F-01", materialCode: "M-01", quantityUsed: 1, unit: "PCS",
    }, { idempotencyKey: "wrong-domain-1" });
    expect(result).toMatchObject({ ok: false, decision: "REJECT", code: "PROCESS_DOMAIN_MISMATCH" });
    expect(report).not.toHaveBeenCalled();
  });
});
