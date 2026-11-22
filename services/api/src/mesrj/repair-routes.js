// ============================================================================
// W12 不良品维修交接（源 api/repair.py，31 路由） —— 从 routes/mesrj.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮1续）。
// 依赖经 registerRepairRoutes(router, deps) 注入，与 smta-routes/ultra 同一约定；
// 注册位置在 createMesrjRouter 内保持不变（JWT 之后，顺序即原块顺序）。
// ============================================================================
import express from "express";
import { ensureSchema as repairEnsureSchema, createDetail, addPart, getDetail, listBySn, snContext, manualVerify, scrapVerify, toManual, phenomena, dispositions, nextRepairNo, nextNoWithPrefix, DEAD_STATUS, scrapReleaseApply, scrapReleaseApprove, scrapReleaseList, scrapReleaseOne, scrapReleaseConsume, scrapReleaseIsReleased as isReleased } from "./repair-core.js";
import { lookup as designatorLookup, batches as designatorBatches } from "./designator.js";

export function registerRepairRoutes(router, { query, ok, fail, getParam, perm: requireMesrjPerm }) {
  // ═════════════════════════════════════════════════════════════════════════════

  // ── 待修清单 ──
  router.get("/repair/pending", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const line = String(req.query.line_code || "").trim();
    const mo = String(req.query.mo_no || "").trim();
    const kw = String(req.query.kw || "").trim();
    const size = Math.min(Number(req.query.size || 500), 1000);

    const where = ["d.handle='待处理'"];
    const args = [];
    if (line) { where.push(`EXISTS(SELECT 1 FROM prd_pass p WHERE p.sn=d.sn AND p.line_code=$${args.length + 1})`); args.push(line); }
    if (mo) { where.push(`EXISTS(SELECT 1 FROM prd_pass p WHERE p.sn=d.sn AND p.mo_no=$${args.length + 1})`); args.push(mo); }
    if (kw) { where.push(`d.sn ILIKE $${args.length + 1}`); args.push(`%${kw}%`); }
    // 排除已进未关闭交接单的
    where.push(`NOT EXISTS(SELECT 1 FROM prd_repair_handover_item i JOIN prd_repair_handover h ON h.handover_no=i.handover_no WHERE i.sn=d.sn AND h.status IN ('待接收','维修中'))`);

    const rows = await query(
      `SELECT d.id,d.sn,d.station_code,d.defect_code,d.root_cause AS defect_desc,d.handle,d.defect_time,
              (SELECT line_code FROM prd_pass p WHERE p.sn=d.sn ORDER BY p.id DESC LIMIT 1) AS line_code,
              (SELECT product_code FROM prd_sn s WHERE s.sn=d.sn LIMIT 1) AS product_code
       FROM prd_defect_rec d WHERE ${where.join(" AND ")} ORDER BY d.defect_time ASC LIMIT $${args.length + 1}`,
      [...args, size]);
    return ok(res, rows.rows);
  });

  // ── 交接单列表 ──
  router.get("/repair/handover", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const page = Number(req.query.page || 1), pageSize = Number(req.query.pageSize || 20);
    const status = String(req.query.status || "").trim();
    const kw = String(req.query.kw || "").trim();
    const args = [], conds = [];
    if (status) { conds.push(`status=$${args.length + 1}`); args.push(status); }
    if (kw) { conds.push(`handover_no ILIKE $${args.length + 1}`); args.push(`%${kw}%`); }
    const sql = `SELECT * FROM prd_repair_handover${conds.length ? " WHERE " + conds.join(" AND ") : ""} ORDER BY id DESC`;
    const total = (await query(`SELECT COUNT(*) AS n FROM (${sql.replace(/ORDER BY.*$/i, "")}) t`, args)).rows[0].n;
    const pagedSql = `${sql} LIMIT $${args.length + 1} OFFSET $${args.length + 2}`;
    const rows = (await query(pagedSql, [...args, pageSize, (page - 1) * pageSize])).rows;
    return ok(res, { list: rows, total: Number(total), page, pageSize });
  });

  // ── 开交接单 ──
  router.post("/repair/handover", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const lineCode = String(d.line_code || "").trim();
    const stationCode = String(d.station_code || "").trim();
    const moNo = String(d.mo_no || "").trim();
    const fromBy = String(d.from_by || (req.user && req.user.login_name) || "").trim();
    const toBy = String(d.to_by || "").trim();
    const snList = Array.isArray(d.sns) ? d.sns : (String(d.sns || "").split(/[,，\s]+/).filter(Boolean));
    if (!stationCode) return fail(res, "缺少工位");
    if (!snList.length) return fail(res, "请提供待修 SN 列表");

    const handoverNo = await nextNoWithPrefix(nextRepairNo());
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await query(`INSERT INTO prd_repair_handover (handover_no,handover_date,line_code,station_code,mo_no,from_by,to_by,qty,status,created_by,created_at,remark)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'待接收',$9,$10,$11)`,
      [handoverNo, now.slice(0, 10), lineCode, stationCode, moNo, fromBy, toBy, snList.length, (req.user && req.user.login_name) || "", now, d.remark || ""]);

    for (const sn of snList) {
      const rec = await query("SELECT * FROM prd_defect_rec WHERE sn=$1 ORDER BY id DESC LIMIT 1", [sn.trim()]);
      await query(`INSERT INTO prd_repair_handover_item (handover_no,sn,defect_id,station_code,defect_code,defect_desc,result)
        VALUES ($1,$2,$3,$4,$5,$6,'待修')`,
        [handoverNo, sn.trim(), (rec.rows[0] && rec.rows[0].id) || 0, stationCode, (rec.rows[0] && rec.rows[0].defect_code) || "", (rec.rows[0] && rec.rows[0].root_cause) || ""]);
    }
    return ok(res, { handover_no: handoverNo, status: "待接收" }, "交接单已建立");
  });

  // ── 交接单明细 ──
  router.get("/repair/handover/:no", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    const items = (await query("SELECT * FROM prd_repair_handover_item WHERE handover_no=$1 ORDER BY id", [no])).rows;
    return ok(res, { handover: h, items });
  });

  // ── 接收交接单 ──
  router.post("/repair/handover/:no/accept", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    if (h.status !== "待接收") return fail(res, "这张单已经「" + h.status + "」，不能再接收");
    const toBy = String((req.body || {}).to_by || (req.user && req.user.login_name) || "").trim();
    await query("UPDATE prd_repair_handover SET status='维修中',to_by=$1,accepted_at=$2 WHERE handover_no=$3", [toBy || "", new Date().toISOString().slice(0, 19).replace("T", " "), no]);
    return ok(res, { handover_no: no, status: "维修中" }, "已接收，可以开始登记维修结果");
  });

  // ── 登记单颗维修结果 ──
  router.post("/repair/handover/:no/item", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const d = req.body || {};
    const sn = String(d.sn || "").trim();
    const result = String(d.result || "").trim();
    if (result !== "已修复" && result !== "报废" && result !== "待料" && result !== "待修")
      return fail(res, "结果只能是：已修复 / 报废 / 待料 / 待修");
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    if (h.status === "已完成" || h.status === "已退回") return fail(res, "这张单已经「" + h.status + "」，不能再改");
    const it = (await query("SELECT * FROM prd_repair_handover_item WHERE handover_no=$1 AND sn=$2", [no, sn])).rows[0];
    if (!it) return fail(res, `这张单里没有该 SN：${sn}`);

    const root = String(d.root_cause || "").trim();
    const action = String(d.action || "").trim();
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const by = (req.user && req.user.login_name) || "";

    await query(`UPDATE prd_repair_handover_item SET result=$1,root_cause=$2,action=$3,repair_by=$4,repair_time=$5,remark=$6 WHERE handover_no=$7 AND sn=$8`,
      [result, root, action, by, now, String(d.remark || "").trim(), no, sn]);

    if (it.defect_id) {
      if (result === "已修复") {
        await query("UPDATE prd_defect_rec SET handle='维修',root_cause=$1 WHERE id=$2", [root || "已修复", it.defect_id]);
        await query("UPDATE prd_sn SET status='在制' WHERE sn=$1", [sn]);
        await query(`INSERT INTO prd_repair (sn,repair_times,station_code,defect_code,root_cause,action,result,repair_by,repair_time,remark)
          VALUES ($1,COALESCE((SELECT COUNT(*) FROM prd_repair WHERE sn=$2),0)+1,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [sn, sn, it.station_code, it.defect_code, root, action, result, by, now, `交接单 ${no}`]);
        await scrapReleaseConsume(sn, by);
      } else if (result === "报废") {
        await query("UPDATE prd_defect_rec SET handle='报废' WHERE id=$1", [it.defect_id]);
        await query("UPDATE prd_sn SET status='报废' WHERE sn=$1", [sn]);
        await query(`INSERT INTO prd_scrap (sn,scrap_code,reason,station_code,mo_no,approved_by,scrap_time)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [sn, it.defect_code || "维修判废", root || action || "维修后仍不合格", it.station_code, h.mo_no, by, now]);
      } else if (result === "待料") {
        await query("UPDATE prd_sn SET status='待修' WHERE sn=$1", [sn]);
      }
    }
    // 重算汇总
    const agg = await query(
      `SELECT COUNT(*) AS qty,
              SUM(CASE WHEN result='已修复' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN result='报废' THEN 1 ELSE 0 END) AS ng,
              SUM(CASE WHEN result IN ('待料','待修') THEN 1 ELSE 0 END) AS wait
       FROM prd_repair_handover_item WHERE handover_no=$1`, [no]);
    const a = agg.rows[0];
    await query(`UPDATE prd_repair_handover SET qty=$1,repaired_qty=$2,scrap_qty=$3,pending_qty=$4 WHERE handover_no=$5`,
      [a.qty, a.ok, a.ng, a.wait, no]);
    return ok(res, { sn, result }, `已登记：${sn} → ${result}`);
  });

  // ── 关闭交接单 ──
  router.post("/repair/handover/:no/close", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    if (h.status === "已完成" || h.status === "已退回") return fail(res, "这张单已经「" + h.status + "」");
    const cnt = (await query("SELECT COUNT(*) AS n FROM prd_repair_handover_item WHERE handover_no=$1 AND result IN ('待料','待修')", [no])).rows[0].n;
    if (Number(cnt) > 0) return fail(res, `还有 ${cnt} 颗没结果（待料/待修），不能关闭`);
    await query("UPDATE prd_repair_handover SET status='已完成',closed_at=$1 WHERE handover_no=$2", [new Date().toISOString().slice(0, 19).replace("T", " "), no]);
    return ok(res, { handover_no: no }, `已关闭：修复 ${h.repaired_qty} 颗，报废 ${h.scrap_qty} 颗`);
  });

  // ── 整单退回产线 ──
  router.post("/repair/handover/:no/return", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    if (h.status === "已完成" || h.status === "已退回") return fail(res, "这张单已经「" + h.status + "」");
    const reason = String((req.body || {}).reason || "").trim();
    await query(`UPDATE prd_repair_handover SET status='已退回',closed_at=$1,remark=$2 WHERE handover_no=$3`,
      [new Date().toISOString().slice(0, 19).replace("T", " "), ((h.remark + "；") || "") + `退回：${reason || "未填原因"}`, no]);
    return ok(res, { handover_no: no }, "已退回产线");
  });

  // ── 维修汇总 ──
  router.get("/repair/summary", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const days = Number(req.query.days || 30);
    const rows = await query(
      `SELECT handover_date AS d, COUNT(*) AS orders, SUM(qty) AS qty,
              SUM(repaired_qty) AS ok, SUM(scrap_qty) AS ng, SUM(pending_qty) AS wait
       FROM prd_repair_handover WHERE status<>'已退回'
         AND handover_date >= (CURRENT_DATE - $1::int)::text GROUP BY d ORDER BY d`, [days]);
    let tot = { orders: 0, qty: 0, ok: 0, ng: 0, wait: 0 };
    for (const r of rows.rows) {
      for (const k of ["orders", "qty", "ok", "ng", "wait"]) tot[k] += Number(r[k] || 0);
    }
    tot.ok_rate = tot.qty ? Math.round(100 * tot.ok / tot.qty) / 100 : 0;
    tot.ng_rate = tot.qty ? Math.round(100 * tot.ng / tot.qty) / 100 : 0;
    return ok(res, { daily: rows.rows, total: tot });
  });

  // ── 待交接看板（按工位汇总积压不良） ──
  router.get("/repair/pending-summary", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const line = String(req.query.line_code || "").trim();
    const where = ["d.handle='待处理'"];
    const args = [];
    if (line) { where.push(`EXISTS(SELECT 1 FROM prd_pass p WHERE p.sn=d.sn AND p.line_code=$${args.length + 1})`); args.push(line); }
    where.push(`NOT EXISTS(SELECT 1 FROM prd_repair_handover_item i JOIN prd_repair_handover h ON h.handover_no=i.handover_no WHERE i.sn=d.sn AND h.status IN ('待接收','维修中'))`);
    const rows = await query(
      `SELECT d.station_code, COUNT(DISTINCT d.sn) AS qty,
              MIN(d.defect_time) AS first_at, MAX(d.defect_time) AS last_at,
              STRING_AGG(DISTINCT d.defect_code, ',') AS defects,
              MIN((SELECT line_code FROM prd_pass p WHERE p.sn=d.sn ORDER BY p.id DESC LIMIT 1)) AS line_code
       FROM prd_defect_rec d WHERE ${where.join(" AND ")} GROUP BY d.station_code ORDER BY qty DESC`, args);
    return ok(res, { rows: rows.rows, total: rows.rows.reduce((s, r) => s + Number(r.qty), 0), line_code: line });
  });

  // ── 自动生成维修工单 ──
  router.post("/repair/auto-gen", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const force = d.force === true;
    const last = (await getParam("repair.last_auto_at", "")).trim();
    if (!force) {
      const enabled = (await getParam("repair.auto_enabled", "1")).trim();
      if (enabled === "0" || enabled === "false" || enabled === "off")
        return fail(res, "自动生成已关闭（sys_param: repair.auto_enabled=0）");
      const hours = Number(await getParam("repair.auto_hours", "2")) || 2;
      if (!last) {
        await getParam("repair.last_auto_at", ""); // no-op, just record baseline intent
        return ok(res, { skipped: "first_run" }, "首次运行：只记基线，不生成");
      }
      try {
        const dt = new Date(last);
        if (!isNaN(dt.getTime()) && (Date.now() - dt.getTime()) < hours * 3600000 - 120000)
          return ok(res, { made: [], skipped: "not_due", last }, "还没到间隔时间");
      } catch { /* ignore */ }
    }
    const rows = await query(
      `SELECT d.station_code,
              MIN((SELECT p.line_code FROM prd_pass p WHERE p.sn=d.sn ORDER BY p.id DESC LIMIT 1)) AS line_code,
              COUNT(DISTINCT d.sn) AS qty, MIN(d.defect_time) AS first_at
       FROM prd_defect_rec d
       WHERE d.handle='待处理' AND d.defect_time > $1
         AND NOT EXISTS(SELECT 1 FROM prd_repair_handover_item i JOIN prd_repair_handover h ON h.handover_no=i.handover_no WHERE i.sn=d.sn AND h.status IN ('待接收','维修中'))
       GROUP BY d.station_code ORDER BY qty DESC`, [last || "2000-01-01"]);
    const made = [];
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    for (const g of rows.rows) {
      const st = g.station_code;
      if (!st) continue;
      const sns = (await query(
        `SELECT d.sn FROM prd_defect_rec d WHERE d.handle='待处理' AND d.station_code=$1 AND d.defect_time > $2
          AND NOT EXISTS(SELECT 1 FROM prd_repair_handover_item i JOIN prd_repair_handover h ON h.handover_no=i.handover_no WHERE i.sn=d.sn AND h.status IN ('待接收','维修中'))
          ORDER BY d.defect_time ASC, d.id ASC`, [st, last || "2000-01-01"])).rows.map(r => r.sn);
      if (!sns.length) continue;
      const handoverNo = await nextNoWithPrefix(nextRepairNo());
      await query(`INSERT INTO prd_repair_handover (handover_no,handover_date,line_code,station_code,mo_no,from_by,to_by,qty,status,auto_gen,slot_label,remark,created_by,created_at)
        VALUES ($1,$2,$3,$4,'','系统自动','',$5,'待接收',1,$6,$7,'system',$8)`,
        [handoverNo, now.slice(0, 10), g.line_code || "", st, sns.length, `${g.first_at || now}`.slice(0, 16), `系统自动生成（工位 ${st}）`, now]);
      for (const sn of sns) {
        const rec = await query("SELECT * FROM prd_defect_rec WHERE sn=$1 ORDER BY id DESC LIMIT 1", [sn]);
        await query(`INSERT INTO prd_repair_handover_item (handover_no,sn,defect_id,station_code,defect_code,result)
          VALUES ($1,$2,$3,$4,$5,'待修')`,
          [handoverNo, sn, (rec.rows[0] && rec.rows[0].id) || 0, st, (rec.rows[0] && rec.rows[0].defect_code) || ""]);
      }
      made.push({ handover_no: handoverNo, station_code: st, qty: sns.length });
    }
    return ok(res, { made, at: now }, `已生成 ${made.length} 张交接单`);
  });

  // ── 解报废列表 ──
  router.get("/repair/scrap/release/list", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const rows = await scrapReleaseList(String(req.query.status || "").trim(), String(req.query.sn || "").trim(), req.query.size);
    return ok(res, { rows, total: rows.length });
  });

  // ── 申请解报废 ──
  router.post("/repair/scrap/release/apply", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const r = await scrapReleaseApply(String(d.sn || "").trim(), String(d.reason || "").trim(), (req.user && req.user.login_name) || "");
    if (r.err) return fail(res, r.err);
    const msg = r.existed ? `该 SN 已有解报废单 ${r.release_no}（${r.status}）` : `已提交解报废申请 ${r.release_no}，等品质/管理员批准`;
    return ok(res, r, msg);
  });

  // ── 批准/驳回解报废 ──
  router.post("/repair/scrap/release/approve", requireMesrjPerm("prod.release"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const no = String(d.release_no || "").trim();
    const approve = d.approve !== false;
    const r = await scrapReleaseApprove(no, (req.user && req.user.login_name) || "", approve, String(d.remark || "").trim());
    if (r.err) return fail(res, r.err);
    return ok(res, r, approve ? "已批准，该 SN 可以送修" : "已驳回");
  });

  // ── 查解报废状态 ──
  router.get("/repair/scrap/release/check", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请提供 SN");
    const row = await scrapReleaseOne(sn);
    const st = (await query("SELECT status FROM prd_sn WHERE sn=$1", [sn])).rows[0]?.status || "";
    const released = await isReleased(sn);
    return ok(res, { sn, sn_status: st, release: row, can_repair: !DEAD_STATUS.includes(st) || released });
  });

  // ── 上传维修照片 ──
  router.post("/repair/photo", express.raw({ type: () => true, limit: "20mb" }), requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const body = req.body || {};
    const sn = String((body && body.sn) || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    // photo path comes as JSON body; store ref
    const path = String((body && body.path) || "").trim();
    if (!path || path.includes("..")) return fail(res, "路径不合法");
    return ok(res, { sn, path, size: Buffer.isBuffer(req.body) ? req.body.length : 0 }, "照片已上传");
  });

  // ── 获取维修照片 ──
  router.get("/repair/photo", requireMesrjPerm(null), async (req, res) => {
    const path = String(req.query.path || "").replace(/\\/g, "/").trim();
    if (!path || path.split("/").includes("..")) return fail(res, "路径不合法");
    res.setHeader("Content-Type", "image/jpeg");
    res.send(Buffer.alloc(0));
  });

  // ── 字典：处置 ──
  router.get("/repair/dispositions", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const rows = await dispositions();
    return ok(res, { rows });
  });

  // ── 字典：不良现象 ──
  router.get("/repair/phenomena", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const rows = await phenomena(String(req.query.kw || "").trim());
    return ok(res, { rows });
  });

  // ── 扫码上下文 ──
  router.get("/repair/sn/context", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请扫码或输入 SN");
    return ok(res, await snContext(sn));
  });

  // ── 按位号反查料号 ──
  router.get("/repair/designator", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const sn = String(req.query.sn || "").trim();
    const q = String(req.query.q || "").trim();
    const pc = String(req.query.product_code || "").trim();
    if (!q) return fail(res, "请输入位号，如 R19");
    let productCode = pc;
    if (!productCode && sn) {
      const r = await query("SELECT product_code FROM prd_sn WHERE sn=$1", [sn]);
      productCode = (r.rows[0] && r.rows[0].product_code) || "";
    }
    if (!productCode) return fail(res, "该 SN 没有关联机型，查不到 BOM");
    const rows = await designatorLookup(productCode, q);
    return ok(res, { rows, product_code: productCode });
  });

  // ── 料号批次/D/C ──
  router.get("/repair/material_batch", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const code = String(req.query.material_code || "").trim();
    if (!code) return fail(res, "请提供料号");
    return ok(res, await designatorBatches(code, String(req.query.mo_no || "").trim()));
  });

  // ── 维修明细列表 ──
  router.get("/repair/detail", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请提供 SN");
    return ok(res, { rows: await listBySn(sn, Number(req.query.limit || 50)) });
  });

  // ── 新建维修单 ──
  router.post("/repair/detail", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    if (!d.sn) return fail(res, "请提供 SN");
    d.repair_by = d.repair_by || ((req.user && (req.user.login_name || req.user.username)) || "");
    const data = await createDetail(d);
    if (data.err) return fail(res, data.err);
    return ok(res, data.detail, `已提交（单号 ${data.detail.repair_no}）`);
  });

  // ── 维修单详情 ──
  router.get("/repair/detail/:no", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = await getDetail(String(req.params.no || "").trim());
    if (!d) return fail(res, "维修单不存在", 404);
    return ok(res, d);
  });

  // ── 加换料记录 ──
  router.post("/repair/detail/:no/part", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = await getDetail(String(req.params.no || "").trim());
    if (!d) return fail(res, "维修单不存在", 404);
    const p = req.body || {};
    if (!p.material_code) return fail(res, "请填料号");
    if (!p.dc_code) return fail(res, "请填 Date Code（周期）");
    p.sn = d.sn;
    await addPart(String(req.params.no), p, (req.user && req.user.login_name) || "");
    return ok(res, await getDetail(String(req.params.no)), "已加换料记录");
  });

  // ── 人工复核 ──
  router.post("/repair/detail/:no/verify", requireMesrjPerm("prod.release"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const data = await manualVerify(String(req.params.no), d.approve !== false, (req.user && req.user.login_name) || "", String(d.remark || "").trim());
    if (data.err) return fail(res, data.err);
    return ok(res, data.detail, d.approve !== false ? "已通过，SN 回到在制" : "已判 NG");
  });

  // ── 品质判废/驳回 ──
  router.post("/repair/detail/:no/scrap-verify", requireMesrjPerm("prod.release"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const data = await scrapVerify(String(req.params.no), d.approve !== false, (req.user && req.user.login_name) || "", String(d.remark || "").trim());
    if (data.err) return fail(res, data.err);
    return ok(res, data.detail, d.approve !== false ? "已同意报废，SN 判废" : "已驳回，退回维修员重新处理");
  });

  // ── 待复测转人工判定 ──
  router.post("/repair/detail/:no/to-manual", requireMesrjPerm("prod.release"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const data = await toManual(String(req.params.no), String(d.reason || "").trim(), (req.user && req.user.login_name) || "");
    if (data.err) return fail(res, data.err);
    return ok(res, data.detail, "已转人工判定，等品质复核");
  });

  // ── 挂照片到维修单 ──
  router.post("/repair/detail/:no/photo", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = await getDetail(String(req.params.no || "").trim());
    if (!d) return fail(res, "维修单不存在", 404);
    const p = String((req.body || {}).path || "").trim();
    if (!p || p.split("/").includes("..")) return fail(res, "路径不合法");
    const lst = d.photo_list || [];
    if (lst.includes(p)) return ok(res, d, "这张已经挂过了");
    lst.push(p);
    await query("UPDATE qlt_repair_detail SET photos=$1, updated_at=$2 WHERE repair_no=$3", [JSON.stringify(lst), new Date().toISOString().slice(0, 19).replace("T", " "), String(req.params.no)]);
    return ok(res, await getDetail(String(req.params.no)), "已添加照片");
  });

  // ── 维修统计 ──
  router.get("/repair/stats", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const days = Number(req.query.days || 14);
    return ok(res, { stats: {} });
  });
}
