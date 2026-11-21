import { describe, expect, it } from "vitest";
import { evaluateStationPass, STATION_PASS_RULES } from "../services/api/src/station-pass.js";

/** 全部前置都放行的基础输入；每个用例只覆盖一条规则的破坏面。 */
const base = () => ({
  identifier: "SN-0001",
  stationCode: "aoi-01",
  station: { code: "AOI-01", status: "running" },
  workOrder: { code: "MO-1", released: true },
  route: { firstStationCode: "pda-01", nextStationCode: "fct-01" },
  product: { productId: "P-1", lifecycleState: "ACTIVE" },
});

describe("station-pass rule chain", () => {
  it("declares exactly the 14 documented rules", () => {
    expect(STATION_PASS_RULES).toHaveLength(14);
    expect(STATION_PASS_RULES[0]).toBe("STATION_INVALID");
    expect(STATION_PASS_RULES[13]).toBe("UPSTREAM_NG_OPEN");
  });

  it("1 STATION_INVALID: unknown station is rejected", () => {
    const v = evaluateStationPass({ ...base(), station: null });
    expect(v).toMatchObject({ accepted: false, gateState: "REJECT", reasonCode: "STATION_INVALID" });
  });

  it("1 STATION_INVALID: disabled station is rejected", () => {
    const v = evaluateStationPass({ ...base(), station: { code: "AOI-01", status: "stopped" } });
    expect(v).toMatchObject({ accepted: false, reasonCode: "STATION_INVALID", nextAction: "ENABLE_STATION" });
  });

  it("2 NG_DEFECT_REQUIRED: NG without defect code is rejected", () => {
    const v = evaluateStationPass({ ...base(), result: "NG" });
    expect(v).toMatchObject({ accepted: false, reasonCode: "NG_DEFECT_REQUIRED" });
  });

  it("3 MANUAL_PASS_DENIED: manual OK blocked on deny-manual station, device result passes", () => {
    const station = { code: "FCT-01", status: "running", denyManualPass: true };
    const manual = evaluateStationPass({ ...base(), station, stationCode: "fct-01" });
    expect(manual).toMatchObject({ accepted: false, reasonCode: "MANUAL_PASS_DENIED", nextAction: "WAIT_FOR_DEVICE_RESULT" });
    const device = evaluateStationPass({ ...base(), station, stationCode: "fct-01", source: "machine" });
    expect(device.accepted).toBe(true);
    // 判 NG 不受限制：人工报不良必须能录进去
    const manualNg = evaluateStationPass({ ...base(), station, stationCode: "fct-01", result: "NG", defectCode: "D-01" });
    expect(manualNg.accepted).toBe(true);
  });

  it("4 WORK_ORDER_NOT_RELEASED: first registration needs a released work order", () => {
    const v = evaluateStationPass({ ...base(), product: null, workOrder: { code: "MO-1", released: false } });
    expect(v).toMatchObject({ accepted: false, gateState: "HOLD", reasonCode: "WORK_ORDER_NOT_RELEASED" });
  });

  it("5 ROUTE_NOT_CONFIGURED: partially resolved route blocks the pass", () => {
    const v = evaluateStationPass({ ...base(), route: { stepsCount: 7, configured: false } });
    expect(v).toMatchObject({ accepted: false, reasonCode: "ROUTE_NOT_CONFIGURED", nextAction: "CONFIGURE_ROUTE" });
  });

  it("6 PRODUCT_NOT_REGISTERED: off-first-station scan points back to the first station", () => {
    const v = evaluateStationPass({ ...base(), product: null, route: { firstStationCode: "pda-01" } });
    expect(v).toMatchObject({
      accepted: false, reasonCode: "PRODUCT_NOT_REGISTERED",
      nextAction: "GO_TO_FIRST_STATION", destinationStationCode: "pda-01",
    });
  });

  it("6 first registration at the first station is allowed", () => {
    const v = evaluateStationPass({
      ...base(), product: null, route: { firstStationCode: "pda-01" }, stationCode: "pda-01",
      station: { code: "PDA-01", status: "running" },
    });
    expect(v).toMatchObject({ accepted: true, reasonCode: "FIRST_REGISTRATION_REQUIRED", registrationRequired: true });
  });

  it("7 PRODUCT_TERMINAL: scrapped SN cannot pass again", () => {
    const v = evaluateStationPass({ ...base(), product: { productId: "P-1", lifecycleState: "SCRAPPED" } });
    expect(v).toMatchObject({ accepted: false, gateState: "COMPLETED", reasonCode: "PRODUCT_TERMINAL" });
  });

  it("8 NG_ROUTE_ACTIVE: open NG route forces the designated repair station", () => {
    const product = { ...base().product, activeNg: { requiredStations: ["REPAIR-01"] } };
    const blocked = evaluateStationPass({ ...base(), product });
    expect(blocked).toMatchObject({
      accepted: false, gateState: "REPAIR_ROUTE", reasonCode: "NG_ROUTE_ACTIVE",
      // 引擎内部统一小写比较，目的地也按小写返回
      destinationStationCode: "repair-01",
    });
    const atRepair = evaluateStationPass({ ...base(), product, stationCode: "repair-01", station: { code: "REPAIR-01", status: "running" } });
    expect(atRepair.accepted).toBe(true);
  });

  it("9 MISSING_REQUIRED_STATION: skipped required stations are rejected", () => {
    const product = { ...base().product, missingRequiredStationCodes: ["SMT-SPI-01"] };
    const v = evaluateStationPass({ ...base(), product });
    expect(v).toMatchObject({ accepted: false, reasonCode: "MISSING_REQUIRED_STATION", destinationStationCode: "smt-spi-01" });
  });

  it("10 STATION_NOT_EXPECTED: wrong station rejected, approved skip release covers it", () => {
    const product = { ...base().product, expectedStationCode: "fct-01" };
    const blocked = evaluateStationPass({ ...base(), product });
    expect(blocked).toMatchObject({ accepted: false, reasonCode: "STATION_NOT_EXPECTED", nextAction: "GO_TO_EXPECTED_STATION" });
    const pending = evaluateStationPass({ ...base(), product, skipReleaseRequested: true });
    expect(pending.nextAction).toBe("WAIT_FOR_SKIP_APPROVAL");
    const covered = evaluateStationPass({
      ...base(), product,
      skipRelease: { releaseNo: "QR-1", fromStationCode: "fct-01", toStationCode: "aoi-01" },
    });
    expect(covered.accepted).toBe(true);
  });

  it("11 DUPLICATE_STATION_PASS: repeat pass blocked unless the station allows retest", () => {
    const product = { ...base().product, hasPassedThisStation: true };
    const blocked = evaluateStationPass({ ...base(), product });
    expect(blocked).toMatchObject({ accepted: false, reasonCode: "DUPLICATE_STATION_PASS", nextAction: "MOVE_TO_NEXT_STATION" });
    const allowed = evaluateStationPass({
      ...base(), product,
      station: { code: "AOI-01", status: "running", allowRepeatPass: true, maxRetest: 3 },
    });
    expect(allowed.accepted).toBe(true);
  });

  it("12 RETEST_LIMIT_EXCEEDED: retest count over the policy limit is rejected", () => {
    const product = { ...base().product, hasPassedThisStation: true, retestCount: 3 };
    const station = { code: "AOI-01", status: "running", allowRepeatPass: true, maxRetest: 3 };
    const blocked = evaluateStationPass({ ...base(), product, station });
    expect(blocked).toMatchObject({ accepted: false, reasonCode: "RETEST_LIMIT_EXCEEDED", nextAction: "SEND_TO_REPAIR" });
    const within = evaluateStationPass({ ...base(), product: { ...product, retestCount: 1 }, station });
    expect(within.accepted).toBe(true);
  });

  it("13 DWELL_NOT_SATISFIED: early scan holds with the remaining wait", () => {
    const now = new Date("2026-11-18T09:00:00Z");
    const product = { ...base().product, lastCompletedAt: "2026-11-18T08:50:00Z" };
    const station = { code: "CURE-01", status: "running", minDwellMinutes: 60 };
    const v = evaluateStationPass({ ...base(), product, station, stationCode: "cure-01", now });
    expect(v).toMatchObject({ accepted: false, gateState: "HOLD", reasonCode: "DWELL_NOT_SATISFIED", waitSeconds: 3000 });
  });

  it("14 UPSTREAM_NG_OPEN: open upstream NG holds the SN", () => {
    const product = { ...base().product, upstreamNgStationCode: "SMT-SPI-01" };
    const v = evaluateStationPass({ ...base(), product });
    expect(v).toMatchObject({ accepted: false, gateState: "HOLD", reasonCode: "UPSTREAM_NG_OPEN", destinationStationCode: "SMT-SPI-01" });
  });

  it("happy path passes with the next station attached", () => {
    const v = evaluateStationPass(base());
    expect(v).toMatchObject({
      accepted: true, gateState: "ALLOW", reasonCode: "STATION_PASSED", nextStationCode: "fct-01",
    });
    // checks 只记录实际评估过的规则：顺利通过时不应有失败项，也不应出现未评估的重复过站规则
    expect(v.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(v.checks.some((c: { rule: string }) => c.rule === "DUPLICATE_STATION_PASS")).toBe(false);
  });

  it("NG verdict records the defect and routes to repair, not completion", () => {
    const v = evaluateStationPass({ ...base(), result: "NG", defectCode: "SOLDER-BRIDGE" });
    expect(v).toMatchObject({
      accepted: true, gateState: "REPAIR_ROUTE", reasonCode: "NG_RECORDED", nextAction: "FOLLOW_NG_ROUTE",
    });
  });
});
