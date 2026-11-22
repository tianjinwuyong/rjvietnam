// ============================================================================
// W12 分析/大屏（源 api/analyze.py，OEE/SPC/预警） —— 从 routes/mesrj.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮1续）。
// 依赖经 registerAnalyzeRoutes(router, deps) 注入，与 smta-routes/ultra 同一约定；
// 注册位置在 createMesrjRouter 内保持不变（JWT 之后，顺序即原块顺序）。
// ============================================================================
import * as alertMod from "./alert.js";
import { tsLocal } from "./packcode.js";

export function registerAnalyzeRoutes(router, { query, ok, fail, getParam, perm: requireMesrjPerm }) {
  // ════════════════════════════════════════════════════════════════════════════
  // W12：分析/大屏/追溯导出（源 api/analyze.py + api/board.py + api/trace_export.py，17 路由）
  // ════════════════════════════════════════════════════════════════════════════

  // ── OEE ──
  router.get("/report/oee", requireMesrjPerm(null), async (req, res) => {
    const d1 = String(req.query.d1 || "").trim();
    const d2 = String(req.query.d2 || "").trim();
    const line = String(req.query.line || "").trim();
    const shiftHours = Number(await getParam("oee.shift_hours", "8")) || 8;
    const shifts = Number(await getParam("oee.shifts", "1")) || 1;
    const idealSec = Number(await getParam("oee.ideal_sec", "30")) || 30;
    const plannedMin = shiftHours * shifts * 60.0;
    const where = [], args = [];
    if (d1) { where.push(`date(created_at) >= $${args.length + 1}`); args.push(d1); }
    if (d2) { where.push(`date(created_at) <= $${args.length + 1}`); args.push(d2); }
    if (line) { where.push(`line_code = $${args.length + 1}`); args.push(line); }
    const rows = await query(
      `SELECT station_code, machine_no, machine_type,
              COUNT(DISTINCT sn) AS total,
              COUNT(DISTINCT CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN sn END) AS ng,
              SUM(CASE WHEN begin_time<>'' AND end_time<>'' THEN
                (EXTRACT(EPOCH FROM (end_time::timestamptz - begin_time::timestamptz))/60.0) ELSE 0 END) AS run_min
       FROM prd_machine_data ${where.length ? "WHERE " + where.join(" AND ") : ""}
       GROUP BY station_code, machine_no, machine_type ORDER BY total DESC`, args);
    const out = [];
    for (const r of rows.rows) {
      const total = Number(r.total || 0);
      const ng = Number(r.ng || 0);
      const good = total - ng;
      const runMin = Number(r.run_min || 0);
      const avail = plannedMin ? runMin / plannedMin : 0;
      const perf = idealSec ? total / (runMin * 60 / idealSec) : 0;
      const quality = total ? good / total : 0;
      out.push({
        station_code: r.station_code, machine_no: r.machine_no, machine_type: r.machine_type,
        total, ng, good, run_min: Math.round(runMin),
        availability: Math.round(avail * 10000) / 100,
        performance: Math.round(perf * 10000) / 100,
        quality: Math.round(quality * 10000) / 100,
        oee: Math.round(avail * perf * quality * 10000) / 100,
      });
    }
    return ok(res, out);
  });

  // ── SPC 参数（源 analyze.py spc_params）──
  //   可做控制图的「工位 + 数值参数」：prd_test 里数据够 2 条、且值能转成数字。
  router.get("/report/spc/params", requireMesrjPerm(null), async (_req, res) => {
    const rows = (await query(
      `SELECT station_code, param_key, COUNT(*)::int AS n, COUNT(DISTINCT sn)::int AS sns
         FROM prd_test GROUP BY station_code, param_key ORDER BY n DESC`)).rows;
    const params = [];
    for (const r of rows) {
      if (Number(r.n || 0) < 2) continue;
      const sample = (await query(
        `SELECT param_val FROM prd_test WHERE station_code=$1 AND param_key=$2
            AND param_val IS NOT NULL AND param_val<>'' LIMIT 1`, [r.station_code, r.param_key])).rows[0];
      if (!sample || !Number.isFinite(Number(sample.param_val))) continue;
      params.push({ station_code: r.station_code, param_key: r.param_key, n: r.n, sns: r.sns });
    }
    return ok(res, { params });
  });

  // ── SPC 控制图（源 analyze.py report_spc）──
  //   给了 station+param 就按「每件一件一个值」画控制图：均值 ±3σ、超限点 ooc，
  //   规格限 spc.lsl / spc.usl 都在时同时给 Cp / Cpk。
  //   没给就退回工位不良率汇总（页面原有的大盘口径）。
  router.get("/report/spc", requireMesrjPerm(null), async (req, res) => {
    const station = String(req.query.station || "").trim();
    const param = String(req.query.param || "").trim();
    if (!station || !param) {
      const rows = await query(
        `SELECT station_code,
                COUNT(*) AS total,
                COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END) AS ng_qty,
                COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) NOT IN ('NG','FAIL') OR pass_ng='' THEN 1 END) AS good_qty,
                ROUND(100.0 * COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END) / NULLIF(COUNT(*),0), 2) AS ng_rate
         FROM prd_machine_data
         WHERE created_at >= now() - interval '7 days'
         GROUP BY station_code
         ORDER BY total DESC`);
      return ok(res, { rows: rows.rows });
    }
    const where = ["station_code=$1", "param_key=$2"], args = [station, param];
    const d1 = String(req.query.d1 || "").trim();
    const d2 = String(req.query.d2 || "").trim();
    if (d1) { args.push(d1); where.push(`test_time::date >= $${args.length}`); }
    if (d2) { args.push(d2); where.push(`test_time::date <= $${args.length}`); }
    const all = (await query(
      `SELECT sn, param_val, result, test_time FROM prd_test WHERE ${where.join(" AND ")}
        ORDER BY test_time, id`, args)).rows;
    const latest = new Map();
    for (const r of all) latest.set(r.sn, r);
    /** @type {Array<{sn: any, val: number, result: any, time: string, ooc?: boolean}>} */
    const points = [];
    for (const r of latest.values()) {
      const v = Number(r.param_val);
      if (!Number.isFinite(v)) continue;
      points.push({ sn: r.sn, val: v, result: r.result, time: tsLocal(r.test_time) });
    }
    const vals = points.map(p => p.val);
    if (vals.length < 2) {
      return ok(res, { points, stats: null, msg: "数据不足（<2 点），无法绘制控制图", station, param });
    }
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
    const ucl = mean + 3 * std, lcl = mean - 3 * std;
    const numOf = v => {
      const s = String(v ?? "").trim();
      return s === "" ? null : (Number.isFinite(Number(s)) ? Number(s) : null);
    };
    const usl = numOf(await getParam("spc.usl", ""));
    const lsl = numOf(await getParam("spc.lsl", ""));
    let cp = null, cpk = null;
    if (usl !== null && lsl !== null && std > 0) {
      cp = (usl - lsl) / (6 * std);
      cpk = Math.min((usl - mean) / (3 * std), (mean - lsl) / (3 * std));
    }
    for (const p of points) p.ooc = p.val > ucl || p.val < lcl;
    const r4 = x => Math.round(x * 10000) / 10000;
    return ok(res, {
      points, station, param,
      stats: { n, mean: r4(mean), std: r4(std), ucl: r4(ucl), lcl: r4(lcl),
        cp: cp === null ? null : Math.round(cp * 1000) / 1000,
        cpk: cpk === null ? null : Math.round(cpk * 1000) / 1000, usl, lsl },
    });
  });

  // ── 预警规则 ──
  router.get("/alert/rules", requireMesrjPerm(null), async (_req, res) => {
    const rows = await query("SELECT * FROM cfg_alert_rule ORDER BY id");
    return ok(res, rows.rows);
  });

  router.post("/alert/rules", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    await query(`INSERT INTO cfg_alert_rule (rule_key,rule_name,source,cond,value,unit,level,action,enabled,remark,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
      [d.rule_key, d.rule_name, d.source, d.cond, d.value, d.unit, d.level, d.action, d.enabled !== false ? 1 : 0, d.remark || ""]);
    return ok(res, {}, "规则已保存");
  });

  // ── 预警列表 ──
  router.get("/alert/list", requireMesrjPerm(null), async (_req, res) => {
    const rows = await query("SELECT * FROM prd_alert ORDER BY id DESC LIMIT 200");
    return ok(res, rows.rows);
  });

  // ── 预警处置 ──
  router.post("/alert/handle", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const id = Number(d.id || 0);
    if (!id) return fail(res, "缺少告警ID");
    await query("UPDATE prd_alert SET status='已处理',handled_by=$1,handled_at=now() WHERE id=$2",
      [(req.user && req.user.login_name) || "", id]);
    return ok(res, {}, "已处置");
  });

  // ── 活跃预警 ──
  router.get("/alert/active", requireMesrjPerm(null), async (_req, res) => {
    const rows = await query("SELECT * FROM prd_alert WHERE status='待处理' ORDER BY id DESC LIMIT 100");
    return ok(res, rows.rows);
  });

  // ── 预警检查（源 analyze.py alert center）──
  //   评估启用的规则（近 1 天机台数据按工位不良率），触发的落库并返回；
  //   mesrj-scheduler 用同一份 src/mesrj/alert.js 定时跑（alert.scan_minutes）。
  router.get("/alert/check", requireMesrjPerm(null), async (_req, res) => {
    await alertMod.checkAlerts();
    const rows = await query("SELECT * FROM prd_alert WHERE status='待处理' ORDER BY id DESC LIMIT 100");
    return ok(res, { alerts: rows.rows });
  });
}
