/**
 * Native station-pass rule engine.
 *
 * Ported from the Python MES (`api/exec.py: do_pass_inner`) so the SMT system can
 * enforce the same防呆 chain on PostgreSQL instead of SQLite. The function is pure:
 * callers load the facts (station / route / product / policy / 放行单) and this module
 * returns one verdict plus the ordered checks that produced it.
 *
 * Rule order (each rule is only evaluated while everything above it passed):
 *   1 STATION_INVALID            工位不存在 / 已停用
 *   2 NG_DEFECT_REQUIRED         判 NG 必须带不良代码
 *   3 MANUAL_PASS_DENIED         功能测试站不允许人工判 OK（结论必须来自设备）
 *   4 WORK_ORDER_NOT_RELEASED    首次建档必须挂在已下达工单上
 *   5 ROUTE_NOT_CONFIGURED       本线路线解析不完整（与工位主数据对不上）
 *   6 PRODUCT_NOT_REGISTERED     SN 未建档且不是首站 / 该工位不在路线上
 *   7 PRODUCT_TERMINAL           SN 已完工 / 报废 / 取消
 *   8 NG_ROUTE_ACTIVE            存在未闭环 NG 路线，必须走指定返修站
 *   9 MISSING_REQUIRED_STATION   必过站缺失（跳站）
 *  10 STATION_NOT_EXPECTED       扫错工位（除非有已批准的跳站放行单）
 *  11 DUPLICATE_STATION_PASS     同站重复过站（除非允许重测且在次数内）
 *  12 RETEST_LIMIT_EXCEEDED      重测次数超上限
 *  13 DWELL_NOT_SATISFIED       时效未到（如胶水固化 / 老化）
 *  14 UPSTREAM_NG_OPEN          上游未闭环 NG，不允许继续下传
 */

export const STATION_PASS_STATES = Object.freeze([
  "ALLOW", "HOLD", "REJECT", "REPAIR_ROUTE", "COMPLETED",
]);

export const STATION_PASS_RULES = Object.freeze([
  "STATION_INVALID",
  "NG_DEFECT_REQUIRED",
  "MANUAL_PASS_DENIED",
  "WORK_ORDER_NOT_RELEASED",
  "PRODUCT_NOT_REGISTERED",
  "ROUTE_NOT_CONFIGURED",
  "PRODUCT_TERMINAL",
  "NG_ROUTE_ACTIVE",
  "MISSING_REQUIRED_STATION",
  "STATION_NOT_EXPECTED",
  "DUPLICATE_STATION_PASS",
  "RETEST_LIMIT_EXCEEDED",
  "DWELL_NOT_SATISFIED",
  "UPSTREAM_NG_OPEN",
]);

const TERMINAL_STATES = ["COMPLETED", "SCRAPPED", "DESTROYED", "CANCELLED"];
const MACHINE_SOURCES = ["machine", "device", "equip", "auto"];

const lower = (value) => String(value ?? "").trim().toLowerCase();
const upper = (value) => String(value ?? "").trim().toUpperCase();

function verdict(accepted, gateState, reasonCode, message, nextAction, extra = {}) {
  return { accepted, blocked: !accepted, gateState, reasonCode, message, nextAction, ...extra };
}

/**
 * @param {object} input
 * @param {string} input.identifier        scanned SN
 * @param {string} input.stationCode       station the operator/device is working at
 * @param {"OK"|"NG"} [input.result]       default OK
 * @param {string} [input.defectCode]      required when result is NG
 * @param {string} [input.source]          manual | machine | device | auto | agent
 * @param {{code:string,status?:string,denyManualPass?:boolean,allowRepeatPass?:boolean,maxRetest?:number,minDwellMinutes?:number}|null} [input.station]
 * @param {{code:string,released?:boolean}|null} [input.workOrder]
 * @param {{firstStationCode?:string,nextStationCode?:string}|null} [input.route]
 * @param {{productId:string,lifecycleState?:string,hasPassedThisStation?:boolean,retestCount?:number,lastCompletedAt?:string|Date|null,activeNg?:{releaseStations?:string[],requiredStations?:string[]}|null,missingRequiredStationCodes?:string[],upstreamNgStationCode?:string|null}|null} [input.product]
 * @param {{releaseNo?:string,fromStationCode?:string,toStationCode?:string}|null} [input.skipRelease] approved 放行单 covering this hop
 * @param {boolean} [input.skipReleaseRequested] 放行单已申请但未批准（用于给现场明确提示）
 * @param {Date|number} [input.now]
 */
export function evaluateStationPass(input = {}) {
  const identifier = upper(input.identifier);
  const stationCode = lower(input.stationCode);
  const result = upper(input.result || "OK");
  const defectCode = String(input.defectCode ?? "").trim();
  const source = lower(input.source || "manual");
  const station = input.station || null;
  const workOrder = input.workOrder || null;
  const route = input.route || null;
  const product = input.product || null;
  const skipRelease = input.skipRelease || null;
  const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());

  const checks = [];
  const rule = (code, ok, message) => {
    checks.push({ rule: code, ok, message });
    return ok;
  };
  // Only the rules actually evaluated appear in `checks`; the first failure ends the run.
  const finish = (v) => ({ ...v, checks });

  // ── 1. 工位 ────────────────────────────────────────────────────────────────
  if (!station) {
    rule("STATION_INVALID", false, `工位不存在：${input.stationCode ?? ""}`);
    return finish(verdict(false, "REJECT", "STATION_INVALID", "工位不存在", "CHOOSE_VALID_STATION"));
  }
  // stations.status 现场只有 idle / running；只有显式停用态才算不可用。
  const stationStatus = typeof station.status === "string" ? station.status.toLowerCase() : station.status;
  if (["0", 0, false, "disabled", "stopped", "inactive", "offline", "retired"].includes(stationStatus)) {
    rule("STATION_INVALID", false, `工位已停用：${station.code}`);
    return finish(verdict(false, "REJECT", "STATION_INVALID", `工位已停用：${station.code}`, "ENABLE_STATION"));
  }

  // ── 2. NG 必须带不良代码 ───────────────────────────────────────────────────
  if (result === "NG" && !defectCode) {
    rule("NG_DEFECT_REQUIRED", false, "判 NG 必须填不良代码");
    return finish(verdict(false, "REJECT", "NG_DEFECT_REQUIRED", "判 NG 必须填不良代码", "SELECT_DEFECT_CODE"));
  }

  // ── 3. 功能测试站禁止人工判 OK ─────────────────────────────────────────────
  const isDevice = MACHINE_SOURCES.includes(source) || source.startsWith("device:");
  if (station.denyManualPass === true && !isDevice && result === "OK") {
    const message = `「${station.code}」的结论必须由设备上传；人工不能判良品放行。判 NG 不受此限制。`;
    rule("MANUAL_PASS_DENIED", false, message);
    return finish(verdict(false, "REJECT", "MANUAL_PASS_DENIED", message, "WAIT_FOR_DEVICE_RESULT"));
  }

  // ── 4. 工单必须已下达（首次建档时）────────────────────────────────────────
  if (!product && !(workOrder && workOrder.released === true)) {
    const message = "SN 首次建档需要一个已下达的工单";
    rule("WORK_ORDER_NOT_RELEASED", false, message);
    return finish(verdict(false, "HOLD", "WORK_ORDER_NOT_RELEASED", message, "RELEASE_WORK_ORDER"));
  }

  // ── 5. 路线必须可用 ───────────────────────────────────────────────────────
  // 有路线但解析不完整（station_sequences 里是旧编码/类型码，落不到工位主数据）
  // 一律拦下：让过站继续跑只会把产品判完工或卡在一个不存在的下一站。
  if (route && Number(route.stepsCount || 0) > 0 && route.configured === false) {
    const message = "本产线的过站路线与工位主数据对不上，无法判定流向（请工艺核对 station_sequences）";
    rule("ROUTE_NOT_CONFIGURED", false, message);
    return finish(verdict(false, "REJECT", "ROUTE_NOT_CONFIGURED", message, "CONFIGURE_ROUTE", {
      productId: product?.productId ?? null,
    }));
  }

  // ── 6. 未建档：只有首站可以建档 ───────────────────────────────────────────
  if (!product) {
    // 6a. 路线有配置，但这个工位不在路线上 —— 数据问题，不是操作问题。
    if (route && Number(route.stepsCount || 0) > 0 && route.stationOnRoute !== true) {
      const message = `工位「${station.code}」不在本产线的过站路线中，无法建档（请工艺核对路线）`;
      rule("ROUTE_NOT_CONFIGURED", false, message);
      return finish(verdict(false, "REJECT", "ROUTE_NOT_CONFIGURED", message, "CONFIGURE_ROUTE"));
    }
    const firstStation = lower(route?.firstStationCode);
    if (firstStation && stationCode !== firstStation) {
      const message = `SN 未建档，请先到首站「${route?.firstStationCode}」建档`;
      rule("PRODUCT_NOT_REGISTERED", false, message);
      return finish(verdict(false, "REJECT", "PRODUCT_NOT_REGISTERED", message, "GO_TO_FIRST_STATION", {
        destinationStationCode: route?.firstStationCode ?? null,
      }));
    }
    rule("PRODUCT_NOT_REGISTERED", true, "首站建档");
    return finish(verdict(true, "ALLOW", "FIRST_REGISTRATION_REQUIRED", "首站建档放行", "REGISTER_PRODUCT", {
      registrationRequired: true,
    }));
  }

  // ── 7. 终态 ───────────────────────────────────────────────────────────────
  if (TERMINAL_STATES.includes(upper(product.lifecycleState))) {
    const message = `SN 已处于终态「${product.lifecycleState}」，不能再过站`;
    rule("PRODUCT_TERMINAL", false, message);
    return finish(verdict(false, "COMPLETED", "PRODUCT_TERMINAL", message, "NO_FURTHER_PRODUCTION", {
      productId: product.productId,
    }));
  }

  // ── 8. NG 返修路线 ────────────────────────────────────────────────────────
  const requiredNgStations = (product.activeNg?.requiredStations || []).map(lower).filter(Boolean);
  if (requiredNgStations.length) {
    const destination = requiredNgStations[0];
    if (stationCode !== destination) {
      const message = `存在未闭环 NG 路线，下一步必须到「${destination}」`;
      rule("NG_ROUTE_ACTIVE", false, message);
      return finish(verdict(false, "REPAIR_ROUTE", "NG_ROUTE_ACTIVE", message, "FOLLOW_NG_ROUTE", {
        productId: product.productId,
        destinationStationCode: destination,
      }));
    }
    rule("NG_ROUTE_ACTIVE", true, "按 NG 路线返回指定工位");
  }

  // ── 9. 必过站缺失 ─────────────────────────────────────────────────────────
  const missing = (product.missingRequiredStationCodes || []).map(lower).filter(Boolean);
  if (missing.length) {
    const message = `必过站缺失：${missing.join("、")}`;
    rule("MISSING_REQUIRED_STATION", false, message);
    return finish(verdict(false, "REJECT", "MISSING_REQUIRED_STATION", message, "RETURN_TO_MISSING_STATION", {
      productId: product.productId,
      destinationStationCode: missing[0],
      missingStationCodes: missing,
    }));
  }

  // ── 10. 扫错工位（跳站），除非有已批准放行单 ───────────────────────────────
  const expected = lower(product.expectedStationCode || route?.expectedStationCode);
  if (expected && expected !== stationCode) {
    const covered = skipRelease
      && lower(skipRelease.toStationCode) === stationCode
      && (!skipRelease.fromStationCode || lower(skipRelease.fromStationCode) === expected);
    if (!covered) {
      const message = input.skipReleaseRequested
        ? `放行单待审批，暂不能跳到「${station.code}」`
        : `当前应到「${product.expectedStationCode || expected}」，扫的是「${station.code}」（跳站需放行单）`;
      rule("STATION_NOT_EXPECTED", false, message);
      return finish(verdict(false, "REJECT", "STATION_NOT_EXPECTED", message,
        input.skipReleaseRequested ? "WAIT_FOR_SKIP_APPROVAL" : "GO_TO_EXPECTED_STATION", {
          productId: product.productId,
          destinationStationCode: product.expectedStationCode || expected,
        }));
    }
    rule("STATION_NOT_EXPECTED", true, `已批准跳站放行单 ${skipRelease.releaseNo ?? ""}`.trim());
  }

  // ── 11. 同站重复过站 ──────────────────────────────────────────────────────
  if (product.hasPassedThisStation === true) {
    const maxRetest = Number(station.maxRetest ?? 0);
    const retestCount = Number(product.retestCount ?? 0);
    if (station.allowRepeatPass !== true) {
      const message = `「${station.code}」已经过站，不允许重复过站`;
      rule("DUPLICATE_STATION_PASS", false, message);
      return finish(verdict(false, "REJECT", "DUPLICATE_STATION_PASS", message, "MOVE_TO_NEXT_STATION", {
        productId: product.productId,
      }));
    }
    // ── 12. 重测次数 ───────────────────────────────────────────────────────
    if (retestCount >= maxRetest) {
      const message = `「${station.code}」重测次数已达上限（${maxRetest}）`;
      rule("RETEST_LIMIT_EXCEEDED", false, message);
      return finish(verdict(false, "REJECT", "RETEST_LIMIT_EXCEEDED", message, "SEND_TO_REPAIR", {
        productId: product.productId,
      }));
    }
    rule("RETEST_LIMIT_EXCEEDED", true, `第 ${retestCount + 1}/${maxRetest} 次重测`);
  }

  // ── 13. 时效 ──────────────────────────────────────────────────────────────
  const dwellMinutes = Number(station.minDwellMinutes ?? 0);
  if (dwellMinutes > 0 && product.lastCompletedAt) {
    const elapsedMs = now.getTime() - new Date(product.lastCompletedAt).getTime();
    if (Number.isFinite(elapsedMs) && elapsedMs < dwellMinutes * 60_000) {
      const need = Math.ceil(dwellMinutes - elapsedMs / 60_000);
      const message = `时效未到：本工位要求停留 ${dwellMinutes} 分钟，还差 ${need} 分钟`;
      rule("DWELL_NOT_SATISFIED", false, message);
      return finish(verdict(false, "HOLD", "DWELL_NOT_SATISFIED", message, "WAIT_FOR_DWELL", {
        productId: product.productId,
        waitSeconds: Math.max(1, Math.ceil((dwellMinutes * 60_000 - elapsedMs) / 1000)),
      }));
    }
  }

  // ── 14. 上游未闭环 NG ─────────────────────────────────────────────────────
  if (product.upstreamNgStationCode) {
    const message = `上游「${product.upstreamNgStationCode}」存在未闭环 NG，先返修再下传`;
    rule("UPSTREAM_NG_OPEN", false, message);
    return finish(verdict(false, "HOLD", "UPSTREAM_NG_OPEN", message, "REPAIR_UPSTREAM_NG", {
      productId: product.productId,
      destinationStationCode: product.upstreamNgStationCode,
    }));
  }

  // ── 放行 ──────────────────────────────────────────────────────────────────
  const message = result === "NG"
    ? `已记录 NG：${defectCode}`
    : `过站成功：${station.code}`;
  return finish(verdict(true, result === "NG" ? "REPAIR_ROUTE" : "ALLOW",
    result === "NG" ? "NG_RECORDED" : "STATION_PASSED", message,
    result === "NG" ? "FOLLOW_NG_ROUTE" : "MOVE_TO_NEXT_STATION", {
      productId: product.productId,
      nextStationCode: route?.nextStationCode ?? null,
    }));
}
