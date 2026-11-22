// ============================================================================
// W11 外箱绑码（源 api/pack.py，21 路由） —— 从 routes/mesrj.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮1续）。
// 依赖经 registerPackRoutes(router, deps) 注入，与 smta-routes/ultra 同一约定；
// 注册位置在 createMesrjRouter 内保持不变（JWT 之后，顺序即原块顺序）。
// ============================================================================
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { doPassInner, ensureMoRoute, guard_open_ng, guard_route_incomplete, guard_untested, nowStr, todayStr } from "./domain.js";
import { dayCode, getRule, ruleOfMo, nextCartonNo, wipNo, preview, makePrintJob, tsLocal } from "./packcode.js";
import { buildPages, renderSvg, readTemplatePrompts } from "./pack-label.js";

export function registerPackRoutes(router, { query, ok, fail, getParam, setParam, audit, perm: requireMesrjPerm, execUser }) {
  // ═══ 通用 CRUD（源 _crud.register；固定路径已全部注册完，通配放最后）═══════
  // ── W11：外箱绑码（源 api/pack.py，21 路由）──────────────────────────────
  //   新流程（外箱码自动生成，无需扫箱码）：
  //     选工单 → 连续扫产品 SN（扫第一台即自动开箱）→ 装满箱容 → 自动封箱 +
  //     按 AT&T QP200-00029 规则生成外箱码 + 自动发起打印；
  //     尾数不满一箱 → 手动「尾数封箱并打印」。
  //   防错：重码（已装箱）、NG/报废品、跨工单、重复扫描、超箱容、机型未配规则。
  //
  // ⚠ 产线维度：同一张工单同时开 2 条包装线时，箱必须按 line_code 隔离，
  //   否则两条线拿到同一个箱 → 两只物理箱子记成一只、封箱只打印一张标签。

  const BOX_OPEN = "装箱中";
  const BOX_CLOSED = "已封箱";

  async function _packMo(moNo) {
    return query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo]);
  }
  async function _packBox(boxNo) {
    return (await query("SELECT * FROM prd_box WHERE box_no=$1", [boxNo])).rows[0] || null;
  }
  function _packSns(row) {
    return String((row && row.sn_list) || "").split(",").filter(Boolean);
  }
  function _packUserName(user) {
    return (user && (user.emp_name || user.login_name)) || "";
  }

  /** 批量算每个 SN 的质量状态，供外箱网格标红用（源 _sns_quality） */
  async function _packSnsQuality(sns) {
    const out = {};
    const list = (sns || []).filter(Boolean);
    if (!list.length) return out;
    const ph = list.map((_, i) => `$${i + 1}`).join(",");
    try {
      for (const r of (await query(
        `SELECT sn, status FROM prd_sn WHERE sn IN (${ph})`, list)).rows) {
        if (["待修", "报废", "已报废"].includes(String(r.status || ""))) out[r.sn] = "NG";
      }
    } catch { /* 查不到就当 OK */ }
    try {
      // 同一工位只取最新一条（ORDER BY id DESC 后按 (sn, station) 去重）
      const seen = new Set();
      for (const r of (await query(
        `SELECT sn, station_code, result FROM prd_pass WHERE sn IN (${ph}) ORDER BY id DESC`, list)).rows) {
        const key = `${r.sn}|${r.station_code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (["NG", "FAIL"].includes(String(r.result || "").trim().toUpperCase())) out[r.sn] = "NG";
      }
    } catch { /* 同上 */ }
    return out;
  }

  /** 源 _box_json */
  async function _packBoxJson(row, fullSns = true) {
    if (!row) return null;
    const d = { ...row, created_at: tsLocal(row.created_at), updated_at: tsLocal(row.updated_at) };
    const sns = _packSns(row);
    if (fullSns) {
      const q = await _packSnsQuality(sns);
      d.sns = sns;
      d.sn_count = sns.length;
      d.sn_detail = sns.map(s => ({ sn: s, q: q[s] || "OK" }));
      d.ng_count = sns.filter(s => q[s] === "NG").length;
    } else {
      d.sn_count = sns.length;
      d.sn_preview = sns.slice(0, 3);
    }
    delete d.sn_list;
    return d;
  }

  /** 该工单当前「装箱中」的外箱（源 _open_box_of） */
  async function _packOpenBoxOf(moNo, lineCode = null) {
    const line = String(lineCode || "").trim();
    if (line) {
      const row = (await query(
        `SELECT * FROM prd_box WHERE mo_no=$1 AND status=$2 AND COALESCE(line_code,'')=$3
         ORDER BY id DESC LIMIT 1`, [moNo, BOX_OPEN, line])).rows[0];
      if (row) return row;
      // 兼容升级前的箱：该工单只有 1 个未封箱且还没标产线 → 认领它
      const nOpen = Number((await query(
        "SELECT COUNT(*)::int AS n FROM prd_box WHERE mo_no=$1 AND status=$2",
        [moNo, BOX_OPEN])).rows[0].n || 0);
      if (nOpen === 1) {
        const old = (await query(
          `SELECT * FROM prd_box WHERE mo_no=$1 AND status=$2 AND COALESCE(line_code,'')=''
           ORDER BY id DESC LIMIT 1`, [moNo, BOX_OPEN])).rows[0];
        if (old) {
          await query("UPDATE prd_box SET line_code=$1 WHERE box_no=$2", [line, old.box_no]);
          return await _packBox(old.box_no);
        }
      }
      return null;
    }
    return (await query(
      "SELECT * FROM prd_box WHERE mo_no=$1 AND status=$2 ORDER BY id DESC LIMIT 1",
      [moNo, BOX_OPEN])).rows[0] || null;
  }

  /** 这颗 SN 最后一次过站在哪条产线（源 _line_of_sn） */
  async function _packLineOfSn(sn) {
    if (!sn) return "";
    try {
      const r = (await query(
        `SELECT line_code FROM prd_pass WHERE sn=$1 AND COALESCE(line_code,'')<>''
         ORDER BY pass_time DESC, id DESC LIMIT 1`, [sn])).rows[0];
      return r ? String(r.line_code || "") : "";
    } catch { return ""; }
  }

  /** 本单路线里「包装」那一站（源 _packing_station） */
  async function _packPackingStation(moNo, productCode = "") {
    if (!moNo) return "";
    let steps = [];
    try {
      [steps] = await ensureMoRoute(moNo, productCode);
    } catch { return ""; }
    for (const s of [...(steps || [])].sort((a, b) => Number(a.seq_no || 0) - Number(b.seq_no || 0))) {
      if (String(s.process_code || "") !== "04") continue;
      const code = String(s.station_code || "");
      const name = String(s.station_name || "");
      if (code.toUpperCase().endsWith("PACKING") || name.includes("包装")) return code;
    }
    return "";
  }

  /** 取当前未完成箱；没有则新建（箱码为内部临时号，封箱时替换为正式外箱码） */
  async function _packEnsureOpenBox(moNo, capacity = null, tplCode = null, lineCode = null, user = null) {
    const mo = (await _packMo(moNo)).rows[0];
    if (!mo) return [null, `工单不存在：${moNo}`];
    if (["已完工", "已关闭", "作废"].includes(String(mo.status || ""))) {
      return [null, `工单 ${moNo} 状态为【${mo.status}】，不能装箱`];
    }
    const rule = await getRule(mo.product_code);
    if (!rule) {
      return [null, `机型【${mo.product_code || "?"}】未配置装箱编码规则，无法生成外箱码。` +
        "请先在 配置中心 → 装箱编码规则 中配置"];
    }
    const line = String(lineCode || "").trim();
    const ex = await _packOpenBoxOf(moNo, line);
    if (ex) return [ex, null];
    let cap = Number(capacity);
    if (!Number.isFinite(cap) || cap <= 0) cap = Number(rule.carton_qty || 0);
    if (!Number.isFinite(cap) || cap <= 0) cap = Number(await getParam("BOX_CAPACITY", "96") || 96);
    if (cap <= 0 || cap > 2000) return [null, "箱容必须是 1~2000 的整数"];
    const wip = await wipNo("BOX");
    await query(
      `INSERT INTO prd_box (box_no, mo_no, po_no, product_code, qty, capacity, sn_list, status,
         line_code, tpl_code, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,0,$5,'','${BOX_OPEN}',$6,$7,$8,now(),now())`,
      [wip, moNo, mo.po_no || "", mo.product_code || "", cap, line,
        String(tplCode || "").trim() || (rule.carton_tpl_code || ""),
        _packUserName(user)]);
    await audit(_packUserName(user), "外箱绑码", "开箱", wip,
      `${moNo} 箱容 ${cap}${line ? "　产线 " + line : ""}（箱码封箱时自动生成）`);
    return [await _packBox(wip), null];
  }

  /** 外箱标签打印数据（Carton Label 2：外箱码 + SN 清单 + SKU/数量） */
  function _packBoxPayload(box, rule, tpl, reprint = false, user = null) {
    const dt = new Date();
    const sns = _packSns(box);
    const perPage = 48;
    const pages = [];
    for (let i = 0; i < sns.length; i += perPage) pages.push(sns.slice(i, i + perPage));
    const p = n => String(n).padStart(2, "0");
    return {
      ref_type: "box", ref_no: box.box_no, box_no: box.box_no,
      mo_no: box.mo_no, po_no: box.po_no,
      product_code: box.product_code, machine_model: rule ? (rule.machine_model || "") : "",
      qty: box.qty, capacity: box.capacity,
      sns, sn_pages: pages, sn_per_page: perPage,
      day_code: dayCode(dt), year_digit: dt.getFullYear() % 10,
      date_of_mfg: `${dt.getFullYear()}.${p(dt.getMonth() + 1)}.${p(dt.getDate())}`,
      wireline_sku: rule ? (rule.wireline_sku || "") : "",
      consumer_sku: rule ? (rule.consumer_sku || "") : "",
      reprint: !!reprint,
      tpl: {
        tpl_code: tpl ? tpl.tpl_code : "", tpl_name: tpl ? tpl.tpl_name : "",
        file_name: tpl ? tpl.file_name : "", fields: tpl ? tpl.fields : "[]",
      },
      printed_by: _packUserName(user),
      printed_at: nowStr(),
    };
  }

  /** 打印代理上报的本机 .btw 清单（源 _agent_tpl_files） */
  async function _packAgentTplFiles() {
    try {
      const v = JSON.parse((await getParam("print.agent_tpl_files", "[]")) || "[]");
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  /** 打印代理是否在线：代理每轮取任务时打一次心跳，90 秒内算在线（源 _agent_state） */
  async function _packAgentState() {
    const last = String(await getParam("print.agent_last_seen", "") || "").trim();
    let alive = false, mins = null;
    if (last) {
      const t = new Date(last.replace(" ", "T"));
      if (!Number.isNaN(t.getTime())) {
        const gap = (Date.now() - t.getTime()) / 1000;
        alive = gap <= 90;
        mins = Math.floor(gap / 60);
      }
    }
    const pending = Number((await query(
      "SELECT COUNT(*)::int AS n FROM prd_print_job WHERE status='待打印'")).rows[0].n || 0);
    return {
      alive, last_seen: last, mins,
      printer: await getParam("print.agent_printer", ""),
      printer_ok: String(await getParam("print.agent_printer_ok", "") || "").trim() === "1",
      printer_msg: await getParam("print.agent_printer_msg", ""),
      bartender: await getParam("print.agent_bartender", ""),
      pending,
    };
  }

  // ── W11-a：页面初始化 / 上下文 / 规则预览 / 开箱 ─────────────────────────

  router.get("/pack/init", requireMesrjPerm(null), async (_req, res) => {
    const cap = Number(await getParam("BOX_CAPACITY", "96") || 96);
    const tpls = (await query(
      `SELECT id, tpl_code, tpl_name, tpl_type, product_code, file_name, fields, remark
       FROM cfg_print_tpl WHERE enabled=1 ORDER BY sort_no, id`)).rows;
    const rules = (await query("SELECT * FROM cfg_pack_rule WHERE enabled=1 ORDER BY id")).rows;
    const tplDir = String(await getParam("print.tpl_dir", "") || "").trim();
    const files = await _packAgentTplFiles();
    const names = new Set(files.map(f => f.name));
    for (const t of tpls) {
      const fn = String(t.file_name || "").trim();
      // 登记时存了完整路径 → 直接查该路径；否则看打印代理上报的本机清单
      if (fn && /^[A-Za-z]:[\\/]/.test(fn)) {
        t.exists = existsSync(fn);
        t.abs = true;
        continue;
      }
      t.abs = false;
      t.exists = !!fn && (names.size ? names.has(fn) : false);
    }
    return ok(res, {
      default_capacity: cap, templates: tpls, rules,
      tpl_dir: tplDir, print_agent: await _packAgentState(),
      agent_mode: String(await getParam("print.agent_mode", "") || "").trim(),
      agent_tpl_files: files,
    });
  });

  router.post("/pack/agent/ping", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const now = nowStr();
    await setParam("print.agent_last_seen", now, "打印代理心跳", "打印");
    await setParam("print.agent_printer", String(d.printer || "").slice(0, 80), "打印代理打印机", "打印");
    await setParam("print.agent_printer_ok", d.printer_ok === false ? "0" : "1", "打印代理打印机在线", "打印");
    await setParam("print.agent_printer_msg", String(d.printer_msg || "").slice(0, 120), "打印代理打印机说明", "打印");
    await setParam("print.agent_bartender", String(d.bartender || "").slice(0, 200), "打印代理的 BarTender 路径", "打印");
    if (String(d.tpl_dir || "").trim()) {
      await setParam("print.tpl_dir", String(d.tpl_dir).trim().slice(0, 200), "btw 模板目录", "打印");
    }
    const m = String(d.mode || "").trim().toLowerCase();
    if (m === "bt" || m === "zpl") await setParam("print.agent_mode", m, "打印代理实际通道", "打印");
    if (Array.isArray(d.tpl_files)) {
      // 代理本机目录里真实存在的 .btw（页面据此做「选本机模板」）
      const clean = [];
      for (const f of d.tpl_files.slice(0, 300)) {
        if (f && typeof f === "object" && f.name) {
          clean.push({
            name: String(f.name).slice(0, 200), sub: String(f.sub || "").slice(0, 20),
            size: Number(f.size || 0), mtime: String(f.mtime || "").slice(0, 19),
          });
        }
      }
      await setParam("print.agent_tpl_files", JSON.stringify(clean), "打印代理本机 btw 清单", "打印");
    }
    return ok(res, { now });
  });

  router.get("/pack/rule", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    let productCode = String(req.query.product_code || "").trim();
    if (moNo && !productCode) {
      const mo = (await _packMo(moNo)).rows[0];
      if (!mo) return fail(res, `工单不存在：${moNo}`);
      productCode = mo.product_code || "";
    }
    const pv = productCode ? await preview(productCode) : null;
    return ok(res, { product_code: productCode, preview: pv });
  });

  router.get("/pack/context", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const lineCode = String(req.query.line_code || "").trim();
    const openBox = await _packOpenBoxOf(moNo, lineCode);
    const boxedSn = Number((await query(
      "SELECT COUNT(*)::int AS n FROM prd_sn WHERE mo_no=$1 AND COALESCE(box_no,'')<>''",
      [moNo])).rows[0].n || 0);
    const closedBoxes = Number((await query(
      "SELECT COUNT(*)::int AS n FROM prd_box WHERE mo_no=$1 AND status=$2",
      [moNo, BOX_CLOSED])).rows[0].n || 0);
    return ok(res, {
      open_box: await _packBoxJson(openBox),
      mo_boxed_sn: boxedSn,
      mo_closed_boxes: closedBoxes,
    });
  });

  router.post("/pack/box/start", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const moNo = String(d.mo_no || "").trim();
    if (!moNo) return fail(res, "请先选择工单");
    const lineCode = String(d.line_code || "").trim();
    const wasOpen = !!(await _packOpenBoxOf(moNo, lineCode));
    const [box, err] = await _packEnsureOpenBox(moNo, d.capacity, d.tpl_code, lineCode, req.mesrjUser);
    if (err) return fail(res, err);
    return ok(res, await _packBoxJson(box),
      wasOpen
        ? `已恢复未完成装箱（${box.qty}/${box.capacity}）；箱码将在装满/封箱时自动生成`
        : `已就绪（${box.qty}/${box.capacity}）；箱码将在装满/封箱时自动生成`);
  });

  // ── W11-b：封箱核心（生成正式外箱码 + 更新明细 + 发起打印）───────────────

  /** @returns {Promise<[object|null, string|null]>} [result, err]（err 非空即失败） */
  async function _packCloseBox(box, auto = false, user = null) {
    if (String(box.status) !== BOX_OPEN) return [null, "外箱已封箱"];
    if (Number(box.qty || 0) <= 0) return [null, "空箱不能封箱"];
    const [rule, pc] = await ruleOfMo(box.mo_no);
    if (!rule) {
      return [null, `机型【${box.product_code || pc || "?"}】未配置装箱编码规则，` +
        "无法生成外箱码（配置中心 → 装箱编码规则）"];
    }
    const oldNo = box.box_no;
    let finalNo = null;
    for (let i = 0; i < 5; i++) {
      const cand = await nextCartonNo(rule);
      const upd = await query(
        "UPDATE prd_box SET box_no=$1, status=$2, updated_at=now() WHERE box_no=$3 RETURNING id",
        [cand, BOX_CLOSED, oldNo]);
      if (upd.rows.length) { finalNo = cand; break; }
    }
    if (!finalNo) return [null, "外箱码生成冲突，请重试"];
    // 子表引用同步替换（SN 明细）
    await query("UPDATE prd_sn SET box_no=$1, updated_at=now() WHERE box_no=$2", [finalNo, oldNo]);
    // 打印任务
    let jobNo = "", warn = "";
    const tplCode = String(box.tpl_code || rule.carton_tpl_code || "").trim();
    const tpl = tplCode
      ? (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1", [tplCode])).rows[0]
      : null;
    if (tpl) {
      const payload = _packBoxPayload(await _packBox(finalNo), rule, tpl, false, user);
      jobNo = await makePrintJob("box", finalNo, tpl, payload,
        (user && user.login_name) || "", finalNo);
      await query("UPDATE prd_box SET print_times=print_times+1, tpl_code=$1, updated_at=now() WHERE box_no=$2",
        [tpl.tpl_code, finalNo]);
    } else {
      warn = "未配置外箱打印模板，请稍后用【补打】手动打印";
    }
    await audit(_packUserName(user), "外箱绑码", auto ? "自动封箱" : "尾数封箱", finalNo,
      `${box.qty} 台（原临时号 ${oldNo}）`);
    return [{
      box: await _packBoxJson(await _packBox(finalNo)),
      final_box_no: finalNo,
      print_job: jobNo,
      print_warn: warn,
    }, null];
  }

  // ── W11-c：绑定（核心扫码动作；装满自动封箱）──────────────────────────────

  router.post("/pack/bind", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const sn = String(d.sn || "").trim();
    const moNo = String(d.mo_no || "").trim();
    const boxNo = String(d.box_no || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    const row = (await query("SELECT * FROM prd_sn WHERE sn=$1", [sn])).rows[0];
    if (!row) return fail(res, `SN【${sn}】不存在（未建档）`);
    if (!["在制", "完工"].includes(String(row.status || ""))) {
      return fail(res, `SN【${sn}】当前状态【${row.status}】，不允许装箱`);
    }
    // 防呆①-0：未检验（无成品测试记录）不许装箱
    //   装箱扫的是**整机 SN**，ICT/FCT 记录挂在 PCBA SN 上 → 要求「成品 ATE」
    if (String(await getParam("pack.require_tested", "1") || "1").trim() === "1") {
      const untested = await guard_untested(sn, await getParam("pack.require_stations", "ATE"));
      if (untested.length) return fail(res, `未过 ${untested.join("/")} · 请先测试（${sn}）`);
    }
    // 防呆①：不良品不许装箱
    if (String(await getParam("pack.check_ng", "1") || "1").trim() === "1") {
      const ngSt = await guard_open_ng(sn);
      if (ngSt) return fail(res, `${ngSt} NG 未处理 · 请先送维修（${sn}）`);
    }
    // 防呆②：必过工序没做完不许装箱
    //   ⚠ 排除「包装」本站：装箱就是包装这一步，不能要求它先完成（否则死循环）
    if (String(await getParam("pack.check_route", "1") || "1").trim() === "1") {
      const packSt = await _packPackingStation(moNo || row.mo_no, row.product_code);
      const miss = await guard_route_incomplete(sn, moNo || row.mo_no, row.product_code,
        null, packSt ? [packSt] : []);
      if (miss.length) {
        const names = miss.slice(0, 3).map(m => String(m[1] || m[0]).split(" - ")[0]).join("、");
        const more = miss.length > 3 ? "…" : "";
        return fail(res, `前置未完成 · 先做 ${names}${more}（${sn}）`);
      }
    }
    // 产线：前端选了就用前端选的；没选就按这颗 SN 最后过站的产线判定
    let lineCode = String(d.line_code || "").trim() || await _packLineOfSn(sn);
    let box;
    if (boxNo) {
      box = await _packBox(boxNo);
      if (!box) return fail(res, `外箱不存在：${boxNo}`);
      if (String(box.line_code || "")) lineCode = box.line_code;
    } else {
      if (!moNo) return fail(res, "缺少工单号");
      const [bx, err] = await _packEnsureOpenBox(moNo, d.capacity, d.tpl_code, lineCode, req.mesrjUser);
      if (err) return fail(res, err);
      box = bx;
    }
    if (String(box.status) !== BOX_OPEN) {
      return fail(res, `外箱【${box.box_no}】已封箱，不能继续装箱`);
    }
    // 产线隔离：同一张单两条线并行时，B 线的板不许装进 A 线的箱
    const bLine = String(box.line_code || "");
    const sLine = await _packLineOfSn(sn);
    if (bLine && sLine && bLine !== sLine) {
      return fail(res, `SN【${sn}】是 ${sLine} 线的板，本箱属于 ${bLine} 线 —— 同一张工单开多条线时，` +
        "每条线各装各的箱（换回本线的箱，或把本箱封掉）");
    }
    if (Number(box.qty || 0) >= Number(box.capacity || 0)) {
      return fail(res, `外箱已满（${box.qty}/${box.capacity}），请先封箱`);
    }
    if (_packSns(box).includes(sn)) return fail(res, `SN【${sn}】已在本箱中（重复扫描）`);
    if (String(row.box_no || "")) return fail(res, `SN【${sn}】已装在箱【${row.box_no}】（重复拦截）`);
    if (row.mo_no && box.mo_no && row.mo_no !== box.mo_no) {
      return fail(res, `SN【${sn}】属于工单 ${row.mo_no}，与本箱工单 ${box.mo_no} 不一致`);
    }
    const newList = box.sn_list ? `${box.sn_list},${sn}` : sn;
    await query("UPDATE prd_sn SET box_no=$1, updated_at=now() WHERE sn=$2", [box.box_no, sn]);
    await query("UPDATE prd_box SET qty=qty+1, sn_list=$1, updated_at=now() WHERE box_no=$2",
      [newList, box.box_no]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "装箱", box.box_no, sn, req.ip);
    // 装箱 = 包装作业完成 → 就地记一条「包装」过站
    //   不记的话整机码路线里 PACKING 永远是缺的，后面栈板/出货的完整性检查会一直拦
    let packNote = "";
    try {
      const pst = await _packPackingStation(box.mo_no || moNo, row.product_code);
      if (pst && String(await getParam("pack.auto_pass", "1") || "1").trim() === "1") {
        const pr = await doPassInner(
          { sn, station_code: pst, result: "OK", mo_no: box.mo_no || moNo },
          execUser(req), req.ip);
        const inner = (pr && pr.data) || {};
        if (!inner.accepted && String(inner.rule || "") !== "DUP_SN") {
          packNote = `（包装站未记入：${inner.msg || (pr && pr.msg) || "未受理"}）`;
        }
      }
    } catch (e) {
      packNote = `（包装站未记入：${e}）`;
    }
    const box2 = await _packBox(box.box_no);
    const resp = {
      box: await _packBoxJson(box2), auto_closed: false, final_box_no: "",
      print_job: "", print_warn: "",
    };
    let msg = `已装箱：${sn}（${box2.qty}/${box2.capacity}）${packNote}`;
    if (Number(box2.qty || 0) >= Number(box2.capacity || 0)) {
      const [result, err] = await _packCloseBox(box2, true, req.mesrjUser);
      if (err) {
        msg = `已装满 ${box2.qty} 台，但封箱失败：${err}（请点「尾数封箱」重试）`;
        return ok(res, resp, msg);
      }
      resp.box = result.box;
      resp.auto_closed = true;
      resp.final_box_no = result.final_box_no;
      resp.print_job = result.print_job;
      resp.print_warn = result.print_warn;
      msg = `已装满 ${box2.qty} 台 → 自动生成外箱码 ${result.final_box_no}` +
        (result.print_job ? `，打印任务 ${result.print_job} 已发送` : `（${result.print_warn}）`);
    }
    return ok(res, resp, msg);
  });

  // ── W11-d：封箱（尾数手动）/ 换模板 / 解绑 / 作废空箱 / 打印 ───────────────

  router.post("/pack/close", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const moNo = String(d.mo_no || "").trim();
    const force = !!d.force;
    let box;
    if (boxNo) box = await _packBox(boxNo);
    else if (moNo) box = await _packOpenBoxOf(moNo, String(d.line_code || "").trim());
    else return fail(res, "缺少外箱号或工单号");
    if (!box) return fail(res, "没有装箱中的外箱");
    if (String(box.status) !== BOX_OPEN) return fail(res, `外箱【${box.box_no}】已经封箱了`);
    if (Number(box.qty || 0) <= 0) return fail(res, "空箱不能封箱");
    if (Number(box.qty || 0) < Number(box.capacity || 0) && !force) {
      return fail(res, `未装满（${box.qty}/${box.capacity}）。如确需按尾数封箱，请再确认一次`);
    }
    const [result, err] = await _packCloseBox(box, false, req.mesrjUser);
    if (err) return fail(res, err);
    return ok(res, result, `已封箱（尾数 ${box.qty} 台）→ 外箱码 ${result.final_box_no}` +
      (result.print_job ? `，打印任务 ${result.print_job} 已发送` : `（${result.print_warn}）`));
  });

  router.post("/pack/box/tpl", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const tplCode = String(d.tpl_code || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`);
    if (String(box.status) !== BOX_OPEN) return fail(res, "外箱已封箱，模板不可再改");
    await query("UPDATE prd_box SET tpl_code=$1, updated_at=now() WHERE box_no=$2", [tplCode, boxNo]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "换打印模板", boxNo, tplCode, req.ip);
    return ok(res, { box_no: boxNo, tpl_code: tplCode }, "打印模板已切换");
  });

  router.post("/pack/unbind", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const sn = String(d.sn || "").trim();
    const reason = String(d.reason || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`);
    if (String(box.status) !== BOX_OPEN) return fail(res, "已封箱的外箱不能解绑（请联系管理员走特批）");
    const sns = _packSns(box);
    if (!sns.includes(sn)) return fail(res, `SN【${sn}】不在本箱中`);
    const rest = sns.filter(s => s !== sn);
    await query("UPDATE prd_sn SET box_no='', updated_at=now() WHERE sn=$1 AND box_no=$2", [sn, boxNo]);
    await query("UPDATE prd_box SET qty=$1, sn_list=$2, updated_at=now() WHERE box_no=$3",
      [rest.length, rest.join(","), boxNo]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "解绑", boxNo,
      `${sn} ${reason}`, req.ip);
    return ok(res, await _packBoxJson(await _packBox(boxNo)),
      `已解绑：${sn}（剩 ${rest.length}/${box.capacity}）`);
  });

  router.post("/pack/box/cancel", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`);
    if (String(box.status) !== BOX_OPEN) return fail(res, "已封箱的箱不能作废");
    if (Number(box.qty || 0) > 0) {
      return fail(res, `箱内已有 ${box.qty} 台产品，不能作废（请先逐台解绑）`);
    }
    await query("DELETE FROM prd_box WHERE box_no=$1 AND qty=0", [boxNo]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "作废空箱", boxNo, "", req.ip);
    return ok(res, null, "空箱已作废");
  });

  router.post("/pack/print", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const reprint = !!d.reprint;
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`);
    if (String(box.status) !== BOX_CLOSED) return fail(res, "请先完成封箱再打印标签");
    const [rule, pc] = await ruleOfMo(box.mo_no);
    if (!rule) return fail(res, `机型【${box.product_code || pc || "?"}】未配置装箱编码规则`);
    const tplCode = String(d.tpl_code || "").trim() || String(box.tpl_code || "") ||
      String(rule.carton_tpl_code || "");
    const tpl = tplCode
      ? (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1", [tplCode])).rows[0]
      : null;
    if (!tpl) return fail(res, "请先选择打印模板（配置中心 → 打印模板）");
    const payload = _packBoxPayload(box, rule, tpl, reprint, req.mesrjUser);
    const jobNo = await makePrintJob("box", box.box_no, tpl, payload,
      (req.mesrjUser || {}).login_name || "", box.box_no);
    await query("UPDATE prd_box SET print_times=print_times+1, tpl_code=$1, updated_at=now() WHERE box_no=$2",
      [tpl.tpl_code, boxNo]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "打印标签", boxNo,
      `${tpl.tpl_code} ${reprint ? "补打" : "打印"}`, req.ip);
    return ok(res, { job_no: jobNo, payload },
      `已生成打印任务 ${jobNo}（等待打印程序取走）`);
  });

  // ── W11-e：打印任务队列 / 标签预览 / 查询 / 模板浏览 ───────────────────────

  router.get("/pack/jobs", requireMesrjPerm(null), async (req, res) => {
    const status = String(req.query.status || "待打印").trim();
    const refType = String(req.query.ref_type || "").trim();
    const limit = Math.min(Number(req.query.limit || 20) || 20, 100);
    const jobNo = String(req.query.job_no || "").trim();
    const w = ["status=$1"], args = [status];
    if (refType) { w.push(`ref_type=$${args.length + 1}`); args.push(refType); }
    if (jobNo) { w.push(`job_no=$${args.length + 1}`); args.push(jobNo); }
    const rows = (await query(
      `SELECT * FROM prd_print_job WHERE ${w.join(" AND ")} ORDER BY id LIMIT $${args.length + 1}`,
      [...args, limit])).rows;
    const out = rows.map(r => {
      const d = { ...r, created_at: tsLocal(r.created_at), printed_at: tsLocal(r.printed_at) };
      try { d.payload = JSON.parse(d.payload || "{}"); } catch { d.payload = {}; }
      return d;
    });
    return ok(res, out);
  });

  router.post("/pack/jobs/:job_no/done", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const done = d.ok !== false;
    const msg = String(d.msg || "").trim();
    const jobNo = String(req.params.job_no || "").trim();
    const job = (await query("SELECT id FROM prd_print_job WHERE job_no=$1", [jobNo])).rows[0];
    if (!job) return fail(res, `打印任务不存在：${jobNo}`, 404);
    const status = done ? "已打印" : "失败";
    await query("UPDATE prd_print_job SET status=$1, printed_at=now(), print_msg=$2 WHERE job_no=$3",
      [status, msg, jobNo]);
    return ok(res, null, `任务 ${jobNo} 已标记为 ${status}`);
  });

  /** 该箱用的打印模板（源 _tpl_of） */
  async function _packTplOf(box) {
    const [rule] = await ruleOfMo(box.mo_no);
    const code = String(box.tpl_code || "").trim() || String((rule || {}).carton_tpl_code || "");
    const tpl = code
      ? (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1", [code])).rows[0]
      : null;
    return tpl || { tpl_code: code, tpl_name: code, file_name: "", fields: "[]" };
  }

  /** 按当前箱生成打印数据；若有 .btw 模板，按模板槽位数重新分页（源 _preview_payload） */
  /** @returns {Promise<[object, number, string]>} [payload, slots, tplFile] */
  async function _packPreviewPayload(box) {
    const [rule] = await ruleOfMo(box.mo_no);
    const tpl = await _packTplOf(box);
    const payload = _packBoxPayload(box, rule || {}, tpl, box.status === BOX_CLOSED);
    let slots = 0, tplFile = "";
    const tplDir = String(await getParam("print.tpl_dir", "") || "").trim();
    if (tplDir && tpl.file_name) {
      const fpath = path.join(tplDir, tpl.file_name);
      if (existsSync(fpath)) {
        tplFile = fpath;
        try {
          const prompts = readTemplatePrompts(fpath);
          slots = prompts.filter(x => x.toUpperCase().includes("QRCODE")).length;
        } catch { slots = 0; }
      }
    }
    if (slots) {   // 按模板槽位数切页（模板改了就跟着变）
      const sns = payload.sns || [];
      payload.sn_pages = [];
      for (let i = 0; i < sns.length; i += slots) payload.sn_pages.push(sns.slice(i, i + slots));
      if (!payload.sn_pages.length) payload.sn_pages = [[]];
    }
    return [payload, slots, path.basename(tplFile)];
  }

  router.get("/pack/preview/info", requireMesrjPerm(null), async (req, res) => {
    const boxNo = String(req.query.box_no || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`, 404);
    const [payload, slots, tplFile] = await _packPreviewPayload(box);
    return ok(res, {
      box_no: boxNo, qty: box.qty, status: box.status,
      tpl_code: box.tpl_code, tpl_file: tplFile,
      slots: slots || 48, pages: (payload.sn_pages || [[]]).length,
      sns: (payload.sns || []).length,
    });
  });

  router.get("/pack/preview", requireMesrjPerm(null), async (req, res) => {
    // 返回标签图（page 从 1 开始）
    //   源用 PIL 渲染 PNG；Node 无字体渲染库 → 同版式改出 SVG（<img src> 直接用）
    const boxNo = String(req.query.box_no || "").trim();
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`, 404);
    const [payload, slots] = await _packPreviewPayload(box);
    const pages = buildPages(payload);
    if (!pages.length) return fail(res, "没有可预览的内容");
    const op = pages[Math.min(page - 1, pages.length - 1)];
    const svg = renderSvg([op]);
    const img = "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
    return ok(res, { page, pages: pages.length, mode: "zpl", slots: slots || 48, err: null, img, payload });
  });

  router.get("/pack/box/list", requireMesrjPerm(null), async (req, res) => {
    const page = Math.max(Number(req.query.page || 1) || 1, 1);
    const size = Math.min(Math.max(Number(req.query.size || 50) || 50, 1), 200);
    const w = [], args = [];
    const moNo = String(req.query.mo_no || "").trim();
    const status = String(req.query.status || "").trim();
    const keyword = String(req.query.keyword || "").trim();
    if (moNo) { w.push(`mo_no=$${args.length + 1}`); args.push(moNo); }
    if (status) { w.push(`status=$${args.length + 1}`); args.push(status); }
    if (keyword) { w.push(`box_no ILIKE $${args.length + 1}`); args.push(`%${keyword}%`); }
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const total = Number((await query(
      `SELECT COUNT(*)::int AS n FROM prd_box ${where}`, args)).rows[0].n || 0);
    const rows = (await query(
      `SELECT * FROM prd_box ${where} ORDER BY id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, (page - 1) * size])).rows;
    const out = [];
    for (const r of rows) out.push(await _packBoxJson(r, false));
    return ok(res, { rows: out, total, page, size });
  });

  router.get("/pack/box/:box_no", requireMesrjPerm(null), async (req, res) => {
    const boxNo = String(req.params.box_no || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`, 404);
    const jobs = (await query(
      `SELECT job_no, ref_type, ref_no, status, tpl_code, created_at, printed_at
       FROM prd_print_job WHERE ref_no=$1 ORDER BY id DESC LIMIT 10`, [boxNo])).rows
      .map(j => ({ ...j, created_at: tsLocal(j.created_at), printed_at: tsLocal(j.printed_at) }));
    const [rule] = await ruleOfMo(box.mo_no);
    return ok(res, {
      box: await _packBoxJson(box), jobs, rule,
      machine_model: (rule || {}).machine_model || "",
    });
  });

  router.get("/pack/tpl/files", requireMesrjPerm(null), async (_req, res) => {
    // 打印电脑上实际存在的 .btw（供页面「选本机模板」）
    const files = await _packAgentTplFiles();
    const ag = await _packAgentState();
    return ok(res, {
      tpl_dir: String(await getParam("print.tpl_dir", "") || "").trim(),
      files, count: files.length,
      mode: String(await getParam("print.agent_mode", "") || "").trim(),
      agent_alive: ag.alive, last_seen: ag.last_seen,
      bartender: ag.bartender || "",
    });
  });

  router.get("/pack/tpl/browse", requireMesrjPerm("prod.pack"), async (req, res) => {
    // 浏览磁盘目录挑 .btw 模板（网页读不了本地磁盘，由服务端代劳）。只读。
    const drives = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("")
      .map(L => `${L}:\\`).filter(d => existsSync(d));
    let d = String(req.query.dir || "").trim().replace(/^"|"$/g, "");
    if (!d) {
      return ok(res, { dir: "", parent: "", dirs: [], files: [], drives,
        default: String(await getParam("print.tpl_dir", "") || "") });
    }
    d = path.normalize(d);
    if (!existsSync(d) || !statSync(d).isDirectory()) {
      return fail(res, `目录不存在或不可读：${d}`);
    }
    const dirs = [], files = [];
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return fail(res, `没有权限读取：${d}`);
    }
    entries.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1, bd = b.isDirectory() ? 0 : 1;
      return ad !== bd ? ad - bd : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name.startsWith("$") || e.name.startsWith("System Volume")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) dirs.push({ name: e.name, path: full });
      else if (e.name.toLowerCase().endsWith(".btw")) {
        let st = null;
        try { st = statSync(full); } catch { continue; }
        files.push({ name: e.name, path: full, size: st.size, mtime: tsLocal(st.mtime) });
      }
    }
    let parent = path.dirname(d.replace(/[\\/]+$/, ""));
    if (parent === d || !parent) parent = "";
    return ok(res, { dir: d, parent, dirs, files, drives });
  });

  router.post("/pack/tpl/quick", requireMesrjPerm("prod.pack"), async (req, res) => {
    // 「浏览…」选中的 .btw：已登记过就直接用，没登记就自动建一条
    const d = req.body || {};
    const p = String(d.path || "").trim().replace(/^"|"$/g, "");
    let kind = String(d.tpl_type || "外箱标签").trim();
    if (!["外箱标签", "栈板标签", "测试标签", "物料标签"].includes(kind)) kind = "外箱标签";
    if (!p) return fail(res, "没有选中文件");
    if (!existsSync(p) || !statSync(p).isFile()) return fail(res, `文件不存在：${p}`);
    if (!p.toLowerCase().endsWith(".btw")) return fail(res, "只支持 BarTender 模板（.btw）");
    const base = path.basename(p);
    const hit = (await query(
      `SELECT * FROM cfg_print_tpl WHERE file_name=$1 OR file_name=$2 ORDER BY enabled DESC, id LIMIT 1`,
      [p, base])).rows[0];
    if (hit) {
      if (!Number(hit.enabled || 0)) {
        await query("UPDATE cfg_print_tpl SET enabled=1 WHERE id=$1", [hit.id]);
      }
      return ok(res, { tpl_code: hit.tpl_code, tpl_name: hit.tpl_name, created: false, enabled: 1 },
        `已有该模板登记，直接选用：${hit.tpl_name}`);
    }
    const stamp = new Date();
    const pad = n => String(n).padStart(2, "0");
    let code = "TPL-" +
      `${String(stamp.getFullYear()).slice(2)}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
      `${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
    while ((await query("SELECT id FROM cfg_print_tpl WHERE tpl_code=$1", [code])).rows[0]) code += "X";
    const name = path.basename(base, path.extname(base));
    const sortNo = Number((await query(
      "SELECT COALESCE(MAX(sort_no),0)+10 AS n FROM cfg_print_tpl")).rows[0].n || 10);
    await query(
      `INSERT INTO cfg_print_tpl (tpl_code, tpl_name, tpl_type, product_code, file_name, fields,
         enabled, sort_no, remark) VALUES ($1,$2,$3,'',$4,'["SN","Carton"]',1,$5,$6)`,
      [code, name, kind, p, sortNo, `页面「浏览…」选磁盘文件自动登记（${kind}）`]);
    await audit(_packUserName(req.mesrjUser) || "system", "打印模板", "浏览登记", code, p);
    return ok(res, { tpl_code: code, tpl_name: name, created: true, enabled: 1 },
      `已登记并选用：${base}`);
  });

  router.get("/pack/stats", requireMesrjPerm(null), async (req, res) => {
    // 外箱绑码页顶部的产能带：本工单计划 / 已装箱 / 剩余 / 达成率 + 今日小时产量
    //   口径：只算 prd_box 里**已封箱**的箱，正在装的箱单独给 current
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return ok(res, { empty: true });
    const mo = (await query("SELECT mo_no, plan_qty FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    const boxes = (await query(
      `SELECT box_no, qty, capacity, status, created_at, pallet_no FROM prd_box
       WHERE mo_no=$1 AND COALESCE(status,'')<>'作废' ORDER BY id`, [moNo])).rows
      .map(b => ({ ...b, created_at: tsLocal(b.created_at) }));
    const closed = boxes.filter(b => String(b.status || "") === BOX_CLOSED);
    const opening = boxes.filter(b => String(b.status || "") !== BOX_CLOSED);
    const plan = Number(mo.plan_qty || 0);
    const packed = closed.reduce((a, b) => a + Number(b.qty || 0), 0);
    const curQty = opening.reduce((a, b) => a + Number(b.qty || 0), 0);
    const curCap = opening.reduce((a, b) => Math.max(a, Number(b.capacity || 0)), 0);
    const today = todayStr();
    const hourly = {};
    for (const b of closed) {
      const t = String(b.created_at || "").slice(0, 13);
      if (t.startsWith(today)) {
        const h = t.slice(11, 13);
        hourly[h] = (hourly[h] || 0) + Number(b.qty || 0);
      }
    }
    const hours = [];
    for (let h = 8; h <= 20; h++) hours.push({ h: String(h).padStart(2, "0"), n: hourly[String(h).padStart(2, "0")] || 0 });
    return ok(res, {
      mo_no: moNo, plan_qty: plan,
      packed_qty: packed,
      rest_qty: Math.max(0, plan - packed),
      box_qty: closed.length,
      cur_qty: curQty,
      cur_cap: curCap || Number(await getParam("BOX_CAPACITY", "96") || 96),
      rate: plan ? Math.round(packed * 1000 / plan) / 10 : 0,
      today_boxes: closed.filter(b => String(b.created_at || "").slice(0, 10) === today).length,
      today_qty: hours.reduce((a, h) => a + h.n, 0),
      hourly: hours,
    });
  });
}
