// ============================================================================
// W10 辅料管控路由（源 api/smta.py，31 路由）—— 从 routes/mesrj.js 整段搬迁
// （refactor-plan-2026-11-21 阶段3轮1；语义零改动，仅缩进不变地平移）。
// 依赖经 registerSmtaRoutes(router, deps) 注入，与 ultra/fixture 等同一约定：
//   query/ok/fail/getParam/audit 来自 routes/mesrj.js（信封与审计单一实现），
//   perm = requireMesrjPerm（登录态权限中间件，本域全部路由在 JWT 之后注册）。
// 时间列全为 varchar（migration 286），统一 nowStr() "YYYY-MM-DD HH:MM:SS"。
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { nowStr, todayStr } from "./domain.js";

export function registerSmtaRoutes(router, { query, ok, fail, getParam, audit, perm: requireMesrjPerm }) {
  // ── W10：辅料管控（源 api/smta.py，31 路由）──────────────────────────────
  //   锡膏/红胶回温追溯 · 钢网寿命（按印刷次数）· 刮刀寿命 + 上/下机绑定
  //   SMT 站位绑码（贴片上料防呆唯一数据源）· 时间阈值 · 钢网印刷参数
  //   GKG 印刷机 CSV · PDA 三合一扫码 · 按工单追辅料
  // 时间列全为 varchar（与 migration 286 一致），统一用 nowStr() "YYYY-MM-DD HH:MM:SS"。

  // ── 源 api/smta.py 辅助函数 ──────────────────────────────────────────────

  /** 源 _parse_dt：解析 "YYYY-MM-DD[ HH:MM[:SS]]"（本地时区） */
  function _smtaDt(s) {
    const t = String(s || "").trim().replace("T", " ");
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  /** 源 _hours：b - a 的小时数（保留 2 位） */
  function _smtaHours(a, b) {
    const da = _smtaDt(a), dbb = _smtaDt(b);
    if (!da || !dbb) return 0;
    return Math.round(((dbb.getTime() - da.getTime()) / 3600000) * 100) / 100;
  }

  /** 源 _days_left：距效期还有几天（负数=已过期） */
  function _smtaDaysLeft(expireDate) {
    const d = _smtaDt(expireDate);
    if (!d) return null;
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const t1 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((t1.getTime() - t0.getTime()) / 86400000);
  }

  /** 源 _life：寿命 = 使用次数，使用率 = 累计/上限 */
  function _smtaLife(used, maxTimes, warnPct) {
    const u = Number(used || 0), mx = Number(maxTimes || 0);
    if (mx <= 0) return { used: u, max: mx, left: null, pct: 0, state: "未设上限" };
    const pct = Math.round((u / mx) * 1000) / 10;
    const wp = Number(warnPct || 80);
    const state = pct >= 100 ? "已达寿命" : (pct >= wp ? "预警" : "正常");
    return { used: u, max: mx, left: Math.round((mx - u) * 100) / 100, pct, state };
  }

  /** 源 _param：取辅料时间参数（按类型；没有则取第一条） */
  async function _smtaParam(pasteType) {
    const r = (await query("SELECT * FROM cfg_paste_param WHERE paste_type=$1", [pasteType || ""])).rows[0];
    if (r) return r;
    return (await query("SELECT * FROM cfg_paste_param ORDER BY id LIMIT 1")).rows[0] || null;
  }

  /** 源 _paste_row：把一条 prd_paste 加工成带判定的字典 */
  async function _smtaPasteRow(r, prm) {
    const d = { ...r };
    const p = prm || await _smtaParam(d.paste_type || "");
    const dl = _smtaDaysLeft(d.expire_date);
    const warnDays = p ? Number(p.warn_days || 7) : 7;
    d.days_left = dl;
    d.expire_flag = dl === null ? "" : (dl < 0 ? "已过期" : (dl <= warnDays ? "临期" : "正常"));
    d.warn = d.expire_flag === "已过期" || d.expire_flag === "临期";
    // 最近一条回温记录 → 算待用是否超时
    const w = (await query(
      "SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='WARM' ORDER BY id DESC LIMIT 1",
      [d.batch_no])).rows[0];
    if (w && p) {
      d.warm_end = w.end_time || "";
      d.warm_ok = Number(w.is_ok || 0);
      if (d.warm_end) {
        const waitStd = Number(p.wait_hours || 8);
        const used = _smtaHours(d.warm_end, nowStr());
        d.wait_used_h = used;
        d.wait_left_h = Math.round((waitStd - used) * 100) / 100;
        d.wait_over = used > waitStd;
      }
    }
    return d;
  }

  /** 源 util.model_key：去掉空格/横杠/下划线/斜杠并转大写 */
  function _smtaModelKey(s) {
    return String(s || "").toUpperCase().replace(/[\s\-_/]+/g, "");
  }

  /** 源 util.model_match：任一方为空 → true（没维护就不拦） */
  function _smtaModelMatch(a, b) {
    const ka = _smtaModelKey(a), kb = _smtaModelKey(b);
    if (!ka || !kb) return true;
    if (ka === kb) return true;
    if (Math.min(ka.length, kb.length) < 4) return false;
    return ka.includes(kb) || kb.includes(ka);
  }

  /** 源 _pda_mo_ctx：PDA 上料要带出的工单上下文 */
  async function _smtaMoCtx(moNo) {
    moNo = String(moNo || "").trim();
    if (!moNo) return null;
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return null;
    let model = String(mo.product_model || "").trim();
    if (!model) {
      const p = (await query("SELECT product_model FROM md_product WHERE product_code=$1",
        [mo.product_code || ""])).rows[0];
      model = String((p && p.product_model) || "").trim();
    }
    return {
      mo_no: mo.mo_no,
      product_code: mo.product_code || "",
      product_model: model,
      feeder_model: String(mo.feeder_model || "").trim(),
      line_code: mo.line_code || "",
      status: mo.status || "",
      plan_qty: Number(mo.plan_qty || 0),
      out_qty: Number(mo.out_qty || 0),
    };
  }

  /** 源 _match_stencil：钢网适用机型 vs 本工单机型（钢网是分面的，PCB1/PCB2 不能共用） */
  function _smtaMatchStencil(st, mo) {
    if (!mo) return { level: "warn", why: "未选工单，未核对钢网适用机型" };
    const mm = String(mo.product_model || "").trim();
    const fm = String(mo.feeder_model || "").trim();
    if (!(mm || fm)) return { level: "warn", why: "工单没维护机型，没得核对" };
    const precise = String(st.model || "").trim();
    const series = String(st.models || "").trim();
    const hit = x => _smtaModelMatch(x, mm) || (!!fm && _smtaModelMatch(x, fm));
    if (precise) {
      if (hit(precise)) return { level: "ok", why: `适用机型 ${precise} ✓` };
      return { level: "block", why: `✕ 这钢网是「${precise}」用的，本工单是「${mm || fm}」—— 上错机台会整批印错` };
    }
    if (series) {
      if (hit(series)) return { level: "warn", why: `这钢网只维护了系列「${series}」、没写具体面，按系列放行，请确认是不是这一面` };
      return { level: "block", why: `✕ 这钢网是「${series}」用的，本工单是「${mm || fm}」` };
    }
    return { level: "warn", why: "钢网台账没维护适用机型，没得核对" };
  }

  /** 源 _match_common：刮刀 / 锡膏红胶不绑机型，但必须挂工单才追得回 */
  function _smtaMatchCommon(mo, what) {
    if (!mo) return { level: "warn", why: `未选工单，本次${what}记录不会挂到工单上（追溯断链）` };
    return { level: "ok", why: `${what}不绑机型，会记到工单 ${mo.mo_no} 上` };
  }

  // ═══ 通用 CRUD（源 _crud.register；固定路径已全部注册完，通配放最后）═══════
  // ── W10-a：锡膏 / 红胶（源 smta/paste*）────────────────────────────────
  // ⚠ 时间列全为 varchar：跨天/跨月判断一律走 JS 侧 _smtaDt（本地时区），
  //    不用 PG 的 timestamp 比较 —— 源库存的是 'YYYY-MM-DD HH:MM:SS' 字符串。

  /** 源 paste_add 的有效期推算：到货日 + valid_months 个月 */
  function _smtaAddMonths(dateStr, months) {
    const d = _smtaDt(dateStr);
    if (!d) return "";
    const m = Number(months || 0);
    const y = d.getFullYear() + Math.floor((d.getMonth() + m) / 12);
    const mo = (d.getMonth() + m) % 12;
    const day = d.getDate();
    const probe = new Date(y, mo, day);
    if (probe.getDate() !== day) return "";   // 源 replace() 抛异常 → expire 置空
    const p = n => String(n).padStart(2, "0");
    return `${y}-${p(mo + 1)}-${p(day)}`;
  }

  router.get("/smta/paste", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kw = String(req.query.kw || "").trim();
    const ptype = String(req.query.ptype || "").trim();
    const onlyWarn = ["1", "true"].includes(String(req.query.only_warn || ""));
    const w = ["1=1"], args = [];
    if (kw) {
      w.push(`(batch_no ILIKE $${args.length + 1} OR material_code ILIKE $${args.length + 2} OR product_name ILIKE $${args.length + 3})`);
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    if (ptype) { w.push(`paste_type=$${args.length + 1}`); args.push(ptype); }
    const rows = (await query(
      `SELECT * FROM prd_paste WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 500`, args)).rows;
    const prms = {};
    for (const p of (await query("SELECT * FROM cfg_paste_param")).rows) prms[p.paste_type] = p;
    const items = [];
    for (const r of rows) items.push(await _smtaPasteRow(r, prms[r.paste_type]));
    const flagged = onlyWarn ? items.filter(x => x.warn || x.wait_over) : items;
    const params = (await query("SELECT * FROM cfg_paste_param ORDER BY id")).rows;
    return ok(res, {
      items: flagged, total: flagged.length,
      warn_count: flagged.filter(x => x.warn || x.wait_over).length,
      params,
    });
  });

  router.post("/smta/paste", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const batch = String(d.batch_no || "").trim();
    const ptype = String(d.paste_type || "").trim();
    if (!batch || !ptype) return fail(res, "批次号和物料类型必填");
    if (!["红胶", "锡膏"].includes(ptype)) return fail(res, "物料类型只能是「红胶」或「锡膏」");
    const prm = await _smtaParam(ptype);
    const arrive = String(d.arrive_date || "").trim() || todayStr();
    let expire = String(d.expire_date || "").trim();
    if (!expire && prm) expire = _smtaAddMonths(arrive, Number(prm.valid_months || 6));
    const now = nowStr();
    const user = (req.mesrjUser || {}).login_name || "";
    const initQty = Number(d.init_qty || 0);
    const old = (await query("SELECT * FROM prd_paste WHERE batch_no=$1", [batch])).rows[0];
    if (old) {
      await query(
        `UPDATE prd_paste SET paste_type=$1, material_code=$2, product_name=$3, supplier=$4,
           arrive_date=$5, expire_date=$6, storage_temp=$7, init_qty=$8, place=$9, remark=$10, updated_at=$11
         WHERE id=$12`,
        [ptype,
          String(d.material_code || old.material_code || ""),
          String(d.product_name || old.product_name || ""),
          String(d.supplier || old.supplier || ""),
          arrive, expire || old.expire_date,
          String(d.storage_temp || old.storage_temp || ""),
          initQty || Number(old.init_qty || 0),
          String(d.place || old.place || ""),
          String(d.remark || old.remark || ""),
          now, old.id]);
      return ok(res, { batch_no: batch, updated: true }, `批次 ${batch} 已更新`);
    }
    await query(
      `INSERT INTO prd_paste (batch_no, paste_type, material_code, product_name, supplier,
           arrive_date, expire_date, storage_temp, init_qty, left_qty, status, place,
           operator, remark, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'在库',$10,$11,$12,$13,$13)`,
      [batch, ptype,
        String(d.material_code || "").trim(), String(d.product_name || "").trim(),
        String(d.supplier || "").trim(), arrive, expire, String(d.storage_temp || "").trim(),
        initQty, String(d.place || "").trim(), user, String(d.remark || "").trim(), now]);
    await audit(user, "辅料", "新增批次", batch, `${ptype} ${expire}`);
    return ok(res, { batch_no: batch, expire_date: expire }, `批次 ${batch} 已入台账（有效期 ${expire}）`);
  });

  router.post("/smta/paste/warm", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const batch = String(d.batch_no || "").trim();
    if (!batch) return fail(res, "批次号必填");
    const it = (await query("SELECT * FROM prd_paste WHERE batch_no=$1", [batch])).rows[0];
    if (!it) return fail(res, `批次 ${batch} 不在台账里，请先录入`, 404);
    const prm = await _smtaParam(it.paste_type);
    const std = prm ? Number(prm.warm_hours || 4) : 4;
    const start = String(d.start_time || "").trim();
    const end = String(d.end_time || "").trim();
    const user = (req.mesrjUser || {}).login_name || "";
    const now = nowStr();

    if (start && !end) {
      await query("UPDATE prd_paste SET status='回温中', updated_at=$1 WHERE batch_no=$2", [now, batch]);
      await query(
        `INSERT INTO prd_paste_log (batch_no, paste_type, log_type, start_time, std_hours, operator, shift, created_at)
         VALUES ($1,$2,'WARM',$3,$4,$5,$6,$7)`,
        [batch, it.paste_type, start, std, user, String(d.shift || "").trim(), now]);
      return ok(res, { batch_no: batch, std_hours: std }, `批次 ${batch} 开始回温（标准 ${std} 小时）`);
    }
    if (!end) return fail(res, "请传 start_time（开始回温）或 end_time（回温结束）");

    const log = (await query(
      "SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='WARM' ORDER BY id DESC LIMIT 1",
      [batch])).rows[0];
    const realStart = (log && log.start_time) ? log.start_time : start;
    if (!realStart) return fail(res, "没有回温开始时间，请先登记开始回温");
    const dur = _smtaHours(realStart, end);
    const isOk = dur >= std;
    if (log && !log.end_time) {
      await query("UPDATE prd_paste_log SET end_time=$1, duration_h=$2, std_hours=$3, is_ok=$4 WHERE id=$5",
        [end, dur, std, isOk ? 1 : 0, log.id]);
    } else {
      await query(
        `INSERT INTO prd_paste_log (batch_no, paste_type, log_type, start_time, end_time, duration_h,
           std_hours, is_ok, operator, created_at) VALUES ($1,$2,'WARM',$3,$4,$5,$6,$7,$8,$9)`,
        [batch, it.paste_type, realStart, end, dur, std, isOk ? 1 : 0, user, now]);
    }
    await query("UPDATE prd_paste SET status=$1, updated_at=$2 WHERE batch_no=$3",
      [isOk ? "待用" : "在库", now, batch]);
    const msg = `✓ 批次 ${batch} 回温完成：${dur.toFixed(2)} 小时（标准 ${std}）` +
      (isOk ? "，达标可待用" : "　**未达标，需继续回温**");
    return ok(res, { batch_no: batch, duration_h: dur, std_hours: std, ok: isOk }, msg);
  });

  router.post("/smta/paste/use", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const batch = String(d.batch_no || "").trim();
    const kind = String(d.type || "USE").trim().toUpperCase();
    if (!batch) return fail(res, "批次号必填");
    const it = (await query("SELECT * FROM prd_paste WHERE batch_no=$1", [batch])).rows[0];
    if (!it) return fail(res, `批次 ${batch} 不在台账里`, 404);
    const prm = await _smtaParam(it.paste_type);
    const user = (req.mesrjUser || {}).login_name || "";
    const now = nowStr();

    if (kind === "USE") {
      let warn = "";
      const w = (await query(
        "SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='WARM' ORDER BY id DESC LIMIT 1",
        [batch])).rows[0];
      if (w && w.end_time && prm) {
        const waitH = _smtaHours(w.end_time, now);
        const stdWait = Number(prm.wait_hours || 8);
        if (waitH > stdWait) warn = `（⚠ 回温后已放置 ${waitH.toFixed(2)} 小时，超过待用时限 ${stdWait} 小时）`;
      }
      await query(
        `INSERT INTO prd_paste_log (batch_no, paste_type, log_type, start_time, mo_no, line_code,
           machine_no, shift, operator, remark, created_at)
         VALUES ($1,$2,'USE',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [batch, it.paste_type, now, String(d.mo_no || "").trim(), String(d.line_code || "").trim(),
          String(d.machine_no || "").trim(), String(d.shift || "").trim(), user,
          String(d.remark || "").trim(), now]);
      await query("UPDATE prd_paste SET status='使用中', updated_at=$1 WHERE batch_no=$2", [now, batch]);
      return ok(res, { batch_no: batch, start_time: now }, `批次 ${batch} 已上线使用${warn}`);
    }

    const dispose = String(d.dispose || "回收").trim();
    const useLog = (await query(
      `SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='USE' AND COALESCE(end_time,'')=''
       ORDER BY id DESC LIMIT 1`, [batch])).rows[0];
    let dur = 0;
    if (useLog && useLog.start_time) {
      dur = _smtaHours(useLog.start_time, now);
      await query("UPDATE prd_paste_log SET end_time=$1, duration_h=$2, dispose=$3, qty=$4 WHERE id=$5",
        [now, dur, dispose, Number(d.left_qty || 0), useLog.id]);
    }
    let warn = "";
    if (prm && dur > Number(prm.open_hours || 8)) {
      warn = `（⚠ 开盖使用 ${dur.toFixed(2)} 小时，超过时限 ${prm.open_hours} 小时）`;
    }
    const status = dispose === "用完" ? "已用完" : (dispose === "报废" ? "已报废" : "在库");
    if (d.left_qty !== null && d.left_qty !== undefined && d.left_qty !== "") {
      await query("UPDATE prd_paste SET status=$1, left_qty=$2, updated_at=$3 WHERE batch_no=$4",
        [status, Number(d.left_qty || 0), now, batch]);
    } else {
      await query("UPDATE prd_paste SET status=$1, updated_at=$2 WHERE batch_no=$3", [status, now, batch]);
    }
    return ok(res, { batch_no: batch, duration_h: dur, dispose },
      `批次 ${batch} 已下线：使用 ${dur.toFixed(2)} 小时，处置「${dispose}」${warn}`);
  });

  router.get("/smta/paste/logs", requireMesrjPerm("prod.trace"), async (req, res) => {
    const batch = String(req.query.batch_no || "").trim();
    const w = ["1=1"], args = [];
    if (batch) { w.push(`batch_no=$${args.length + 1}`); args.push(batch); }
    const rows = (await query(
      `SELECT * FROM prd_paste_log WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 300`, args)).rows;
    return ok(res, { items: rows });
  });

  // ── W10-b：钢网（寿命按印刷次数）───────────────────────────────────────

  router.get("/smta/stencil", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kw = String(req.query.kw || "").trim();
    const w = ["1=1"], args = [];
    if (kw) {
      w.push(`(stencil_no ILIKE $${args.length + 1} OR models ILIKE $${args.length + 2} OR COALESCE(model,'') ILIKE $${args.length + 3})`);
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    const rows = (await query(
      `SELECT * FROM prd_stencil WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 500`, args)).rows;
    const items = rows.map(r => ({ ...r, ..._smtaLife(r.used_print_times, r.max_print_times, r.warn_pct) }));
    items.sort((a, b) => (b.pct || 0) - (a.pct || 0));
    return ok(res, {
      items, total: items.length,
      warn_count: items.filter(x => x.state === "预警" || x.state === "已达寿命").length,
    });
  });

  router.post("/smta/stencil", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.stencil_no || "").trim();
    if (!no) return fail(res, "钢网编号必填");
    const data = {
      stencil_no: no, sn: no,
      models: String(d.models || "").trim(),
      model: String(d.model || "").trim(),
      thickness: String(d.thickness || "").trim(),
      version: String(d.version || "").trim(),
      max_print_times: Number(d.max_print_times || 0),
      warn_pct: Number(d.warn_pct || 80),
      used_print_times: Number(d.used_print_times || 0),
      status: String(d.status || "在用").trim(),
      buy_date: String(d.buy_date || "").trim(),
      supplier: String(d.supplier || "").trim(),
      price: Number(d.price || 0),
      place: String(d.place || "").trim(),
      owner: String(d.owner || "").trim(),
    };
    const old = (await query("SELECT * FROM prd_stencil WHERE stencil_no=$1", [no])).rows[0];
    if (old) {
      await query(
        `UPDATE prd_stencil SET sn=$1, models=$2, model=$3, thickness=$4, version=$5,
           max_print_times=$6, warn_pct=$7, used_print_times=$8, status=$9, buy_date=$10,
           supplier=$11, price=$12, place=$13, owner=$14, updated_at=$15
         WHERE id=$16`,
        [data.sn, data.models, data.model, data.thickness, data.version,
          data.max_print_times, data.warn_pct, data.used_print_times, data.status,
          data.buy_date, data.supplier, data.price, data.place, data.owner, nowStr(), old.id]);
      return ok(res, { stencil_no: no, updated: true }, `钢网 ${no} 已更新`);
    }
    await query(
      `INSERT INTO prd_stencil (stencil_no, sn, models, model, thickness, version, max_print_times,
         warn_pct, used_print_times, status, buy_date, supplier, price, place, owner, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
      [no, no, data.models, data.model, data.thickness, data.version, data.max_print_times,
        data.warn_pct, data.used_print_times, data.status, data.buy_date, data.supplier,
        data.price, data.place, data.owner, nowStr()]);
    await audit((req.mesrjUser || {}).login_name || "", "辅料", "新增钢网", no, `上限 ${data.max_print_times} 次`);
    return ok(res, { stencil_no: no }, `钢网 ${no} 已入台账（寿命上限 ${data.max_print_times} 次）`);
  });

  router.post("/smta/stencil/use", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.stencil_no || "").trim();
    const times = Number(d.times || 0);
    if (!no || times <= 0) return fail(res, "钢网编号和本次使用次数必填");
    const it = (await query("SELECT * FROM prd_stencil WHERE stencil_no=$1", [no])).rows[0];
    if (!it) return fail(res, `钢网 ${no} 不在台账里`, 404);
    const used = Number(it.used_print_times || 0) + times;
    const now = nowStr();
    await query("UPDATE prd_stencil SET used_print_times=$1, updated_at=$2 WHERE id=$3", [used, now, it.id]);
    // ⚠ 必须显式给 status='已下线'：这张表的默认值是「使用中」，
    //   只记一次印刷次数却留下一条"使用中"的绑定，下次上线会被判成
    //   「已绑定在（空机台），不能同时上多台机」直接挡死。
    await query(
      `INSERT INTO prd_stencil_bind (stencil_sn, machine_no, mo_no, line_no, used_in_round,
         online_time, offline_time, operator, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'已下线',$9)`,
      [no, String(d.machine_no || "").trim(), String(d.mo_no || "").trim(),
        String(d.line_code || "").trim(), times,
        String(d.use_date || now), now, (req.mesrjUser || {}).login_name || "", now]);
    const clean = String(d.clean_type || "").trim();
    if (clean) {
      await query(
        `INSERT INTO prd_stencil_clean (stencil_sn, clean_type, clean_method, clean_time, operator, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [no, clean, clean, now, (req.mesrjUser || {}).login_name || "", now]);
    }
    const lf = _smtaLife(used, it.max_print_times, it.warn_pct);
    const msg = `钢网 ${no} 本次 +${times} 次，累计 ${Math.trunc(lf.used)} / ${Math.trunc(lf.max || 0)}（${lf.pct}%）` +
      (lf.state !== "正常" ? `　⚠ ${lf.state}` : "");
    return ok(res, { ...lf, stencil_no: no, added: times }, msg);
  });

  // ── W10-c：刮刀（寿命同钢网 + 上机/下机绑定）────────────────────────────

  router.get("/smta/squeegee", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const rows = (await query("SELECT * FROM md_squeegee ORDER BY id DESC LIMIT 500")).rows;
    const on = {};
    for (const b of (await query("SELECT * FROM prd_squeegee_bind WHERE status='使用中'")).rows) {
      on[b.sq_no] = b;
    }
    const items = rows.map(r => {
      const d = { ...r, ..._smtaLife(r.used_times, r.max_times, r.warn_pct) };
      const b = on[r.sq_no];
      d.online_at = b ? `${b.machine_no || ""} ${b.position || ""}`.trim() : "";
      d.online_mo = b ? (b.mo_no || "") : "";
      d.online_time = b ? (b.online_time || "") : "";
      return d;
    });
    items.sort((a, b) => (b.pct || 0) - (a.pct || 0));
    return ok(res, {
      items, total: items.length,
      warn_count: items.filter(x => x.state === "预警" || x.state === "已达寿命").length,
    });
  });

  router.post("/smta/squeegee", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.sq_no || "").trim();
    if (!no) return fail(res, "刮刀编号必填");
    const data = {
      sq_no: no,
      spec: String(d.spec || "").trim(),
      material: String(d.material || "").trim(),
      model: String(d.model || "").trim(),
      position: String(d.position || "").trim(),
      buy_date: String(d.buy_date || "").trim(),
      supplier: String(d.supplier || "").trim(),
      price: Number(d.price || 0),
      max_times: Number(d.max_times || 0),
      warn_pct: Number(d.warn_pct || 80),
      used_times: Number(d.used_times || 0),
      status: String(d.status || "在用").trim(),
      place: String(d.place || "").trim(),
      owner: String(d.owner || "").trim(),
      remark: String(d.remark || "").trim(),
    };
    const old = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [no])).rows[0];
    if (old) {
      await query(
        `UPDATE md_squeegee SET spec=$1, material=$2, model=$3, position=$4, buy_date=$5, supplier=$6,
           price=$7, max_times=$8, warn_pct=$9, used_times=$10, status=$11, place=$12, owner=$13,
           remark=$14, updated_at=$15 WHERE id=$16`,
        [data.spec, data.material, data.model, data.position, data.buy_date, data.supplier,
          data.price, data.max_times, data.warn_pct, data.used_times, data.status, data.place,
          data.owner, data.remark, nowStr(), old.id]);
      return ok(res, { sq_no: no, updated: true }, `刮刀 ${no} 已更新`);
    }
    await query(
      `INSERT INTO md_squeegee (sq_no, spec, material, model, position, buy_date, supplier, price,
         max_times, warn_pct, used_times, status, place, owner, remark, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
      [no, data.spec, data.material, data.model, data.position, data.buy_date, data.supplier,
        data.price, data.max_times, data.warn_pct, data.used_times, data.status, data.place,
        data.owner, data.remark, nowStr()]);
    return ok(res, { sq_no: no }, `刮刀 ${no} 已入台账`);
  });

  router.post("/smta/squeegee/online", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.sq_no || "").trim();
    const machine = String(d.machine_no || "").trim();
    const pos = String(d.position || "").trim();
    const moNo = String(d.mo_no || "").trim();
    if (!no || !machine) return fail(res, "刮刀编号和印刷机必填");
    const it = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [no])).rows[0];
    if (!it) return fail(res, `刮刀 ${no} 不在台账里`, 404);
    if (["已报废", "待报废"].includes(String(it.status || ""))) {
      return fail(res, `刮刀 ${no} 状态是「${it.status}」，不能上机`);
    }
    const lf = _smtaLife(it.used_times, it.max_times, it.warn_pct);
    if (lf.max && Number(lf.used) >= Number(lf.max)) {
      return fail(res, `刮刀 ${no} 已用 ${Math.trunc(lf.used)} / ${Math.trunc(lf.max)} 次，达寿命上限，禁止上机（请报废换新）`);
    }
    const cur = (await query(
      "SELECT * FROM prd_squeegee_bind WHERE sq_no=$1 AND status='使用中'", [no])).rows[0];
    if (cur) {
      return fail(res, `刮刀 ${no} 已上机在 ${cur.machine_no}${cur.position ? " " + cur.position : ""}（工单 ${cur.mo_no || "—"}），一把刀不能同时装两台机`);
    }
    const dup = (await query(
      "SELECT * FROM prd_squeegee_bind WHERE machine_no=$1 AND COALESCE(position,'')=$2 AND status='使用中'",
      [machine, pos])).rows[0];
    if (dup) {
      return fail(res, `${machine}${pos ? " " + pos : ""} 上已经装着刮刀 ${dup.sq_no}（工单 ${dup.mo_no || "—"}），同一个位置不能装两把`);
    }
    const now = nowStr();
    await query(
      `INSERT INTO prd_squeegee_bind (sq_no, machine_no, position, mo_no, line_code, used_in_round,
         status, online_time, offline_time, operator, created_at)
       VALUES ($1,$2,$3,$4,$5,0,'使用中',$6,'',$7,$8)`,
      [no, machine, pos, moNo, String(d.line_code || "").trim(), now,
        (req.mesrjUser || {}).login_name || "", now]);
    await query("UPDATE md_squeegee SET status='使用中', updated_at=$1 WHERE id=$2", [now, it.id]);
    await audit((req.mesrjUser || {}).login_name || "", "辅料", "刮刀上机", no,
      `${machine}${pos ? " " + pos : ""} 工单 ${moNo}`);
    return ok(res, { sq_no: no, machine_no: machine, position: pos },
      `✓ 刮刀 ${no} 已上机：${machine}${pos ? " " + pos : ""}${moNo ? "　工单 " + moNo : ""}`);
  });

  router.post("/smta/squeegee/offline", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.sq_no || "").trim();
    if (!no) return fail(res, "刮刀编号必填");
    const b = (await query(
      "SELECT * FROM prd_squeegee_bind WHERE sq_no=$1 AND status='使用中'", [no])).rows[0];
    if (!b) return fail(res, `刮刀 ${no} 当前没有上机记录`);
    const times = Number(d.times || 0) || 0;
    const now = nowStr();
    const round = Number(b.used_in_round || 0) + (times > 0 ? times : 0);
    await query("UPDATE prd_squeegee_bind SET status='已下线', offline_time=$1, used_in_round=$2 WHERE id=$3",
      [now, round, b.id]);
    const it = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [no])).rows[0];
    let msg = `✓ 刮刀 ${no} 已下机`;
    if (it) {
      const used = Number(it.used_times || 0) + Math.max(0, times);
      await query("UPDATE md_squeegee SET used_times=$1, status='在用', updated_at=$2 WHERE id=$3",
        [used, now, it.id]);
      const lf = _smtaLife(used, it.max_times, it.warn_pct);
      msg = `✓ 刮刀 ${no} 已下机（${b.machine_no}${b.position ? " " + b.position : ""}，本轮 ${round} 次，累计 ${Math.trunc(lf.used)} / ${Math.trunc(lf.max || 0)}）` +
        (lf.state !== "正常" ? `　⚠ ${lf.state}` : "");
      // 本轮次数也进使用流水，按工单/设备追溯才查得到
      if (times > 0) {
        await query(
          `INSERT INTO prd_squeegee_use (sq_no, use_date, shift, line_code, mo_no, machine_no,
             model, times, clean_type, operator, remark, created_at)
           VALUES ($1,$2,'',$3,$4,$5,'',$6,'',$7,'下机时登记',$8)`,
          [no, todayStr(), b.line_code || "", b.mo_no || "", b.machine_no || "", times,
            (req.mesrjUser || {}).login_name || "", now]);
      }
    }
    await audit((req.mesrjUser || {}).login_name || "", "辅料", "刮刀下机", no, `${b.machine_no} 本轮 ${times} 次`);
    return ok(res, { sq_no: no, times }, msg);
  });

  router.post("/smta/squeegee/use", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.sq_no || "").trim();
    const times = Number(d.times || 0);
    if (!no || times <= 0) return fail(res, "刮刀编号和本次使用次数必填");
    const it = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [no])).rows[0];
    if (!it) return fail(res, `刮刀 ${no} 不在台账里`, 404);
    const used = Number(it.used_times || 0) + times;
    const now = nowStr();
    await query("UPDATE md_squeegee SET used_times=$1, updated_at=$2 WHERE id=$3", [used, now, it.id]);
    await query(
      `INSERT INTO prd_squeegee_use (sq_no, use_date, shift, line_code, mo_no, machine_no, model,
         times, clean_type, operator, remark, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [no, String(d.use_date || "").trim() || todayStr(), String(d.shift || "").trim(),
        String(d.line_code || "").trim(), String(d.mo_no || "").trim(),
        String(d.machine_no || "").trim(), String(d.model || "").trim(), times,
        String(d.clean_type || "").trim(), (req.mesrjUser || {}).login_name || "",
        String(d.remark || "").trim(), now]);
    const lf = _smtaLife(used, it.max_times, it.warn_pct);
    const msg = `刮刀 ${no} 本次 +${times} 次，累计 ${Math.trunc(lf.used)} / ${Math.trunc(lf.max || 0)}（${lf.pct}%）` +
      (lf.state !== "正常" ? `　⚠ ${lf.state}` : "");
    return ok(res, { ...lf, sq_no: no, added: times }, msg);
  });

  // ── W10-d：总览（一屏看四块辅料的预警）──────────────────────────────────

  router.get("/smta/overview", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const prms = {};
    for (const p of (await query("SELECT * FROM cfg_paste_param")).rows) prms[p.paste_type] = p;
    const pItems = [];
    for (const r of (await query("SELECT * FROM prd_paste")).rows) {
      pItems.push(await _smtaPasteRow(r, prms[r.paste_type]));
    }
    const pWarn = pItems.filter(x => x.warn || x.wait_over);
    const sts = (await query("SELECT * FROM prd_stencil")).rows;
    const sWarn = sts.map(r => ({ ...r, ..._smtaLife(r.used_print_times, r.max_print_times, r.warn_pct) }))
      .filter(x => x.state === "预警" || x.state === "已达寿命");
    const sqs = (await query("SELECT * FROM md_squeegee")).rows;
    const qWarn = sqs.map(r => ({ ...r, ..._smtaLife(r.used_times, r.max_times, r.warn_pct) }))
      .filter(x => x.state === "预警" || x.state === "已达寿命");
    return ok(res, {
      paste: {
        total: pItems.length, warn: pWarn.length,
        expired: pItems.filter(x => x.expire_flag === "已过期").length,
        items: pWarn.slice(0, 8),
      },
      stencil: { total: sts.length, warn: sWarn.length, items: sWarn.slice(0, 8) },
      squeegee: { total: sqs.length, warn: qWarn.length, items: qWarn.slice(0, 8) },
    });
  });

  // ── W10-e：SMT 站位绑码（源 smta/slots* + core/feeder_slot.py）──────────
  //   这张表是 PDA「贴片料上料防呆」的**唯一数据来源**。
  //   **不锁死** —— 工程师优化程序后自己改，允许同机型+机台+站位出现多条（不同料）。

  /** 源 feeder_slot.split_codes：把「A/B/C」拆成料号列表（去重保序） */
  function _smtaSplitCodes(raw) {
    const out = [];
    for (const x of String(raw || "").split(/[/／,，、;；\s]+/)) {
      const t = x.trim();
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }

  /** 源 feeder_slot.vn_of：料号 → 越南料号（md_material 唯一来源） */
  async function _smtaVnOf(code) {
    if (!code) return "";
    const r = (await query("SELECT vn_code FROM md_material WHERE material_code=$1", [code])).rows[0];
    return String((r && r.vn_code) || "").trim();
  }

  /** 源 feeder_slot.set_slot_codes：整组重写该站位的料号清单 */
  async function _smtaSetSlotCodes(slotId, codes, vnCodes = {}) {
    await query("DELETE FROM md_feeder_slot_alt WHERE slot_id=$1", [slotId]);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      const vn = String(vnCodes[c] || "").trim() || await _smtaVnOf(c);
      await query(
        `INSERT INTO md_feeder_slot_alt (slot_id, material_code, vn_code, seq_no, is_main, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slot_id, material_code) DO NOTHING`,
        [slotId, c, vn, i, i === 0 ? 1 : 0, nowStr()]);
    }
  }

  /** 源 feeder_slot.codes_of_slot：该站位的全部料号（含主料） */
  async function _smtaSlotCodes(slotId) {
    const rows = (await query(
      "SELECT material_code, vn_code, seq_no, is_main FROM md_feeder_slot_alt WHERE slot_id=$1 ORDER BY seq_no, id",
      [slotId])).rows;
    return rows.filter(r => String(r.material_code || "").trim())
      .map(r => ({ code: String(r.material_code).trim(), vn: String(r.vn_code || "").trim(), is_main: Number(r.is_main || 0) }));
  }

  router.get("/smta/slots", requireMesrjPerm("prod.trace"), async (req, res) => {
    const model = String(req.query.model || "").trim();
    const machine = String(req.query.machine_no || "").trim();
    const kw = String(req.query.kw || "").trim();
    const w = ["1=1"], args = [];
    if (model) { w.push(`model=$${args.length + 1}`); args.push(model); }
    if (machine) { w.push(`machine_no=$${args.length + 1}`); args.push(machine); }
    if (kw) {
      w.push(`(material_code ILIKE $${args.length + 1} OR vn_code ILIKE $${args.length + 2} OR feeder_no ILIKE $${args.length + 3} OR slot_no ILIKE $${args.length + 4} OR designators ILIKE $${args.length + 5})`);
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    const rows = (await query(
      `SELECT * FROM md_feeder_slot WHERE ${w.join(" AND ")} ORDER BY model, machine_no, slot_no LIMIT 2000`,
      args)).rows;
    // 替代料一并带出（一次查全表再分组，别按行 N+1 查）
    const altMap = {};
    for (const a of (await query(
      "SELECT slot_id, material_code FROM md_feeder_slot_alt ORDER BY slot_id, seq_no, id")).rows) {
      const k = Number(a.slot_id);
      if (!altMap[k]) altMap[k] = [];
      altMap[k].push(a.material_code || "");
    }
    const items = rows.map(r => {
      const d = { ...r };
      const codes = altMap[Number(r.id)] || (r.material_code ? [r.material_code] : []);
      d.codes = codes;
      d.alt_count = Math.max(0, codes.length - 1);
      return d;
    });
    const models = (await query(
      "SELECT DISTINCT model FROM md_feeder_slot WHERE COALESCE(model,'')<>'' ORDER BY model")).rows.map(x => x.model);
    const machines = (await query(
      "SELECT DISTINCT machine_no FROM md_feeder_slot WHERE COALESCE(machine_no,'')<>'' ORDER BY machine_no")).rows.map(x => x.machine_no);
    return ok(res, { items, total: items.length, models, machines });
  });

  router.post("/smta/slots", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const data = {
      model: String(d.model || "").trim(),
      machine_code: String(d.machine_code || "").trim(),
      machine_no: String(d.machine_no || "").trim(),
      slot_no: String(d.slot_no || "").trim(),
      feeder_no: String(d.feeder_no || "").trim(),
      material_code: String(d.material_code || "").trim(),
      vn_code: String(d.vn_code || "").trim(),
      spec: String(d.spec || "").trim(),
      designators: String(d.designators || "").trim(),
      remark: String(d.remark || "").trim(),
    };
    if (!data.model || !data.material_code) return fail(res, "机型和 SZ 料号必填（其余可留空）");
    // SZ 料号一栏允许写主料/替代料（0338B-HF/0338L-HF/…），统一拆开落库
    const codes = _smtaSplitCodes(data.material_code);
    if (!codes.length) return fail(res, "SZ 料号解析为空");
    data.material_code = codes[0];
    const sid = d.id ? Number(d.id) : 0;
    if (sid) {
      await query(
        `UPDATE md_feeder_slot SET model=$1, machine_code=$2, machine_no=$3, slot_no=$4, feeder_no=$5,
           material_code=$6, vn_code=$7, spec=$8, designators=$9, remark=$10, updated_at=$11
         WHERE id=$12`,
        [data.model, data.machine_code, data.machine_no, data.slot_no, data.feeder_no,
          data.material_code, data.vn_code, data.spec, data.designators, data.remark, nowStr(), sid]);
      await _smtaSetSlotCodes(sid, codes);
      return ok(res, { id: sid, codes }, "已更新");
    }
    const ins = (await query(
      `INSERT INTO md_feeder_slot (model, machine_code, machine_no, slot_no, feeder_no, material_code,
         vn_code, spec, designators, status, remark, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$11) RETURNING id`,
      [data.model, data.machine_code, data.machine_no, data.slot_no, data.feeder_no,
        data.material_code, data.vn_code, data.spec, data.designators, data.remark, nowStr()])).rows[0];
    await _smtaSetSlotCodes(Number(ins.id), codes);
    return ok(res, { id: Number(ins.id), codes }, "已新增");
  });

  router.delete("/smta/slots/:sid", requireMesrjPerm("md.edit"), async (req, res) => {
    const sid = Number(req.params.sid);
    const r = (await query("SELECT id FROM md_feeder_slot WHERE id=$1", [sid])).rows[0];
    if (!r) return fail(res, "记录不存在", 404);
    await query("DELETE FROM md_feeder_slot_alt WHERE slot_id=$1", [sid]);
    await query("DELETE FROM md_feeder_slot WHERE id=$1", [sid]);
    return ok(res, null, "已删除");
  });

  router.post("/smta/slots/import", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const text = String(d.text || "");
    const arr = Array.isArray(d.rows) ? d.rows : [];
    const mode = String(d.mode || "append").trim();
    const onlyModel = String(d.model || "").trim();
    const recs = [];
    if (arr.length) {
      for (const r of arr) {
        if (Array.isArray(r)) recs.push(r.map(x => String(x || "").trim()));
      }
    } else if (text) {
      for (const line of text.replace(/\r/g, "").split("\n")) {
        if (!line.trim()) continue;
        const parts = line.includes("\t")
          ? line.split("\t")
          : line.split(",");
        const clean = parts.map(x => x.trim().replace(/^"|"$/g, ""));
        if (clean.length && ["#.", "#", "序号", "model"].includes(String(clean[0] || "").toLowerCase())) continue;
        if (clean.length < 2) continue;
        recs.push(clean);
      }
    }
    if (!recs.length) {
      return fail(res, "没有可导入的内容（粘贴 Excel 的 机型/内部码/机台/站位/飞达/SZ料号/VN料号/规格/位号 列）");
    }
    // 有的表第一列是序号，跳过
    const first = recs[0];
    const hasNo = first && (String(first[0] || "").trim() === "" || /^\d+$/.test(String(first[0] || "").trim()));
    const idx0 = hasNo ? 1 : 0;
    const COLS = ["model", "machine_code", "machine_no", "slot_no", "feeder_no",
      "sz_code", "vn_code", "spec", "designators"];
    // 统一成 9 列（机型…位号）
    const norm = recs.map(r => {
      const row = [];
      for (let i = 0; i < 9; i++) row.push(String(r[idx0 + i] || "").trim());
      return row;
    });

    // mode=replace：先清空该机型再导
    if (mode === "replace" && onlyModel) {
      const olds = (await query("SELECT id FROM md_feeder_slot WHERE model=$1", [onlyModel])).rows;
      for (const o of olds) await query("DELETE FROM md_feeder_slot_alt WHERE slot_id=$1", [o.id]);
      await query("DELETE FROM md_feeder_slot WHERE model=$1", [onlyModel]);
    }

    let n = 0, skip = 0, nAlt = 0;
    const dup = [], noMat = new Set();
    for (const r of norm) {
      const v = {};
      COLS.forEach((c, i) => { v[c] = r[i] || ""; });
      const model = v.model;
      const codes = _smtaSplitCodes(v.sz_code);
      if (!model || !codes.length) { skip += 1; continue; }
      const vns = _smtaSplitCodes(v.vn_code);
      const vnMap = {};
      if (vns.length === codes.length) codes.forEach((c, i) => { vnMap[c] = vns[i]; });
      else if (vns.length === 1) vnMap[codes[0]] = vns[0];
      const machineNo = v.machine_no, slotNo = v.slot_no;
      const ex = (await query(
        `SELECT * FROM md_feeder_slot WHERE model=$1 AND COALESCE(machine_no,'')=$2 AND COALESCE(slot_no,'')=$3`,
        [model, machineNo, slotNo])).rows[0];
      let sid;
      if (ex) {
        if (!codes.includes(String(ex.material_code || ""))) {
          dup.push(`${model} ${machineNo} ${slotNo}：库内已有「${ex.material_code}」，本行是「${codes[0]}」`);
        }
        await query(
          `UPDATE md_feeder_slot SET machine_code=$1, feeder_no=$2, material_code=$3, vn_code=$4,
             spec=$5, designators=$6, updated_at=$7 WHERE id=$8`,
          [v.machine_code, v.feeder_no, codes[0], vnMap[codes[0]] || "", v.spec, v.designators, nowStr(), ex.id]);
        sid = Number(ex.id);
      } else {
        const ins = (await query(
          `INSERT INTO md_feeder_slot (model, machine_code, machine_no, slot_no, feeder_no, material_code,
             vn_code, spec, designators, status, remark, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'',$10,$10) RETURNING id`,
          [model, v.machine_code, machineNo, slotNo, v.feeder_no, codes[0],
            vnMap[codes[0]] || "", v.spec, v.designators, nowStr()])).rows[0];
        sid = Number(ins.id);
      }
      await _smtaSetSlotCodes(sid, codes, vnMap);
      nAlt += Math.max(0, codes.length - 1);
      for (const c of codes) if (!await _smtaVnOf(c)) noMat.add(c);
      n += 1;
    }
    let msg = `已导入 ${n} 条站位（替代料 ${nAlt} 个）`;
    if (skip) msg += `，跳过 ${skip} 条（机型或料号空）`;
    if (dup.length) msg += `；⚠ ${dup.length} 处同站位料号冲突`;
    if (noMat.size) msg += `；⚠ ${noMat.size} 个料号未建档（无越南料号）`;
    return ok(res, {
      imported: n, skipped: skip, alts: nAlt,
      dup: dup.slice(0, 30), dup_n: dup.length,
      no_material: Array.from(noMat).slice(0, 50), no_material_n: noMat.size,
    }, msg);
  });

  router.get("/smta/slots/export", requireMesrjPerm("prod.trace"), async (req, res) => {
    const model = String(req.query.model || "").trim();
    const w = ["1=1"], args = [];
    if (model) { w.push(`model=$${args.length + 1}`); args.push(model); }
    const rows = (await query(
      `SELECT * FROM md_feeder_slot WHERE ${w.join(" AND ")} ORDER BY model, machine_no, slot_no`, args)).rows;
    const lines = ["机型\t设备内部码\t机台编号\t站位编号\t飞达编号\tSZ料号RJ\tVN料号DT\t规格\t位号"];
    for (const r of rows) {
      const codes = (await _smtaSlotCodes(Number(r.id))).map(x => x.code);
      const use = codes.length ? codes : [r.material_code || ""];
      lines.push([
        r.model || "", r.machine_code || "", r.machine_no || "", r.slot_no || "", r.feeder_no || "",
        use.join("/"),        // 主料/替代料原样贴回一格，跟 Excel 一致
        r.vn_code || "", r.spec || "", r.designators || ""].join("\t"));
    }
    return ok(res, { text: lines.join("\n"), count: rows.length });
  });

  // ── W10-f：时间阈值（全部可调，不锁死）───────────────────────────────────
  //   工艺类：cfg_threshold（PCB 开封、锡膏上机、呆滞、维修次数…）—— SMT 侧已有，直接复用
  //   辅料类：cfg_paste_param（红胶/锡膏 的回温、待用、开盖、有效期）

  router.get("/smta/times", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const ths = (await query("SELECT * FROM cfg_threshold ORDER BY id")).rows;
    const pas = (await query("SELECT * FROM cfg_paste_param ORDER BY id")).rows;
    return ok(res, { thresholds: ths, paste: pas, paste_types: ["红胶", "锡膏"] });
  });

  router.post("/smta/times", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    let nTh = 0;
    for (const x of (Array.isArray(d.thresholds) ? d.thresholds : [])) {
      const k = String(x.th_key || "").trim();
      if (!k) continue;
      const v = Number(x.th_value);
      if (!Number.isFinite(v)) continue;
      await query("UPDATE cfg_threshold SET th_value=$1 WHERE th_key=$2", [v, k]);
      nTh += 1;
    }
    let nPa = 0;
    for (const x of (Array.isArray(d.paste) ? d.paste : [])) {
      const pid = x.id;
      if (!pid) continue;
      await query(
        `UPDATE cfg_paste_param SET storage_min=$1, storage_max=$2, warm_hours=$3, wait_hours=$4,
           open_hours=$5, valid_months=$6, warn_days=$7, updated_at=$8 WHERE id=$9`,
        [Number(x.storage_min || 2), Number(x.storage_max || 10), Number(x.warm_hours || 4),
          Number(x.wait_hours || 8), Number(x.open_hours || 8), Number(x.valid_months || 6),
          Number(x.warn_days || 7), nowStr(), Number(pid)]);
      nPa += 1;
    }
    await audit((req.mesrjUser || {}).login_name || "", "配置", "改时间阈值", "",
      `工艺 ${nTh} 条 / 辅料 ${nPa} 条`);
    return ok(res, { thresholds: nTh, paste: nPa },
      `已保存：工艺阈值 ${nTh} 条、辅料参数 ${nPa} 条`);
  });

  // ── W10-g：钢网印刷参数 + 按工单算消耗（源 smta/stencil/params*、/usage）──
  //   消耗口径：板数 = 该工单 SMT-AOI 过站 OK 的 DISTINCT SN 数
  //             版数 = ceil(板数 / 拼版数)
  //             次数 = 版数 × 每版印刷次数
  //   ⚠ 优先用**印刷机真实记录**（GKG 每片发 CSV，含 PrintMode），没有才退回 AOI 反推。

  router.get("/smta/stencil/params", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const rows = (await query("SELECT * FROM cfg_stencil_param ORDER BY model, side")).rows;
    return ok(res, { items: rows });
  });

  router.post("/smta/stencil/params", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const model = String(d.model || "").trim();
    const side = String(d.side || "").trim();
    if (!model) return fail(res, "机型必填");
    const data = {
      model, side,
      panel_count: Number(d.panel_count || 1),
      print_per_panel: Number(d.print_per_panel || 1),
      max_times: Number(d.max_times || 0),
      warn_pct: Number(d.warn_pct || 80),
      remark: String(d.remark || "").trim(),
    };
    const old = (await query(
      "SELECT id FROM cfg_stencil_param WHERE model=$1 AND COALESCE(side,'')=$2", [model, side])).rows[0];
    if (old) {
      await query(
        `UPDATE cfg_stencil_param SET panel_count=$1, print_per_panel=$2, max_times=$3, warn_pct=$4,
           remark=$5, updated_at=$6 WHERE id=$7`,
        [data.panel_count, data.print_per_panel, data.max_times, data.warn_pct, data.remark, nowStr(), old.id]);
      return ok(res, { updated: true }, `已更新 ${model} ${side}`);
    }
    await query(
      `INSERT INTO cfg_stencil_param (model, side, panel_count, print_per_panel, max_times, warn_pct,
         remark, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [model, side, data.panel_count, data.print_per_panel, data.max_times, data.warn_pct,
        data.remark, nowStr()]);
    return ok(res, null, `已新增 ${model} ${side}`);
  });

  router.delete("/smta/stencil/params/:pid", requireMesrjPerm("md.edit"), async (req, res) => {
    const pid = Number(req.params.pid);
    await query("DELETE FROM cfg_stencil_param WHERE id=$1", [pid]);
    return ok(res, null, "已删除");
  });

  router.get("/smta/stencil/usage", requireMesrjPerm("prod.trace"), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "请传工单号");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, "工单不存在", 404);
    // 机型：工单 feeder_model → 产品 product_model
    let model = String(mo.feeder_model || "").trim();
    if (!model) {
      const fg = String(mo.fg_code || "").trim();
      if (fg) {
        const pm = (await query("SELECT product_model FROM md_product WHERE product_code=$1", [fg])).rows[0];
        model = String((pm && pm.product_model) || "").trim();
      }
    }
    const boards = Number((await query(
      `SELECT COUNT(DISTINCT sn)::int AS n FROM prd_pass WHERE mo_no=$1 AND result='OK' AND station_code LIKE '%SMT-AOI%'`,
      [moNo])).rows[0].n || 0);
    // 参数：精确机型 → 前缀（PCB1/PCB2 两面都取出来）
    let params = [];
    if (model) {
      params = (await query("SELECT * FROM cfg_stencil_param WHERE model=$1", [model])).rows;
      if (!params.length) {
        params = (await query("SELECT * FROM cfg_stencil_param WHERE model LIKE $1", [model + "%"])).rows;
      }
    }
    const real = (await query(
      "SELECT COUNT(*)::int AS n, COALESCE(SUM(print_times),0) AS t FROM prd_print_log WHERE mo_no=$1",
      [moNo])).rows[0];
    const useReal = Number(real.n || 0) > 0;
    const planQty = Number(mo.plan_qty || 0);
    const items = params.map(p => {
      const pc = Number(p.panel_count || 1) || 1;
      const pp = Number(p.print_per_panel || 1) || 1;
      const panels = boards ? Math.ceil(boards / pc) : 0;
      const times = useReal ? Number(real.t || 0) : panels * pp;
      return {
        model: p.model, side: p.side,
        panel_count: pc, print_per_panel: pp,
        max_times: Number(p.max_times || 0), warn_pct: Number(p.warn_pct || 80),
        boards, panels, times,
        source: useReal ? "印刷机实时" : "AOI 反推",
        print_records: Number(real.n || 0),
        pct_of_life: p.max_times ? Math.round(times / Number(p.max_times) * 10000) / 10000 : null,
        plan_qty: planQty,
        plan_panels: planQty ? Math.ceil(planQty / pc) : 0,
        plan_times: planQty ? Math.ceil(planQty / pc) * pp : 0,
      };
    });
    return ok(res, {
      mo_no: moNo, model, boards, plan_qty: planQty,
      print_records: Number(real.n || 0), print_times: Number(real.t || 0),
      source: useReal ? "印刷机实时" : "AOI 反推", items,
    });
  });

  // ── W10-h：GKG 印刷机 CSV 记录（真实数据，比「按 AOI 板数反推」准）────────
  //   印刷机每印完一片发一个 CSV（本地目录或 FTP）→ 解析落库 → 这里查询/统计。

  const _SMTA_PRINT_MODES = {
    once: 1, double: 2, three: 3, four: 4, five: 5, six: 6,
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
  };

  function _smtaF(v) {
    const n = Number(String(v || "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  /** 源 gkg._read_text：GKG 多半是 GBK，UTF-8 兜底 */
  function _smtaDecodeGbk(buf) {
    for (const enc of ["gbk", "utf-8"]) {
      try { return new TextDecoder(enc, { fatal: false }).decode(buf); } catch { continue; }
    }
    return buf.toString("utf8");
  }

  /** 单行 CSV 拆分（支持双引号包裹） */
  function _smtaCsvLine(ln) {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < ln.length; i++) {
      const ch = ln[i];
      if (q) {
        if (ch === '"') { if (ln[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  /** 源 core/gkg.parse_csv_text：找出表头行 → 列名映射 → 竖排兼容 */
  function _smtaParsePrintCsv(text) {
    const rows = text.replace(/\r/g, "").split("\n")
      .filter(x => x.trim()).map(x => _smtaCsvLine(x).map(c => c.replace(/^"|"$/g, "")));
    if (!rows.length) return null;
    const norm = k => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const HEAD = ["timestamp", "machineid", "barcode", "printmode", "prodname", "prodtype"];
    let headIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].filter(c => HEAD.includes(norm(c))).length >= 2) { headIdx = i; break; }
    }
    let m = null;
    if (headIdx < 0) {
      const m2 = {};
      for (const r of rows) {
        if (r.length >= 2) { const k = norm(r[0]); if (k && !(k in m2)) m2[k] = r[1]; }
      }
      if (m2.printmode || m2.barcode) m = m2;
    } else {
      const head = rows[headIdx];
      const val = rows[headIdx + 1] || [];
      const mm = {};
      head.forEach((c, i) => { const k = norm(c); if (k && !(k in mm)) mm[k] = i < val.length ? val[i] : ""; });
      if (!mm.printmode && !mm.barcode) {
        const m2 = {};
        for (const r of rows) { if (r.length >= 2) { const k = norm(r[0]); if (k) m2[k] = r[1]; } }
        m = m2;
      } else m = mm;
    }
    if (!m) return null;
    const mode = String(m.printmode || "").trim();
    return {
      ts: String(m.timestamp || "").trim(),
      barcode: String(m.barcode || "").trim(),
      machine_id: String(m.machineid || m.machinename || "").trim(),
      prod_name: String(m.prodname || "").trim(),
      prod_type: String(m.prodtype || "").trim(),
      print_mode: mode,
      print_times: _SMTA_PRINT_MODES[mode.toLowerCase()] || 1,
      cycle_time: _smtaF(m.cycletime),
      cleaning_freq: _smtaF(m.cleaningfrequency),
      front_press: _smtaF(m.frontsqgpress),
      rear_press: _smtaF(m.rearsqgpress),
    };
  }

  router.get("/smta/print/log", requireMesrjPerm("prod.trace"), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const kw = String(req.query.kw || "").trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100) || 100));
    const w = ["1=1"], args = [];
    if (moNo) { w.push(`mo_no=$${args.length + 1}`); args.push(moNo); }
    if (kw) {
      w.push(`(barcode ILIKE $${args.length + 1} OR prod_name ILIKE $${args.length + 2} OR prod_type ILIKE $${args.length + 3})`);
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    const rows = (await query(
      `SELECT * FROM prd_print_log WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT $${args.length + 1}`,
      [...args, limit])).rows;
    return ok(res, { items: rows, total: rows.length });
  });

  router.get("/smta/print/stat", requireMesrjPerm("prod.trace"), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const since = String(req.query.since || "").trim();
    const until = String(req.query.until || "").trim();
    const w = ["1=1"], args = [];
    if (moNo) { w.push(`mo_no=$${args.length + 1}`); args.push(moNo); }
    if (since) { w.push(`ts >= $${args.length + 1}`); args.push(since); }
    if (until) { w.push(`ts <= $${args.length + 1}`); args.push(until); }
    const base = (await query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(print_times),0) AS t FROM prd_print_log WHERE ${w.join(" AND ")}`,
      args)).rows[0];
    const modes = (await query(
      `SELECT print_mode, COUNT(*)::int AS n, COALESCE(SUM(print_times),0) AS t FROM prd_print_log
       WHERE ${w.join(" AND ")} GROUP BY print_mode ORDER BY n DESC`, args)).rows
      .map(r => ({ mode: r.print_mode || "(空)", records: Number(r.n || 0), times: Number(r.t || 0) }));
    const last = (await query(
      `SELECT MAX(ts) AS t FROM prd_print_log WHERE ${w.join(" AND ")}`, args)).rows[0];
    const empty = (await query(
      `SELECT COUNT(*)::int AS n FROM prd_print_log WHERE ${w.join(" AND ")} AND COALESCE(barcode,'')=''`,
      args)).rows[0];
    return ok(res, {
      mo_no: moNo, records: Number(base.n || 0), times: Number(base.t || 0),
      modes, last_ts: (last && last.t) || "", no_barcode: Number(empty.n || 0),
    });
  });

  router.post("/smta/print/rescan", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const dir = String(await getParam("gkg.csv_dir", "E:\\Ruijing MES\\_gkg_in") || "").trim();
    if (!dir) return fail(res, "未配置印刷机 CSV 目录（sys_param.gkg.csv_dir）");
    let names = [];
    try {
      names = readdirSync(dir).filter(n => /\.(csv|txt)$/i.test(n));
    } catch {
      return fail(res, `印刷机 CSV 目录不可读：${dir}`);
    }
    // 按修改时间排序（老的先导），与源 core/gkg.scan 一致
    const withTime = names.map(n => {
      try { return { n, t: statSync(path.join(dir, n)).mtimeMs }; }
      catch { return { n, t: 0 }; }
    }).sort((a, b) => a.t - b.t);
    let added = 0, skipped = 0, failed = 0;
    for (const f of withTime.slice(0, 500)) {
      const exists = (await query("SELECT id FROM prd_print_log WHERE file_name=$1", [f.n])).rows[0];
      if (exists) { skipped += 1; continue; }
      try {
        const raw = _smtaDecodeGbk(readFileSync(path.join(dir, f.n)));
        const info = _smtaParsePrintCsv(raw);
        if (!info) { failed += 1; continue; }
        let moNo = "";
        if (info.barcode) {
          const sn = (await query("SELECT mo_no FROM prd_sn WHERE sn=$1", [info.barcode])).rows[0];
          moNo = String((sn && sn.mo_no) || "");
        }
        await query(
          `INSERT INTO prd_print_log (ts, barcode, machine_id, prod_name, prod_type, print_mode,
             print_times, cycle_time, cleaning_freq, front_press, rear_press, file_name, mo_no, raw, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (file_name) DO NOTHING`,
          [info.ts, info.barcode, info.machine_id, info.prod_name, info.prod_type, info.print_mode,
            info.print_times, info.cycle_time, info.cleaning_freq, info.front_press, info.rear_press,
            f.n, moNo, raw.slice(0, 4000), nowStr()]);
        added += 1;
      } catch {
        failed += 1;
      }
    }
    return ok(res, { added, skipped, failed },
      `扫描完成：新增 ${added} 条，已存在 ${skipped} 条，失败 ${failed} 条`);
  });

  // ── W10-i：PDA 扫码（源 smta/pda/*）────────────────────────────────────
  //   扫一个码 → 自动认出是钢网 / 刮刀 / 锡膏，返回状态和可做的动作。
  //   为什么单独做：三样东西贴的条码格式不一样，员工不该先选类别再扫，
  //   应该是「扫一下，系统告诉我这是什么、现在什么状态、能做哪几步」。

  /** 源 _pda_stencil */
  async function _smtaPdaStencil(code, mo) {
    const st = (await query("SELECT * FROM prd_stencil WHERE stencil_no=$1 OR sn=$1", [code, code])).rows[0];
    if (!st) return null;
    const lf = _smtaLife(st.used_print_times, st.max_print_times, st.warn_pct);
    const bind = (await query(
      "SELECT * FROM prd_stencil_bind WHERE stencil_sn=$1 AND status='使用中'",
      [st.stencil_no || code])).rows[0];
    const extra = [
      ["厚度", st.thickness || "—"],
      ["适用机型", st.models || st.model || "—"],
      ["当前绑定", bind ? `${bind.machine_no || "—"} / 工单 ${bind.mo_no || "—"}` : "未上线"],
    ];
    return {
      type: "stencil", type_name: "钢网",
      code: st.stencil_no || code,
      sub: st.models || st.model || "",
      status: st.status || "",
      life: lf,
      extra: extra.map(([k, v]) => ({ k, v })),
      online: !!bind,
      bind: bind ? { machine_no: bind.machine_no || "", mo_no: bind.mo_no || "" } : null,
      match: _smtaMatchStencil(st, mo),
      actions: (bind ? ["offline"] : ["online"]).concat(["use", "clean", "scrap"]),
    };
  }

  /** 源 _pda_squeegee */
  async function _smtaPdaSqueegee(code, mo) {
    const sq = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [code])).rows[0];
    if (!sq) return null;
    const lf = _smtaLife(sq.used_times, sq.max_times, sq.warn_pct);
    const bind = (await query(
      "SELECT * FROM prd_squeegee_bind WHERE sq_no=$1 AND status='使用中'", [code])).rows[0];
    const extra = [];
    if (bind) {
      extra.push(["当前上机",
        `${bind.machine_no || "—"}${bind.position ? " " + bind.position : ""}${bind.mo_no ? "　工单 " + bind.mo_no : ""}`]);
    } else {
      extra.push(["当前上机", "未上机"]);
    }
    extra.push(["规格", sq.spec || "—"], ["材质", sq.material || "—"], ["位置", sq.position || "—"]);
    return {
      type: "squeegee", type_name: "刮刀",
      code: sq.sq_no,
      sub: sq.spec || sq.material || "",
      status: sq.status || "",
      life: lf,
      extra: extra.map(([k, v]) => ({ k, v })),
      online: !!bind,
      bind: bind ? {
        machine_no: bind.machine_no || "", position: bind.position || "", mo_no: bind.mo_no || "",
      } : null,
      match: _smtaMatchCommon(mo, "刮刀"),
      actions: (bind ? ["offline"] : ["online"]).concat(["use"]),
    };
  }

  /** 源 _pda_paste */
  async function _smtaPdaPaste(code, mo) {
    const it = (await query("SELECT * FROM prd_paste WHERE batch_no=$1", [code])).rows[0];
    if (!it) return null;
    const prm = await _smtaParam(it.paste_type);
    const now = nowStr();
    const warm = (await query(
      "SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='WARM' ORDER BY id DESC LIMIT 1",
      [code])).rows[0];
    const use = (await query(
      `SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='USE' AND COALESCE(end_time,'')=''
       ORDER BY id DESC LIMIT 1`, [code])).rows[0];
    const extra = [
      ["效期", it.expire_date || "—"],
      ["剩余", (it.left_qty !== null && it.left_qty !== undefined && it.left_qty !== "") ? `${it.left_qty} g` : "—"],
    ];
    if (warm && warm.start_time) {
      extra.push(["回温开始", String(warm.start_time).slice(0, 16)]);
      if (warm.end_time) {
        extra.push(["回温完成", `${String(warm.end_time).slice(0, 16)}（${Number(warm.duration_h || 0).toFixed(1)} 小时）`]);
      } else {
        extra.push(["已回温", `${_smtaHours(warm.start_time, now).toFixed(1)} 小时 / 标准 ${(prm && prm.warm_hours) || 4}`]);
      }
    }
    if (use && use.start_time) {
      extra.push(["开封时间", String(use.start_time).slice(0, 16)]);
      extra.push(["已开封", `${_smtaHours(use.start_time, now).toFixed(1)} 小时 / 时限 ${(prm && prm.open_hours) || 8}`]);
    }
    const status = String(it.status || "");
    let acts;
    if (status === "在库" || status === "退回") {
      acts = ["warm_start"];
      if (warm && warm.end_time) acts = ["paste_use", "warm_start"];
    } else if (status === "回温中") acts = ["warm_end"];
    else if (status === "待用") acts = ["paste_use", "warm_start"];
    else if (status === "使用中") acts = ["paste_recover"];
    else acts = ["warm_start"];   // 已用完/已报废 → 只允许重新开一批（新批次号）
    return {
      type: "paste", type_name: it.paste_type || "锡膏",
      code: it.batch_no, sub: it.paste_type || "",
      status,
      life: null,
      extra: extra.map(([k, v]) => ({ k, v })),
      online: !!use,
      match: _smtaMatchCommon(mo, it.paste_type || "锡膏"),
      actions: acts,
      params: {
        warm_hours: (prm && prm.warm_hours) || 4,
        open_hours: (prm && prm.open_hours) || 8,
        wait_hours: (prm && prm.wait_hours) || 8,
      },
    };
  }

  router.get("/smta/pda/scan", requireMesrjPerm("prod.trace"), async (req, res) => {
    const code = String(req.query.code || "").trim();
    if (!code) return fail(res, "请扫码");
    const mo = await _smtaMoCtx(String(req.query.mo_no || "").trim());
    const hits = [];
    for (const fn of [_smtaPdaStencil, _smtaPdaSqueegee, _smtaPdaPaste]) {
      try {
        const x = await fn(code, mo);
        if (x) hits.push(x);
      } catch { /* 识别失败不算错，三类都查一遍 */ }
    }
    if (!hits.length) {
      const ns = (await query(
        "SELECT (SELECT COUNT(*) FROM prd_stencil)::int AS a, (SELECT COUNT(*) FROM md_squeegee)::int AS b, (SELECT COUNT(*) FROM prd_paste)::int AS c"
      )).rows[0];
      return ok(res, { code, type: "", hits: [], mo,
        msg: `这个码在辅料台账里查不到：钢网 ${ns.a} / 刮刀 ${ns.b} / 锡膏 ${ns.c} 都没有` });
    }
    return ok(res, { code, type: hits[0].type, hits, mo });
  });

  router.get("/smta/pda/mos", requireMesrjPerm("prod.trace"), async (req, res) => {
    // scope=all 时列**全部状态**（含已完工/已关闭）—— 按工单追溯辅料要用，
    // 出货后客户来查批次，查的恰恰是已完工的单。
    const scope = String(req.query.scope || "").trim().toLowerCase();
    const kw = String(req.query.kw || "").trim();
    let rows = [];
    if (scope === "all") {
      const w = ["COALESCE(status,'')<>'作废'"], args = [];
      if (kw) { w.push(`mo_no ILIKE $${args.length + 1}`); args.push(`%${kw}%`); }
      rows = (await query(
        `SELECT mo_no, product_code, line_code, plan_qty, out_qty, status, po_no FROM ord_mo
         WHERE ${w.join(" AND ")} ORDER BY mo_no DESC LIMIT 300`, args)).rows;
    } else {
      rows = (await query(
        `SELECT mo_no, product_code, line_code, plan_qty, out_qty, status, po_no FROM ord_mo
         WHERE COALESCE(status,'') IN ('待排产','已排产','已下达','生产中')
         ORDER BY CASE status WHEN '生产中' THEN 0 WHEN '已下达' THEN 1 WHEN '已排产' THEN 2 ELSE 3 END,
         mo_no DESC LIMIT 200`)).rows;
    }
    const pmap = {};
    for (const x of (await query("SELECT product_code, product_model FROM md_product")).rows) {
      pmap[x.product_code] = x.product_model || "";
    }
    const out = rows.map(r => ({
      mo_no: r.mo_no, product_code: r.product_code || "",
      // ⚠ ord_mo 没有 product_model 列，机型统一从 md_product 取
      product_model: String(pmap[r.product_code || ""] || "").trim(),
      line_code: r.line_code || "",
      plan_qty: Number(r.plan_qty || 0), out_qty: Number(r.out_qty || 0),
      status: r.status || "", po_no: r.po_no || "",
    }));
    return ok(res, { rows: out });
  });

  // ── W10-j：按工单追辅料（源 smta/trace/mo）─────────────────────────────
  //   ⚠ 只认**有登记**的记录 —— 没在 PDA 上做过动作的就是空，不会凭空出现。
  router.get("/smta/trace/mo", requireMesrjPerm("prod.trace"), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "请传工单号");
    if (!(await query("SELECT id FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0]) {
      return fail(res, "工单不存在", 404);
    }
    const ctx = await _smtaMoCtx(moNo); // 路由已校验工单存在，ctx 必非 null（原 `|| {}` 兜底不可达）
    const st = (await query(
      `SELECT b.*, s.model, s.models, s.thickness FROM prd_stencil_bind b
       LEFT JOIN prd_stencil s ON s.sn=b.stencil_sn
       WHERE b.mo_no=$1 ORDER BY b.id DESC`, [moNo])).rows;
    const sq = (await query("SELECT * FROM prd_squeegee_use WHERE mo_no=$1 ORDER BY id DESC", [moNo])).rows;
    const sqb = (await query("SELECT * FROM prd_squeegee_bind WHERE mo_no=$1 ORDER BY id DESC", [moNo])).rows;
    const pa = (await query("SELECT * FROM prd_paste_log WHERE mo_no=$1 ORDER BY id DESC", [moNo])).rows;
    const batches = new Set(pa.filter(r => r.log_type === "USE").map(r => r.batch_no));
    return ok(res, {
      mo_no: moNo,
      product_model: ctx.product_model || "",
      line_code: ctx.line_code || "",
      status: ctx.status || "",
      plan_qty: ctx.plan_qty || 0,
      out_qty: ctx.out_qty || 0,
      stencil: st,
      squeegee: sq,
      squeegee_bind: sqb,
      paste: pa,
      summary: {
        stencil_boards: st.length,
        stencil_times: st.reduce((a, r) => a + Number(r.used_in_round || 0), 0),
        squeegee_uses: sq.length,
        squeegee_times: sq.reduce((a, r) => a + Number(r.times || 0), 0),
        squeegee_online: sqb.filter(r => String(r.status || "") === "使用中").length,
        squeegee_boards: sqb.length,
        paste_batches: batches.size,
      },
    });
  });
}
