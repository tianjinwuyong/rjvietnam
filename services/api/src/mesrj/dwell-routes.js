// ============================================================================
// 时效（Dwell Time）管控（源 api/dwell.py + core/dwell.py） —— 从 routes/mesrj.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮1续）。
// 依赖经 registerDwellRoutes(router, deps) 注入，与 smta-routes/ultra 同一约定；
// 注册位置在 createMesrjRouter 内保持不变（JWT 之后，顺序即原块顺序）。
// ============================================================================
import * as dwell from "./dwell.js";

export function registerDwellRoutes(router, { query, ok, fail, perm: requireMesrjPerm }) {
  // ════════════════════════════════════════════════════════════════════════════
  // 时效（Dwell Time）管控 —— 源 api/dwell.py + core/dwell.py
  //   站间停留超时：规则 cfg_dwell_rule，动作 预警/拦截；实时校验挂在过站引擎里，
  //   定时扫描（卡在原地不动）由 POST /dwell/scan 触发（本仓暂无内建 scheduler）。
  // ════════════════════════════════════════════════════════════════════════════
  const DWELL_PROC_NAME = { "01": "SMT", "02": "DIP", "03": "组装", "04": "包装" };

  // ── 规则清单（带人话名）──
  router.get("/dwell/rules", requireMesrjPerm("prod.trace"), async (_req, res) => {
    await dwell.ensureSchema();
    const rows = (await query("SELECT * FROM cfg_dwell_rule ORDER BY id")).rows;
    for (const r of rows) {
      r.from_name = await dwell.keyName(r.from_key);
      r.to_name = await dwell.keyName(r.to_key);
    }
    return ok(res, rows);
  });

  // ── 下拉选项（工序 / 工位类型 / 工位编码）──
  router.get("/dwell/meta", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const procs = ["01", "02", "03", "04"].map(p => ({ key: p, name: `${p} ${DWELL_PROC_NAME[p]}` }));
    const types = (await query(
      `SELECT type_code AS key, type_code AS name, process_code, COUNT(*)::int AS station_count
         FROM md_station WHERE COALESCE(type_code,'')<>''
        GROUP BY type_code, process_code ORDER BY process_code, type_code`)).rows;
    const stations = (await query(
      `SELECT station_code, short_name, station_name, line_code, process_code
         FROM md_station ORDER BY process_code, station_code`)).rows.map(s => ({
           key: s.station_code,
           name: `${s.station_code} · ${s.short_name || s.station_name || ""}`,
         }));
    return ok(res, { processes: procs, types, stations });
  });

  // ── 新增 / 修改规则 ──
  router.post("/dwell/rule/save", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const d = req.body || {};
    await dwell.ensureSchema();
    const fromKey = String(d.from_key || "").trim();
    const toKey = String(d.to_key || "").trim();
    const maxHours = Number(d.max_hours || 0);
    const action = String(d.action || dwell.ACTION_WARN).trim();
    if (!fromKey || !toKey) return fail(res, "起点、终点都必须填");
    if (!(maxHours > 0)) return fail(res, "限时（小时）必须大于 0");
    if (action !== dwell.ACTION_WARN && action !== dwell.ACTION_BLOCK) {
      return fail(res, "动作只能是「预警」或「拦截」");
    }
    const name = String(d.rule_name || "").trim()
      || `${await dwell.keyName(fromKey)} → ${await dwell.keyName(toKey)}`;
    const enabled = Number(d.enabled ?? 1) ? 1 : 0;
    const remark = String(d.remark || "").trim();
    const id = Number(d.id || 0);
    if (id) {
      await query(
        `UPDATE cfg_dwell_rule SET rule_name=$1, from_key=$2, to_key=$3, max_hours=$4,
          action=$5, enabled=$6, remark=$7 WHERE id=$8`,
        [name, fromKey, toKey, maxHours, action, enabled, remark, id]);
    } else {
      await query(
        `INSERT INTO cfg_dwell_rule (rule_name, from_key, to_key, max_hours, action, enabled, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [name, fromKey, toKey, maxHours, action, enabled, remark]);
    }
    return ok(res, { id: id || 0 }, "已保存");
  });

  // ── 删除规则 ──
  router.post("/dwell/rule/delete", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const id = Number((req.body || {}).id || 0);
    if (!id) return fail(res, "缺少 id");
    await query("DELETE FROM cfg_dwell_rule WHERE id=$1", [id]);
    return ok(res, null, "已删除");
  });

  // ── 超期清单（页面用：总数 / 严重 / 各工位分布）──
  router.get("/dwell/overdue", requireMesrjPerm("prod.trace"), async (req, res) => {
    const days = Number(req.query.days || 7) || 7;
    return ok(res, await dwell.summary(days));
  });

  // ── 立即扫描（把超期品写进预警中心）──
  router.post("/dwell/scan", requireMesrjPerm("prod.trace"), async (req, res) => {
    const days = Number((req.body || {}).days || 7) || 7;
    const items = await dwell.scan(days, true);
    return ok(res, { total: items.length, items: items.slice(0, 500) },
      `扫出 ${items.length} 颗超期品`);
  });

  // ── 单颗 SN 的时效体检（相邻两站停留 vs 规则）──
  router.get("/dwell/check", requireMesrjPerm("prod.trace"), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "SN 必填");
    const rows = (await query(
      `SELECT station_code, pass_time, result, mo_no FROM prd_pass
        WHERE sn=$1 ORDER BY id DESC LIMIT 40`, [sn])).rows;
    if (!rows.length) return ok(res, { sn, gaps: [], msg: "这颗 SN 还没有过站记录" });
    const gaps = [];
    let prev = null;
    for (const r of rows.slice().reverse()) {
      if (prev) {
        const rule = await dwell.findRule(prev.station_code, r.station_code);
        const h = (new Date(r.pass_time).getTime() - new Date(prev.pass_time).getTime()) / 3600000;
        if (rule && Number.isFinite(h)) {
          const lim = Number(rule.max_hours || 0);
          gaps.push({
            from: prev.station_code, to: r.station_code,
            hours: Number(h.toFixed(2)), max_hours: lim,
            over: Number(Math.max(0, h - lim).toFixed(2)),
            rule_name: rule.rule_name, action: rule.action || dwell.ACTION_WARN,
          });
        }
      }
      prev = r;
    }
    return ok(res, { sn, gaps });
  });
}
