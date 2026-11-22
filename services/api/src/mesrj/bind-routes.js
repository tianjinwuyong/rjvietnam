// ============================================================================
// 绑码/解码（源 api/bind.py，11 路由） —— 从 routes/mesrj.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮1续）。
// 依赖经 registerBindRoutes(router, deps) 注入，与 smta-routes/ultra 同一约定；
// 注册位置在 createMesrjRouter 内保持不变（JWT 之后，顺序即原块顺序）。
// ============================================================================
import * as bindMod from "./bind.js";

export function registerBindRoutes(router, { query, ok, fail, perm: requireMesrjPerm, anyPerm: requireAnyPerm, execUser }) {
  // ════════════════════════════════════════════════════════════════════════════
  // 绑码 / 解码（SN 绑定关系）—— 源 api/bind.py（11 路由）
  //   SN OLD → SN NEW；关系落 prd_sn_rel，只做逻辑失效（is_active=0 + reason/void_at/void_by）
  // ════════════════════════════════════════════════════════════════════════════

  // ── 初始化（工位 + 两端码规则 + 工单 + 码类型）──
  router.get("/bind/init", requireMesrjPerm(null), async (_req, res) => {
    const stations = [];
    for (const s of await bindMod.stations()) {
      const st = (await query(
        "SELECT station_code, station_name, line_code FROM md_station WHERE station_code=$1",
        [s.station_code])).rows[0];
      stations.push({
        ...s,
        station_name: st?.station_name || s.station_name,
        line_code: st?.line_code || "",
        old: await bindMod.ruleFor(s.station_code, "old"),
        new: await bindMod.ruleFor(s.station_code, "new"),
      });
    }
    const moList = (await query(
      `SELECT mo_no, product_code, status, plan_qty FROM ord_mo
        WHERE COALESCE(status,'') NOT IN ('作废','已关闭') ORDER BY id DESC LIMIT 200`)).rows;
    const snTypes = (await query(
      "SELECT sn_type FROM cfg_sn_rule WHERE enabled=1 ORDER BY id")).rows.map(r => r.sn_type);
    return ok(res, { stations, mo_list: moList, sn_types: snTypes });
  });

  // ── 单个绑码工位的两端规则 ──
  router.get("/bind/rule", requireMesrjPerm(null), async (req, res) => {
    const stationCode = String(req.query.station_code || "").trim();
    if (!stationCode) return fail(res, "缺少工位号");
    const st = await bindMod.station(stationCode);
    if (!st) return fail(res, `工位 ${stationCode} 不是绑码工位`);
    return ok(res, {
      station_code: stationCode, rel_type: st.rel_type, station_name: st.station_name,
      old: await bindMod.ruleFor(stationCode, "old"),
      new: await bindMod.ruleFor(stationCode, "new"),
    });
  });

  // ── 扫完第一个码立刻校验（早报早处理）──
  router.post("/bind/precheck", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    const r = await bindMod.precheck(req.body || {});
    return ok(res, r);
  });

  // ── 绑码 ──
  router.post("/bind/do", requireMesrjPerm("prod.bind"), async (req, res) => {
    const u = execUser(req);
    const r = await bindMod.doBind(req.body || {}, u, req.ip);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.data, r.msg);
  });

  // ── 解绑（必须填原因）──
  router.post("/bind/unbind", requireMesrjPerm("prod.bind"), async (req, res) => {
    const r = await bindMod.unbind(req.body || {}, req.mesrjUser, req.ip);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.data, r.msg);
  });

  // ── 绑定记录 ──
  router.get("/bind/list", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    return ok(res, await bindMod.list(req.query));
  });

  // ── 追溯链（含已解绑履历）──
  router.get("/bind/chain", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    return ok(res, await bindMod.chain(sn, String(req.query.void ?? "1") !== "0"));
  });

  // ── 绑码产能（按小时）──
  router.get("/bind/hourly", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    return ok(res, await bindMod.hourly(req.query));
  });

  // ── 扫码反查整组（找不到外壳/铭牌时直接扫 PCBA）──
  router.get("/bind/lookup", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请扫码");
    return ok(res, await bindMod.lookup(sn));
  });

  // ── 解码（换标 / 换壳：解绑 + 作废，全程留痕）──
  router.post("/bind/decode", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    const r = await bindMod.decode(req.body || {}, req.mesrjUser, req.ip);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.data, r.msg);
  });

  // ── 解码履历 ──
  router.get("/bind/decode/log", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    return ok(res, await bindMod.decodeLog(req.query));
  });
}
