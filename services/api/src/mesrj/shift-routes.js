// ============================================================================
// 班次填报看板/汇总/工位映射（源 api/shift.py） —— 从 routes/mesrj.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮1续）。
// 依赖经 registerShiftRoutes(router, deps) 注入，与 smta-routes/ultra 同一约定；
// 注册位置在 createMesrjRouter 内保持不变（JWT 之后，顺序即原块顺序）。
// ============================================================================


export function registerShiftRoutes(router, { query, ok, fail, getParam, setParam, audit, perm: requireMesrjPerm }) {
  // ════════════════════════════════════════════════════════════════════════════
  // 班次填报看板 / 汇总 / 补录选项 / 工段-工位映射（源 api/shift.py）
  //   填报本身在 /mes/shift-fill（shift-fill.js），这里补 legacy 的另 4 个入口。
  // ════════════════════════════════════════════════════════════════════════════
  const DEFAULT_STATION_MAP = {
    "SMT": ["SMT-"], "SMT-PCB1": ["SMT-"], "SMT-PCB2": ["SMT-"],
    "插件": ["AI", "ICT"], "加工": ["AI", "PRESS"],
    "组装": ["ASSY"], "老化": ["AGING"], "包装": ["PACK"],
  };
  const shiftMap = async () => {
    const raw = String(await getParam("shift.station_map", "")).trim();
    if (!raw) return DEFAULT_STATION_MAP;
    try {
      const m = JSON.parse(raw);
      return Object.fromEntries(Object.entries(m)
        .map(([k, v]) => [String(k), Array.isArray(v) ? v.map(String) : [String(v)]]));
    } catch {
      return DEFAULT_STATION_MAP;
    }
  };
  const shiftHours = async () => ({
    DAY: Number(await getParam("plan.hours_day", "10")) || 10,
    NIGHT: Number(await getParam("plan.hours_night", "10")) || 10,
  });
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const calcRow = (row, stdUph) => {
    const plan = num(row.plan_qty), done = num(row.done_qty);
    const ppl = num(row.headcount), hrs = num(row.work_hours);
    row.uph = hrs > 0 ? Number((done / hrs).toFixed(2)) : 0;
    row.upph = ppl > 0 && hrs > 0 ? Number((done / ppl / hrs).toFixed(2)) : 0;
    row.total_hours = Number((hrs * ppl).toFixed(2));
    row.rate = plan > 0 ? Number(((done / plan) * 100).toFixed(1)) : 0;
    row.eff = stdUph > 0 ? Number(((row.uph / stdUph) * 100).toFixed(1)) : 0;
    return row;
  };

  // GET /shift/board — 当天某班次的填报看板（源 shift_board）
  router.get("/shift/board", requireMesrjPerm(null), async (req, res) => {
    const d1 = String(req.query.date || "").slice(0, 10)
      || (await query("SELECT now()::date::text AS d")).rows[0].d;
    const shift = String(req.query.shift || "DAY").toUpperCase();
    const line = String(req.query.line_code || "").trim();
    const hours = await shiftHours();
    const caps = (await query("SELECT * FROM cfg_capacity WHERE enabled=1")).rows;
    const capOf = (ln, prod, proc) => caps.find(c => c.product_code === prod
      && String(c.process || "") === String(proc || "")
      && (!ln || c.line_code === ln));
    // 排产没写线别时，按产能主数据补（源 _line_of：SMT 开头允许匹配任一 SMT 线）
    const lineOf = (prod, proc) => {
      const p = String(proc || "");
      const hit = caps.find(c => c.product_code === prod && (String(c.process || "") === p
        || (p.startsWith("SMT") && String(c.process || "").startsWith("SMT"))));
      return hit?.line_code || "";
    };
    const plans = (await query(
      `SELECT s.id, s.mo_no, s.product_code, s.process, s.plan_qty, s.line_code,
              p2.product_model AS model
         FROM pln_schedule s
         LEFT JOIN ord_mo m ON m.mo_no = s.mo_no
         LEFT JOIN md_product p2 ON p2.product_code = COALESCE(m.fg_code, s.product_code)
        WHERE s.plan_date::text = $1 AND s.shift_code = $2
          AND COALESCE(s.status,'') <> '已取消'
          AND COALESCE(s.mo_no,'') <> '' AND COALESCE(s.process,'') <> ''
        ORDER BY s.id`, [d1, shift])).rows;
    const merged = new Map();
    for (const p of plans) {
      const proc = String(p.process || "").trim();
      const ln = String(p.line_code || "").trim() || lineOf(p.product_code, proc);
      if (line && ln && ln !== line) continue;
      const k = `${p.mo_no}|${proc}`;
      const a = merged.get(k);
      if (!a) {
        const cap = capOf(ln, p.product_code, proc);
        merged.set(k, {
          plan_id: p.id, mo_no: p.mo_no, product_code: p.product_code || "", process: proc,
          model: p.model || "", line_code: ln, plan_qty: num(p.plan_qty),
          std_uph: num(cap?.uph), std_headcount: num(cap?.std_headcount),
          plan_remark: "",
        });
      } else {
        a.plan_qty += num(p.plan_qty);
      }
    }
    const reps = (await query(
      `SELECT * FROM prd_shift_report WHERE report_date::date = $1::date AND shift_code=$2`, [d1, shift])).rows;
    const repByKey = new Map(reps.map(r => [`${r.mo_no}|${r.process}`, r]));
    const rows = [], used = new Set();
    for (const [k, a] of merged) {
      const r = repByKey.get(k);
      used.add(k);
      rows.push(calcRow({
        ...a, filled: Boolean(r), report_id: r?.id ?? null,
        done_qty: num(r?.done_qty), ng_qty: num(r?.ng_qty),
        headcount: r ? num(r.headcount) : a.std_headcount,
        work_hours: r ? num(r.work_hours) : (hours[shift] || 10),
        remark: r?.remark || "", manual: false,
      }, a.std_uph));
    }
    // 计划外补录：排产被删/临时插单，但填报记录仍在
    for (const [k, r] of repByKey) {
      if (used.has(k)) continue;
      if (line && String(r.line_code || "") !== "" && r.line_code !== line) continue;
      rows.push(calcRow({
        plan_id: r.plan_id, mo_no: r.mo_no, product_code: r.product_code || "",
        process: r.process || "", line_code: r.line_code || "",
        plan_qty: num(r.plan_qty), std_uph: 0, std_headcount: num(r.headcount),
        plan_remark: "", filled: true, report_id: r.id, manual: true,
        done_qty: num(r.done_qty), ng_qty: num(r.ng_qty),
        headcount: num(r.headcount), work_hours: num(r.work_hours),
        remark: r.remark || "",
      }, 0));
    }
    return ok(res, {
      date: d1, shift, rows, hours: hours[shift] || 10,
      totals: {
        plan_qty: rows.reduce((a, x) => a + num(x.plan_qty), 0),
        done_qty: rows.reduce((a, x) => a + num(x.done_qty), 0),
        ng_qty: rows.reduce((a, x) => a + num(x.ng_qty), 0),
      },
    });
  });

  // GET /shift/summary — 按 日/线/工段/工单/机型 汇总（源 shift_summary）
  router.get("/shift/summary", requireMesrjPerm(null), async (req, res) => {
    const d1 = String(req.query.d1 || "").slice(0, 10)
      || (await query("SELECT now()::date::text AS d")).rows[0].d;
    const d2 = String(req.query.d2 || "").slice(0, 10) || d1;
    const group = String(req.query.group || "day");
    const col = { day: "report_date", line: "line_code", process: "process",
      mo: "mo_no", product: "product_code" }[group] || "report_date";
    const line = String(req.query.line_code || "").trim();
    const where = ["report_date::date BETWEEN $1::date AND $2::date"], args = [d1, d2];
    if (line) { args.push(line); where.push(`line_code=$${args.length}`); }
    const rows = (await query(
      `SELECT ${col === "report_date" ? "report_date::date::text" : col} AS k, COUNT(*)::int AS cnt,
              COALESCE(SUM(plan_qty),0) AS plan_qty, COALESCE(SUM(done_qty),0) AS done_qty,
              COALESCE(SUM(ng_qty),0) AS ng_qty, COALESCE(SUM(total_hours),0) AS total_hours
         FROM prd_shift_report WHERE ${where.join(" AND ")}
        GROUP BY ${col === "report_date" ? "report_date::date::text" : col} ORDER BY k`, args)).rows;
    for (const r of rows) {
      const plan = num(r.plan_qty), done = num(r.done_qty), ng = num(r.ng_qty), th = num(r.total_hours);
      r.rate = plan > 0 ? Number(((done / plan) * 100).toFixed(1)) : null;
      r.ng_rate = (done + ng) > 0 ? Number(((ng / (done + ng)) * 100).toFixed(1)) : 0;
      r.upph = th > 0 ? Number((done / th).toFixed(2)) : 0;
    }
    return ok(res, { group, rows, d1, d2 });
  });

  // GET /shift/options — 补录用：工单 + 工段 + 产能主数据（源 shift_options）
  router.get("/shift/options", requireMesrjPerm(null), async (req, res) => {
    const kw = String(req.query.keyword || "").trim();
    const where = ["m.status NOT IN ('已关闭','已取消')"], args = [];
    if (kw) {
      args.push(`%${kw}%`);
      where.push(`(m.mo_no ILIKE $${args.length} OR m.product_code ILIKE $${args.length}
                   OR p.product_model ILIKE $${args.length})`);
    }
    const mos = (await query(
      `SELECT m.mo_no, m.product_code, m.plan_qty, m.line_code, m.status,
              m.process_code, p.product_model AS model
         FROM ord_mo m LEFT JOIN md_product p ON p.product_code = m.fg_code
        WHERE ${where.join(" AND ")} ORDER BY m.mo_no DESC LIMIT 300`, args)).rows;
    const processes = (await query(
      `SELECT process_code FROM cfg_process WHERE COALESCE(enabled,1)<>0
        ORDER BY sort_no, process_code`)).rows.map(r => r.process_code);
    const caps = (await query(
      "SELECT line_code, product_code, process, uph, std_headcount FROM cfg_capacity WHERE enabled=1")).rows;
    return ok(res, { mos, processes, caps });
  });

  // GET/POST /shift/stationmap — 工段 ↔ 工位关键词映射（源 shift_stationmap，存 sys_param）
  router.get("/shift/stationmap", requireMesrjPerm(null), async (_req, res) => {
    return ok(res, { map: await shiftMap(), default: DEFAULT_STATION_MAP });
  });
  router.post("/shift/stationmap", requireMesrjPerm("md.shift"), async (req, res) => {
    const m = (req.body || {}).map;
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      return fail(res, "map 必须是对象，如 {\"包装\": [\"PACK\"]}");
    }
    const norm = Object.fromEntries(Object.entries(m)
      .map(([k, v]) => [String(k), Array.isArray(v) ? v.map(String) : [String(v)]]));
    await setParam("shift.station_map", JSON.stringify(norm), "填报-MES工位映射", "计划");
    return ok(res, norm, "已保存");
  });

  // POST /shift/save — 整表提交（按 日期+班次+工单+工段 覆盖，源 shift_save）
  router.post("/shift/save", requireMesrjPerm("md.shift"), async (req, res) => {
    const d = req.body || {};
    const date = String(d.date || "").slice(0, 10)
      || (await query("SELECT now()::date::text AS d")).rows[0].d;
    const shift = String(d.shift || "DAY").toUpperCase();
    const rowsIn = Array.isArray(d.rows) ? d.rows : [];
    if (!rowsIn.length) return fail(res, "没有要保存的数据");
    const user = req.mesrjUser?.login_name || "";
    let saved = 0, cleared = 0, skipped = 0;
    for (const r of rowsIn) {
      const mo = String(r.mo_no || "").trim();
      const proc = String(r.process || "").trim();
      if (!mo || !proc) { skipped += 1; continue; }
      const done = num(r.done_qty), ng = num(r.ng_qty);
      const ppl = num(r.headcount), hrs = num(r.work_hours);
      const remark = String(r.remark || "").trim().slice(0, 200);
      // 整行清空：之前填过 → 删旧记录（否则旧数字赖着不走）；没填过 → 跳过
      if (done === 0 && ng === 0 && !remark) {
        const rid = Number(r.report_id || 0);
        if (rid) {
          await query("DELETE FROM prd_shift_report WHERE id=$1", [rid]);
          cleared += 1;
        } else skipped += 1;
        continue;
      }
      if (done < 0 || ng < 0 || ppl < 0 || hrs < 0) return fail(res, `${mo} / ${proc} 的数字不能为负`);
      if (hrs > 24) return fail(res, `${mo} / ${proc} 的生产工时超过 24 小时，请检查`);
      const calc = calcRow({ plan_qty: num(r.plan_qty), done_qty: done, ng_qty: ng,
        headcount: ppl, work_hours: hrs }, num(r.std_uph));
      await query(
        `INSERT INTO prd_shift_report
           (report_date, shift_code, line_code, mo_no, product_code, process,
            plan_qty, done_qty, ng_qty, headcount, work_hours,
            uph, upph, total_hours, rate, eff, remark, plan_id, src,
            created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'manual',$19,now(),now())
         ON CONFLICT (report_date, shift_code, mo_no, process) DO UPDATE SET
           line_code=EXCLUDED.line_code, product_code=EXCLUDED.product_code,
           plan_qty=EXCLUDED.plan_qty, done_qty=EXCLUDED.done_qty, ng_qty=EXCLUDED.ng_qty,
           headcount=EXCLUDED.headcount, work_hours=EXCLUDED.work_hours,
           uph=EXCLUDED.uph, upph=EXCLUDED.upph, total_hours=EXCLUDED.total_hours,
           rate=EXCLUDED.rate, eff=EXCLUDED.eff, remark=EXCLUDED.remark, updated_at=now()`,
        [date, shift, String(r.line_code || "").trim(), mo, String(r.product_code || "").trim(), proc,
          num(r.plan_qty), done, ng, ppl, hrs, calc.uph, calc.upph, calc.total_hours,
          calc.rate, calc.eff, remark, Number(r.plan_id || 0) || null, user]);
      saved += 1;
    }
    return ok(res, { saved, cleared, skipped }, `保存 ${saved} 条`);
  });

  // POST /shift/delete — 删除一条填报（源 shift_delete）
  router.post("/shift/delete", requireMesrjPerm("md.shift"), async (req, res) => {
    const id = Number((req.body || {}).id || 0);
    if (!id) return fail(res, "缺少 id");
    const row = (await query("SELECT * FROM prd_shift_report WHERE id=$1", [id])).rows[0];
    if (!row) return fail(res, "记录不存在");
    await query("DELETE FROM prd_shift_report WHERE id=$1", [id]);
    await audit(req.mesrjUser?.login_name || "", "生产执行", "删除填报",
      `${row.report_date} ${row.shift_code} ${row.mo_no}/${row.process}`, req.ip);
    return ok(res, null, "已删除");
  });
}
