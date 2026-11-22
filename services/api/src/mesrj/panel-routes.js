// ============================================================================
// W12 面板/分板（源 api/panel.py，17 路由） —— 从 routes/mesrj.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮1续）。
// 依赖经 registerPanelRoutes(router, deps) 注入，与 smta-routes/ultra 同一约定；
// 注册位置在 createMesrjRouter 内保持不变（JWT 之后，顺序即原块顺序）。
// ============================================================================
import { ensureMoRoute, doPassInner, step_of } from "./domain.js";
import { parseSn, joinSn, judgeSlot, listLayouts, saveLayout, deleteLayout, matchLayout, agingOf, buildView, resolveNext, alignLayout, panelSnsFor, _posOfIndex0, _buildView, _judgeSlotByTest, _detectBaseByRecords, _resolveNext } from "./panel.js";

export function registerPanelRoutes(router, { query, ok, fail, perm: requireMesrjPerm }) {
  // ═══════════════════════════════════════════════════════════════════════════
  // W12：面板/分板（源 api/panel.py，10 路由）
  // ═══════════════════════════════════════════════════════════════════════════

  router.get("/panel/sn/parse", requireMesrjPerm(null), async (req, res) => {
    const p = parseSn(String(req.query.sn || ""));
    return ok(res, p ? { sn: req.query.sn, prefix: p.prefix, num: p.num, suffix: p.suffix, width: p.width } : { sn: req.query.sn, error: "无法解析 SN" });
  });

  router.get("/panel/layout/list", requireMesrjPerm(null), async (_req, res) => {
    const r = await listLayouts();
    return ok(res, r.rows);
  });

  router.post("/panel/layout/save", requireMesrjPerm("cfg.edit"), async (req, res) => {
    try {
      const r = await saveLayout(req.body || {});
      return ok(res, r, "布局已保存");
    } catch (e) { return fail(res, e.message); }
  });

  router.post("/panel/layout/delete", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const id = Number(req.body && req.body.id);
    if (!id) return fail(res, "缺少布局 id");
    await deleteLayout(id);
    return ok(res, { id }, "布局已删除");
  });

  router.get("/panel/view", requireMesrjPerm(null), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    const layoutId = req.query.layout_id ? Number(req.query.layout_id) : null;
    if (!sn) return fail(res, "缺少 SN");
    const v = await buildView(sn, layoutId);
    if (!v) return fail(res, `未找到产品：${sn}`);
    return ok(res, v);
  });

  router.post("/panel/judge", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const r = await judgeSlot(String(d.mo_no || "").trim(), String(d.station_code || "").trim());
    if (!r.ok) return fail(res, r.msg);
    return ok(res, { ok: true });
  });

  router.get("/panel/next", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const curStation = String(req.query.cur_station || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const nxt = await resolveNext(moNo, curStation);
    return ok(res, nxt);
  });

  router.post("/panel/align", requireMesrjPerm(null), async (req, res) => {
    const sn = String(req.body && req.body.sn || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    const layout = await alignLayout(sn);
    return ok(res, { layout });
  });

  router.get("/panel/aging", requireMesrjPerm(null), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    const a = await agingOf(sn);
    return ok(res, a);
  });

  router.get("/panel/layout/match", requireMesrjPerm(null), async (req, res) => {
    const layout = await matchLayout(String(req.query.product_code || "").trim() || undefined, String(req.query.model || "").trim() || undefined);
    return ok(res, { layout });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // W12：面板/分板剩余 7 路由（源 api/panel.py —— scan/current/complete/reset/detail/list/hourly）
  // ═══════════════════════════════════════════════════════════════════════════

  const _panelNow = () => { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

  // ── POST /panel/scan ── 核心：扫一块 → 自动归位 → 系统判定 ──
  router.post("/panel/scan", requireMesrjPerm("prod.panel"), async (req, res) => {
    const d = req.body || {};
    const sn = String(d.sn || "").trim();
    const station = String(d.station_code || "").trim();
    const moNo = String(d.mo_no || "").trim();
    const layoutId = d.layout_id;
    if (!sn) return fail(res, "请扫条码");

    const p = parseSn(sn);
    if (!p) return fail(res, `条码无效：${sn}`);
    const { prefix, num, suffix } = p;

    // 工位必须在这张工单的工艺里
    if (moNo && station) {
      try {
        const [steps] = await ensureMoRoute(moNo, "");
        if (steps && !step_of(steps, station)) {
          const mo = (await query("SELECT process_code FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0] || {};
          const pnMap = { "01": "SMT", "02": "DIP", "03": "组装", "04": "包装" };
          const pn = pnMap[String(mo.process_code || "")] || "";
          return fail(res,
            `工单 ${moNo} 是${pn || ""}工序单，这里面没有「${station}」这一站。分板属于组装段，请在上方工单下拉里换成组装段（P03）的工单再扫`);
        }
      } catch { /* ignore */ }
    }

    // 已扫过（跨版也不行）
    const dupR = await query(
      `SELECT s.*, p.panel_sn AS pn, p.status AS pstatus, p.total AS ptotal
       FROM prd_panel_slot s JOIN prd_panel_split p ON s.split_id=p.id
       WHERE s.child_sn=$1 AND p.status<>'已作废'`, [sn]);
    if (dupR.rows[0]) {
      const dup = dupR.rows[0];
      const sp0 = (await query("SELECT * FROM prd_panel_split WHERE id=$1", [dup.split_id])).rows[0];
      const j = dup.judge || "NONE";
      const _done = sp0 && (sp0.status || "") === "已完成";
      const _tt = Number(sp0 ? (sp0.total || 0) : 0);
      const _nextTip = _done
        ? "这一版已经收尾了 —— 要扫下一版，直接扫新一版的任意一块即可"
        : `这一版还没收尾，扫满 ${_tt} 块会自动完成；要开新一版请先点「扫描完成」`;
      if (j === "OK") {
        return fail(res, `这块板已在「${dup.pn || "（无版号）"}」这一版扫过（P${dup.slot_no}，良品）。${_nextTip}`);
      }
      if (j === "ICT_NG" || j === "FCT_NG" || j === "BOTH_NG") {
        const jt = { ICT_NG: "ICT NG", FCT_NG: "FCT NG", BOTH_NG: "ICT+FCT 双 NG" }[j];
        return fail(res, `这块板已在「${dup.pn || "（无版号）"}」这一版扫过（P${dup.slot_no}，${jt} → 维修）。${_nextTip}`);
      }
      return fail(res,
        `这块板已在「${dup.pn || "（无版号）"}」这一版扫过（P${dup.slot_no}，未查到 ICT/FCT 记录）。一版扫一块就够、整版自动带出，不用逐块扫。${_nextTip}`);
    }

    // 查找进行中的版
    let split = null;
    if (station) {
      const r = await query("SELECT * FROM prd_panel_split WHERE status='扫描中' AND station_code=$1 ORDER BY id DESC LIMIT 1", [station]);
      split = r.rows[0] || null;
    }
    let layout = null;
    if (split) {
      const r = await query("SELECT * FROM cfg_panel_layout WHERE model=$1 ORDER BY id DESC LIMIT 1", [split.model]);
      layout = r.rows[0] || null;
    }
    if (!layout) {
      let mo = null;
      if (moNo) {
        const r = await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo]);
        mo = r.rows[0] || null;
      }
      if (!mo && station) {
        const st0 = (await query("SELECT * FROM md_station WHERE station_code=$1", [station])).rows[0];
        if (st0 && st0.line_code) {
          const r = await query("SELECT * FROM ord_mo WHERE line_code=$1 AND status='生产中' ORDER BY id DESC LIMIT 1", [st0.line_code]);
          mo = r.rows[0] || null;
        }
      }
      layout = await matchLayout(mo ? mo.product_code : undefined, mo ? mo.product_code : undefined);
      if (!layout) return fail(res, "未配置拼版布局，请先选布局");
    }

    const cols = Number(layout.cols || 1);
    const total = Number(layout.total || 0);
    const serpentine = layout.serpentine != null ? Number(layout.serpentine) : 1;

    // 版起点：优先按 seq_offset 对齐，否则用测试记录探测
    const detected = await _detectBaseByRecords(sn, total, layout.seq_offset != null ? String(layout.seq_offset) : null);
    let effBase;
    if (detected != null) {
      layout = { ...layout, seq_offset: detected % total };
      effBase = detected;
    } else {
      const so = layout.seq_offset;
      effBase = num - (so == null || so === "" ? 0 : (num - Number(so)) % total);
      if (effBase < 1) {
        return fail(res,
          `这一版的起始号算成了 ${effBase}（不可能）。说明「拼版布局」里的「起始流水号(seq_offset)」和实际发号规则不一致 —— 扫到的是 ${num} 号，offset 配的是 ${so}。请到「配置中心 → 拼版布局」改成实际起始号`);
      }
    }

    // 判断是否属于当前进行中的版
    let samePanel = false;
    if (split && split.seq_base != null) {
      if (effBase === Number(split.seq_base)) samePanel = true;
    }

    let openedNew = false;
    if (!samePanel) {
      if (split) {
        await query("UPDATE prd_panel_split SET status='已结束', finished_at=$1 WHERE id=$2", [_panelNow(), split.id]);
      }
      const snsCalc = await panelSnsFor(moNo, sn);
      if (!snsCalc.sns || snsCalc.sns.length === 0) return fail(res, "无法推算整版条码");
      const stRow = (await query("SELECT * FROM md_station WHERE station_code=$1", [station])).rows[0] || {};
      let useMo = moNo || "";
      if (useMo && stRow) {
        const m = (await query("SELECT line_code FROM ord_mo WHERE mo_no=$1", [useMo])).rows[0];
        if (m && (m.line_code || "") !== (stRow.line_code || "")) useMo = "";
      }
      const panelSn = `${(prefix || "PANEL").replace(/-/g, "") || "PANEL"}-${String(effBase).padStart(p.width, "0")}`;
      const old = (await query("SELECT * FROM prd_panel_split WHERE panel_sn=$1", [panelSn])).rows[0];
      if (old) {
        if ((old.status || "") === "已作废") {
          await query("UPDATE prd_panel_split SET panel_sn=$1 WHERE id=$2", [`${panelSn}#作废${old.id}`, old.id]);
        } else {
          await query("DELETE FROM prd_panel_slot WHERE split_id=$1", [old.id]);
          await query("DELETE FROM prd_panel_split WHERE id=$1", [old.id]);
        }
      }
      const sidR = await query(
        `INSERT INTO prd_panel_split (panel_sn, mo_no, station_code, line_code, product_code, model, cols, rows, total, serpentine, seq_base, seq_offset, orientation, good_cnt, ng_cnt, scanned_cnt, status, operator, started_at, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,0,'扫描中',$14,$15,$16) RETURNING id`,
        [panelSn, useMo, station, (stRow.line_code || ""), layout.product_code || "", layout.model,
         cols, Number(layout.rows || 1), total, serpentine, effBase, layout.seq_offset,
         layout.orientation || "landscape",
         (req.mesrjUser && (req.mesrjUser.emp_name || req.mesrjUser.login_name)) || "",
         _panelNow(), `锚点 ${sn}`]);
      const sid = sidR.rows[0].id;
      split = (await query("SELECT * FROM prd_panel_split WHERE id=$1", [sid])).rows[0];
      openedNew = true;
    }

    const idx = (num - Number(split.seq_base)) % total;
    const pos = _posOfIndex0(idx, cols, serpentine);
    const taken = await query("SELECT * FROM prd_panel_slot WHERE split_id=$1 AND slot_no=$2", [split.id, pos]);
    if (taken.rows[0]) return fail(res, `第 ${pos} 格已占用：${taken.rows[0].child_sn}`);

    // 一键整版：扫一块 → 按拼版规则把整版 N 块全部带出并逐个判定
    const autoFill = d.auto_fill === true;
    let filled = 0, skipped = [];
    /** @type {Array<[number, string, number]>} [格位, 子板SN, 流水号] */
    let todo = [[pos, sn, num]];
    if (autoFill) {
      const baseI = Number(split.seq_base);
      const pfx = parseSn(sn);
      todo = [];
      if (pfx) {
        for (let i = 0; i < total; i++) {
          const nI = baseI + i;
          const posI = _posOfIndex0(i, cols, serpentine);
          todo.push([posI, joinSn(pfx.prefix, nI, pfx.suffix, pfx.width), nI]);
        }
      }
    }

    for (const [posI, snI, numI] of todo) {
      const exists = await query("SELECT id FROM prd_panel_slot WHERE split_id=$1 AND slot_no=$2", [split.id, posI]);
      if (exists.rows[0]) continue;
      const cross = await query(
        `SELECT s.id FROM prd_panel_slot s JOIN prd_panel_split p ON s.split_id=p.id WHERE s.child_sn=$1 AND s.split_id<>$2`, [snI, split.id]);
      if (cross.rows[0]) { skipped.push(snI); continue; }
      const infoI = await _judgeSlotByTest(snI);
      const disp = infoI.judge === "ICT_NG" || infoI.judge === "FCT_NG" || infoI.judge === "BOTH_NG"
        ? "放入不良品盒"
        : infoI.judge === "OK" ? "可流入下一站" : "";
      await query(
        `INSERT INTO prd_panel_slot (split_id, panel_sn, slot_no, row_idx, col_idx, child_sn, seq_no_val, ict_result, fct_result, judge, disposition, scanned_at, operator)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [split.id, split.panel_sn, posI, Math.floor((posI - 1) / cols) + 1, (posI - 1) % cols + 1, snI, numI,
         infoI.ict_result, infoI.fct_result, infoI.judge, disp, _panelNow(),
         (req.mesrjUser && (req.mesrjUser.emp_name || req.mesrjUser.login_name)) || ""]);
      if (autoFill) filled += 1;
      try {
        const hasRel = (await query("SELECT id FROM prd_sn_rel WHERE parent_sn=$1 AND child_sn=$2", [split.panel_sn, snI])).rows[0];
        if (!hasRel) {
          await query(
            `INSERT INTO prd_sn_rel (parent_sn, child_sn, rel_type, station, operator, is_active, mo_no, created_at)
             VALUES ($1,$2,'PANEL_SPLIT',$3,$4,1,$5,$6)`,
            [split.panel_sn, snI, station, (req.mesrjUser && req.mesrjUser.login_name) || "", split.mo_no || "", _panelNow()]);
        }
      } catch { /* prd_sn_rel may not exist in older DB */ }
    }

    const info = await _judgeSlotByTest(sn);
    const viewStats = await _buildView(split);
    await query(
      "UPDATE prd_panel_split SET good_cnt=$1, ng_cnt=$2, scanned_cnt=$3 WHERE id=$4",
      [viewStats.stats.ok, viewStats.stats.need_take, viewStats.stats.scanned, split.id]);
    split = (await query("SELECT * FROM prd_panel_split WHERE id=$1", [split.id])).rows[0];

    const judgeTxt = { OK: "OK 良品", ICT_NG: "ICT 不良", FCT_NG: "FCT 不良", BOTH_NG: "ICT+FCT 双不良", NONE: "无 ICT/FCT 记录" }[info.judge] || "";
    const { passNext, ngNext } = await _resolveNext(split);

    let warn = "";
    if (viewStats.stats.scanned && viewStats.stats.none === viewStats.stats.scanned) {
      warn = `无测试记录 · 请确认这批 SN 是否已过 ICT/FCT（起点 ${split.seq_base}）`;
    }

    return ok(res, {
      split, layout, slots: viewStats.view, stats: viewStats.stats,
      next: { pass: passNext, ng: ngNext }, warn,
      hit_slot: pos, judge: info.judge, judge_txt: judgeTxt,
      ict_result: info.ict_result, fct_result: info.fct_result,
      opened_new: openedNew, auto_filled: filled, skipped,
      msg: autoFill ? `扫一块已自动带出整版 ${viewStats.stats.scanned} 块` : `第 ${pos} 格 · ${judgeTxt}`,
    });
  });

  // ── GET /panel/current ── 当前工位进行中的版 ──
  router.get("/panel/current", requireMesrjPerm(null), async (req, res) => {
    const station = String(req.query.station_code || "").trim();
    const split = (await query("SELECT * FROM prd_panel_split WHERE status='扫描中' AND station_code=$1 ORDER BY id DESC LIMIT 1", [station])).rows[0] || null;
    if (!split) return ok(res, { split: null, slots: [], stats: null });
    const layout = (await query("SELECT * FROM cfg_panel_layout WHERE model=$1 ORDER BY id DESC LIMIT 1", [split.model])).rows[0] || null;
    const viewStats = await _buildView(split);
    const { passNext, ngNext } = await _resolveNext(split);
    return ok(res, { split, layout, slots: viewStats.view, stats: viewStats.stats, next: { pass: passNext, ng: ngNext } });
  });

  // ── POST /panel/complete ── 完成当前版（良品自动过站） ──
  router.post("/panel/complete", requireMesrjPerm("prod.panel"), async (req, res) => {
    const d = req.body || {};
    const splitId = d.split_id;
    const doPass = d.do_pass !== false;
    if (!splitId) return fail(res, "缺少 split_id");
    const split = (await query("SELECT * FROM prd_panel_split WHERE id=$1", [Number(splitId)])).rows[0] || null;
    if (!split) return fail(res, "会话不存在");
    if (split.status !== "扫描中") return fail(res, `该版已是「${split.status}」，不能完成`);
    const slots = (await query("SELECT * FROM prd_panel_slot WHERE split_id=$1 ORDER BY slot_no", [split.id])).rows;
    if (!slots.length) return fail(res, "还没有扫任何一块");
    const okSlots = slots.filter(s => s.judge === "OK");
    const ngSlots = slots.filter(s => s.judge === "ICT_NG" || s.judge === "FCT_NG" || s.judge === "BOTH_NG");

    let passed = 0, failed = [];
    if (doPass && split.station_code) {
      let passMo = split.mo_no || "";
      if (passMo) {
        const m = (await query("SELECT line_code FROM ord_mo WHERE mo_no=$1", [passMo])).rows[0];
        if (m && (m.line_code || "") !== (split.line_code || "")) passMo = "";
      }
      for (const s of okSlots) {
        try {
          const r = await doPassInner({
            sn: s.child_sn, station_code: split.station_code, mo_no: passMo, result: "OK",
            remark: `分板工位过站（版 ${split.panel_sn} 第 ${s.slot_no} 格）`,
          }, { login_name: `PANEL:${split.operator || ""}`, emp_name: split.operator || "分板工位", id: 0 }, req.ip);
          const body = Array.isArray(r) ? r[0] : r;
          const data = (body && body.data) || {};
          if ((body && body.success !== false) && data.accepted) {
            passed += 1;
          } else {
            failed.push({ sn: s.child_sn, msg: data.msg || body.msg || "过站失败" });
          }
        } catch (e) { failed.push({ sn: s.child_sn, msg: String(e).slice(0, 120) }); }
      }
    }

    await query(
      "UPDATE prd_panel_split SET status='已完成', finished_at=$1, good_cnt=$2, ng_cnt=$3, scanned_cnt=$4 WHERE id=$5",
      [_panelNow(), okSlots.length, ngSlots.length, slots.length, split.id]);
    return ok(res, {
      panel_sn: split.panel_sn, good: okSlots.length, need_take: ngSlots.length,
      scanned: slots.length, total: Number(split.total || 0), passed, failed,
      take_list: ngSlots.map(s => ({ slot_no: s.slot_no, sn: s.child_sn, judge: s.judge })),
    }, `完成：良品 ${okSlots.length} 块，需取出 ${ngSlots.length} 块`);
  });

  // ── POST /panel/reset ── 作废当前版（格子保留，仅改状态） ──
  router.post("/panel/reset", requireMesrjPerm("prod.panel"), async (req, res) => {
    const d = req.body || {};
    const splitId = d.split_id;
    const station = String(d.station_code || "").trim();
    let split = null;
    if (splitId) {
      const r = await query("SELECT * FROM prd_panel_split WHERE id=$1", [Number(splitId)]);
      split = r.rows[0] || null;
    } else if (station) {
      const r = await query("SELECT * FROM prd_panel_split WHERE status='扫描中' AND station_code=$1 ORDER BY id DESC LIMIT 1", [station]);
      split = r.rows[0] || null;
    }
    if (!split) return fail(res, "没有进行中的版");
    if (split.status !== "扫描中") return fail(res, `该版已是「${split.status}」，不能作废`);
    await query("UPDATE prd_panel_split SET status='已作废', finished_at=$1 WHERE id=$2", [_panelNow(), split.id]);
    return ok(res, null, "已作废；原记录保留可追溯");
  });

  // ── GET /panel/detail/:panel_sn ── 版详情 ──
  router.get("/panel/detail/:panel_sn", requireMesrjPerm(null), async (req, res) => {
    const panelSn = String(req.params.panel_sn || "").trim();
    const split = (await query("SELECT * FROM prd_panel_split WHERE panel_sn=$1", [panelSn])).rows[0] || null;
    if (!split) return fail(res, "没有该版的分板记录", 404);
    const slots = (await query("SELECT * FROM prd_panel_slot WHERE split_id=$1 ORDER BY slot_no", [split.id])).rows;
    return ok(res, { split, slots });
  });

  // ── GET /panel/list ── 版列表（分页） ──
  router.get("/panel/list", requireMesrjPerm(null), async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(100, Math.max(1, Number(req.query.size || 20)));
    const offset = (page - 1) * size;
    const where = [];
    const args = [];
    const kw = String(req.query.keyword || "").trim();
    if (kw) { where.push("(panel_sn ILIKE $1 OR mo_no ILIKE $2)"); args.push(`%${kw}%`, `%${kw}%`); }
    const st = String(req.query.f_status || "").trim();
    if (st) { where.push(`status=$${args.length + 1}`); args.push(st); }
    const d1 = String(req.query.d1 || "").trim();
    if (d1) { where.push(`started_at::date >= $${args.length + 1}`); args.push(d1); }
    const d2 = String(req.query.d2 || "").trim();
    if (d2) { where.push(`started_at::date <= $${args.length + 1}`); args.push(d2); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const cnt = (await query(`SELECT COUNT(*) FROM prd_panel_split ${w}`, args)).rows[0];
    const total = Number(cnt.count);
    const rows = (await query(
      `SELECT * FROM prd_panel_split ${w} ORDER BY id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, offset])).rows;
    return ok(res, { page, size, total, rows });
  });

  // ── GET /panel/hourly ── 分板产能（按小时） ──
  router.get("/panel/hourly", requireMesrjPerm(null), async (req, res) => {
    const day = String(req.query.d1 || "").trim() || new Date().toISOString().slice(0, 10);
    const station = String(req.query.station_code || "").trim();
    const where = ["date(s.scanned_at)=$1"];
    const args = [day];
    if (station) { where.push(`p.station_code=$${args.length + 1}`); args.push(station); }
    const rows = (await query(
      `SELECT to_char(s.scanned_at, 'HH24') AS h,
              COUNT(*) AS blocks,
              SUM(CASE WHEN s.judge IN ('ICT_NG','FCT_NG','BOTH_NG') THEN 1 ELSE 0 END) AS ng,
              COUNT(DISTINCT s.split_id) AS panels
       FROM prd_panel_slot s JOIN prd_panel_split p ON s.split_id=p.id
       WHERE ${where.join(" AND ")} GROUP BY h ORDER BY h`, args)).rows;
    const buckets = {};
    for (const r of rows) buckets[r.h] = r;
    const out = [];
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, "0");
      const r = buckets[key];
      out.push({
        hour: key,
        label: `${key}-${String((h + 1) % 24).padStart(2, "0")}`,
        panels: r ? Number(r.panels || 0) : 0,
        blocks: r ? Number(r.blocks || 0) : 0,
        ng: r ? Number(r.ng || 0) : 0,
      });
    }
    return ok(res, {
      day, hours: out,
      total: {
        panels: out.reduce((a, x) => a + x.panels, 0),
        blocks: out.reduce((a, x) => a + x.blocks, 0),
        ng: out.reduce((a, x) => a + x.ng, 0),
      },
    });
  });

  // W12：栈板绑码（源 api/pallet.py，14 路由）—— 复用 packcode.js: getRule/ruleOfMo/genPalletNo/
  //      nextPalletNo/wipNo/dayCode/makePrintJob/tsLocal
}
