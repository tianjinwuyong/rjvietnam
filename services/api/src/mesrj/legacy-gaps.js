// ============================================================================
// MES legacy 尾差补齐（源 D:\rj\repos\MES-ruijing\api\*.py）
//
// 与 /mesrj 其余路由同进程同信封（{success,msg,data}），只补「旧前端/旧设备脚本
// 会用、而 SMT 里还没有等价路径」的那几条，能复用现有核心的一律复用：
//   · 整版过站 /exec/pass_panel        → domain.doPassInner（逐块走全部防错）
//   · 批量发码 /exec/sn/batch (POST)   → domain.snAlloc（含 SN 规则校验）
//   · 解码别名 /decode (POST)          → bind.decode
//   · 基准配置 /smt/baseline/config POST → smt-core.baselineConfig
//   · 老化 / 物料追溯导出             → domain.agingDetail / traceMaterialByMaterial + XLSX
//
// 其余按原实现直接落 SQL：
//   /bom/:bomId/items GET|POST、/bom/item/:id DELETE（源 erp.py 的 erp_bom_item
//   在 SMT 是 bom_header + bom_item 两表按 product_code/version 关联）
//   /aoi/compname、/iqc/summary、/report/yield、/unbind、/push/config、/order/po
//
// 注册位置：createMesrjRouter() 末尾（router 已挂全部中间件与权限工具）
// ============================================================================
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export function registerMesrjLegacyGaps(router, deps) {
  const {
    query, ok, fail, perm, anyPerm, doPassInner, snAlloc, snRuleOk,
    agingDetail, traceMaterialByMaterial, bindMod, smtCore, panelSns, moMaterials,
  } = deps;

  const str = (v) => String(v ?? "").trim();
  const numv = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  // 本地日期（biz_date / pass_time 都是产线本地时间，用 UTC 会在跨日窗口漏数据）
  const pad = (n) => String(n).padStart(2, "0");
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const nowLocal = () => {
    const d = new Date();
    return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // ── BOM 明细（源 /bom/<id>/items）────────────────────────────────────────
  // SMT 的 BOM 明细按 product_code + version 归属，bom_header.id 只是版本行号。
  const bomScope = async (bomId) => {
    const h = (await query(
      `SELECT id, product_code, version FROM bom_header WHERE id=$1`, [Number(bomId) || 0]
    )).rows[0];
    return h || null;
  };

  router.get("/bom/:bomId/items", async (req, res) => {
    const h = await bomScope(req.params.bomId);
    if (!h) return fail(res, `BOM 不存在：${req.params.bomId}`);
    const rows = (await query(
      `SELECT id, product_code, version, seq_no, material_code, material_name, spec, unit,
              qty_per AS qty, segment AS station, is_alt, alt_group, mpq, loss_rate, remark
         FROM bom_item WHERE product_code=$1 AND version=$2
        ORDER BY seq_no, material_code`, [h.product_code, h.version])).rows;
    return ok(res, { items: rows, rows });
  });

  router.post("/bom/:bomId/items", perm("md.edit"), async (req, res) => {
    const h = await bomScope(req.params.bomId);
    if (!h) return fail(res, `BOM 不存在：${req.params.bomId}`);
    const d = req.body || {};
    const materialCode = str(d.material_code || d.materialCode);
    if (!materialCode) return fail(res, "请填物料编码");
    const seq = (await query(
      `SELECT COALESCE(MAX(seq_no),0)+1 AS n FROM bom_item WHERE product_code=$1 AND version=$2`,
      [h.product_code, h.version])).rows[0].n;
    const row = (await query(
      `INSERT INTO bom_item (product_code, version, seq_no, material_code, material_name, spec,
                             unit, qty_per, segment, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [h.product_code, h.version, seq, materialCode, str(d.material_name || d.materialName),
       str(d.spec), str(d.unit) || "PCS", numv(d.qty ?? d.qty_per, 1),
       str(d.station || d.segment), str(d.remark)])).rows[0];
    return ok(res, row, "已添加");
  });

  router.delete("/bom/item/:id", perm("md.edit"), async (req, res) => {
    const id = numv(req.params.id, -1);
    const r = (await query(`DELETE FROM bom_item WHERE id=$1 RETURNING id`, [id])).rows[0];
    if (!r) return fail(res, "明细不存在");
    return ok(res, null, "已删除");
  });

  // ── AOI 位号映射：设备内部编号 → 真实位号（源 /aoi/compname）──────────────
  router.get("/aoi/compname", async (req, res) => {
    const model = str(req.query.model);
    const rows = (await query(
      `SELECT comp_id, designator FROM cfg_aoi_comp_map WHERE model=$1 ORDER BY comp_id`, [model])).rows;
    const map = {};
    for (const r of rows) map[r.comp_id] = r.designator;
    return ok(res, { model, map });
  });

  // ── IQC 看板统计（源 /iqc/summary；SMT 有 erp_inventory 镜像，口径照抄）────
  router.get("/iqc/summary", async (_req, res) => {
    const one = async (sql) => Number((await query(sql)).rows[0]?.n || 0);
    const total = await one(`SELECT COUNT(*)::int AS n FROM erp_inventory`);
    const good = await one(`SELECT COUNT(*)::int AS n FROM erp_inventory WHERE stock_status='good'`);
    const locked = await one(`SELECT COUNT(*)::int AS n FROM erp_inventory WHERE locked=true`);
    const pending = await one(`SELECT COUNT(*)::int AS n FROM erp_inventory WHERE stock_status='pending_qc'`);
    const bad = await one(
      `SELECT COUNT(*)::int AS n FROM erp_inventory WHERE stock_status NOT IN ('good','pending_qc') OR stock_status IS NULL`);
    const byMaterial = (await query(
      `SELECT material_code, MAX(material_name) AS material_name, MAX(unit) AS unit,
              SUM(CASE WHEN stock_status='good' THEN qty ELSE 0 END) AS good_qty,
              SUM(CASE WHEN stock_status='pending_qc' THEN qty ELSE 0 END) AS pending_qty,
              SUM(CASE WHEN stock_status NOT IN ('good','pending_qc') OR stock_status IS NULL THEN qty ELSE 0 END) AS bad_qty,
              SUM(qty) AS total_qty, COUNT(*)::int AS lot_count
         FROM erp_inventory GROUP BY material_code ORDER BY total_qty DESC NULLS LAST LIMIT 500`)).rows;
    return ok(res, {
      total_lot: total, good_lot: good, bad_lot: bad, pending_lot: pending, locked_lot: locked,
      lot_rate: total ? Math.round((good * 10000) / total) / 100 : 0,
      by_material: byMaterial,
    });
  });

  // ── 良率报表（源 /report/yield：优先旧 MES 同步的真实产量）─────────────────
  router.get("/report/yield", async (req, res) => {
    const start = str(req.query.start) || `${today()} 00:00:00`;
    const end = str(req.query.end) || nowLocal();
    const mo = str(req.query.mo);
    const model = str(req.query.model);

    const om = (await query(
      `SELECT group_code, MAX(group_name) AS group_name, MAX(product_step) AS product_step,
              SUM(input_qty) AS inq, SUM(failure1) AS f1, SUM(failure2) AS f2,
              SUM(true_fail) AS tf, SUM(pass_qty) AS pq
         FROM prd_oldmes_yield
        WHERE biz_date::date >= $1::date AND biz_date::date <= $2::date
          AND time_from='00:00' AND time_to='23:59'
        GROUP BY group_code
        ORDER BY MIN(route_order) NULLS LAST, MIN(flow_order) NULLS LAST`,
      [start.slice(0, 10), end.slice(0, 10)])).rows;
    if (om.length) {
      const rows = om.map((r) => {
        const inq = numv(r.inq), pq = numv(r.pq), tf = numv(r.tf);
        return {
          group_code: r.group_code, group_name: r.group_name, product_step: r.product_step,
          input_qty: inq, failure1: numv(r.f1), failure2: numv(r.f2), true_fail: tf,
          pass_qty: pq, dppm: inq ? Math.round((tf * 1e6) / inq) : 0,
          pass_yield: inq ? Math.round((pq * 10000) / inq) / 100 : 0,
        };
      });
      return ok(res, { source: "oldmes", start, end, mo, model, rows });
    }

    // 回退：本系统过站数据（同口径：input=过站数，pass=OK 数）
    const r = (await query(
      `SELECT p.station_code, COUNT(*)::int AS input_qty,
              COUNT(*) FILTER (WHERE p.result='OK')::int AS pass_qty
         FROM prd_pass p
        WHERE p.pass_time >= $1::timestamptz AND p.pass_time <= $2::timestamptz
          AND ($3 = '' OR p.mo_no = $3)
        GROUP BY p.station_code ORDER BY p.station_code`,
      [start, end, mo])).rows;
    return ok(res, {
      source: "prd_pass", start, end, mo, model,
      rows: r.map((x) => ({
        station_code: x.station_code, input_qty: x.input_qty, pass_qty: x.pass_qty,
        pass_yield: x.input_qty ? Math.round((x.pass_qty * 10000) / x.input_qty) / 100 : 0,
      })),
    });
  });

  // ── 老化数据导出（源 /exec/aging/export）─────────────────────────────────
  router.get("/exec/aging/export", anyPerm("prod.trace", "prod.view", "admin"), async (req, res) => {
    try {
      const rows = await agingDetail({
        station_code: str(req.query.station_code),
      });
      if (!rows.length) return fail(res, "没有符合条件的在制 SN");
      const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
        SN: r.sn, 机型: r.product_code || "", 工单: r.mo_no || "", 当前工位: r.cur_station || "",
        状态: r.status, 停留小时: Number(r.hours || 0), 建档时间: r.created_at,
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "在制老化");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="aging_${Date.now()}.xlsx"`);
      return res.send(buf);
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── 物料追溯导出（源 /exec/trace/material/export）────────────────────────
  router.get("/exec/trace/material/export", anyPerm("prod.trace", "admin"), async (req, res) => {
    try {
      const materialCode = str(req.query.material_code || req.query.material);
      if (!materialCode) return fail(res, "缺少 material_code");
      const d = await traceMaterialByMaterial({ material_code: materialCode });
      const rows = Array.isArray(d) ? d : (d.rows || d.sns || []);
      if (!rows.length) return fail(res, "没有匹配的上料记录，无需导出");
      const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
        物料编码: materialCode, SN: r.sn || "", 工单: r.mo_no || "",
        当前工位: r.cur_station || "", 状态: r.status || "",
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "物料追溯");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition",
        `attachment; filename="trace_${materialCode}_${Date.now()}.xlsx"`);
      return res.send(buf);
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── 整版过站（源 /exec/pass_panel）：逐块走 doPassInner 全部防错 ──────────
  router.post("/exec/pass_panel", perm("prod.pass"), async (req, res) => {
    const d = req.body || {};
    const sn = str(d.sn);
    const station = str(d.station_code || d.station);
    if (!sn || !station) return fail(res, "请先扫一块板并选工位");
    const result = (str(d.result) || "OK").toUpperCase();

    const snRow = (await query(`SELECT * FROM prd_sn WHERE sn=$1`, [sn])).rows[0];
    const moNo = str(d.mo_no) || snRow?.mo_no || "";
    const productCode = snRow?.product_code || "";
    const layout = (await query(
      `SELECT rows, cols, total, serpentine, seq_offset FROM cfg_panel_layout
        WHERE enabled=1 AND product_code=$1 ORDER BY id DESC LIMIT 1`, [productCode])).rows[0];
    if (!layout) return fail(res, `机型 ${productCode || "(未知)"} 没有启用的拼版布局，无法推算整版`);

    const siblings = panelSns(sn, layout);
    if (!siblings.length) return fail(res, "按拼版布局推不出整版 SN（SN 格式不符规则）");

    const results = [];
    for (const s of siblings) {
      const r = await doPassInner({
        ...d, sn: s.sn, station_code: station, mo_no: moNo, result,
        panel_pos: s.panel_pos,
      }, req.mesrjUser, req.ip || "");
      results.push({ sn: s.sn, panel_pos: s.panel_pos, ok: !!r.ok, msg: r.msg || "" });
    }
    const okCount = results.filter((x) => x.ok).length;
    return ok(res, { panel: siblings.length, ok: okCount, ng: results.length - okCount, results },
      `整版 ${siblings.length} 块：过站 ${okCount}，拦截 ${results.length - okCount}`);
  });

  // ── 按工单批量发码（源 /exec/sn/batch POST）──────────────────────────────
  router.post("/exec/sn/batch", perm("prod.pass"), async (req, res) => {
    const d = req.body || {};
    const moNo = str(d.mo_no);
    const snType = str(d.sn_type) || "PCBA";
    const qty = numv(d.qty, 0);
    if (!moNo) return fail(res, "请选择工单");
    if (qty <= 0) return fail(res, "发码数量必须大于 0");
    if (qty > 500) return fail(res, "一次最多发 500 个，多了请分批（避免一个请求卡太久）");
    const mo = (await query(`SELECT mo_no, product_code, status, line_code FROM ord_mo WHERE mo_no=$1`, [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    if (["已完工", "已关闭"].includes(str(mo.status))) return fail(res, `工单 ${moNo} 已${mo.status}，不能再发码`);
    const [ruleOk, ruleMsg] = await snRuleOk(snType);
    if (!ruleOk) return fail(res, ruleMsg);

    const sns = [];
    for (let i = 0; i < qty; i++) {
      const [sn, err] = await snAlloc(snType, {
        mo_no: moNo, product_code: str(mo.product_code), line_code: str(mo.line_code), status: "已发放",
      });
      if (!sn) return fail(res, `第 ${i + 1} 个发码失败：${err}`);
      sns.push(sn);
    }
    return ok(res, { mo_no: moNo, sn_type: snType, qty: sns.length, sns }, `已发码 ${sns.length} 个`);
  });

  // ── 解码（旧设备脚本用 /decode，等价 /mesrj/bind/decode）──────────────────
  router.post("/decode", perm("prod.bind"), async (req, res) => {
    const r = await bindMod.decode(req.body || {}, req.mesrjUser, req.ip);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.data, r.msg);
  });

  // ── 解绑（源 /unbind）：必须填原因，作废绑定关系 ────────────────────────
  router.post("/unbind", perm("prod.bind"), async (req, res) => {
    const d = req.body || {};
    const reason = str(d.reason);
    if (!reason) return fail(res, "解绑必须填原因");
    const byId = d.id ? numv(d.id, -1) : null;
    const row = byId
      ? (await query(`SELECT * FROM prd_sn_rel WHERE id=$1`, [byId])).rows[0]
      : (await query(
          `SELECT * FROM prd_sn_rel WHERE rel_type=$1 AND is_active<>0 AND parent_sn=$2 AND child_sn=$3
            ORDER BY id DESC LIMIT 1`,
          [str(d.rel_type), str(d.old_sn || d.parent_sn), str(d.new_sn || d.child_sn)])).rows[0];
    if (!row) return fail(res, "找不到这条绑定记录");
    if (!Number(row.is_active)) return fail(res, "该绑定已解除");
    await query(
      `UPDATE prd_sn_rel SET is_active=0, reason=COALESCE(reason,'') || $2,
              void_at=now(), void_by=$3 WHERE id=$1`,
      [row.id, reason, req.mesrjUser?.login_name || ""]);
    return ok(res, { id: row.id, parent_sn: row.parent_sn, child_sn: row.child_sn }, "已解绑");
  });

  // ── WMS 工单推送配置（源 /push/config）：sys_param 三键 ──────────────────
  router.post("/push/config", perm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const put = async (key, val, name, group) => {
      await query(
        `INSERT INTO sys_param (param_key, param_val, param_name, group_name, updated_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (param_key) DO UPDATE
            SET param_val=EXCLUDED.param_val, param_name=EXCLUDED.param_name,
                group_name=EXCLUDED.group_name, updated_at=now()`,
        [key, String(val ?? ""), name, group]);
    };
    if (d.url !== undefined) await put("wms.mo_push_url", str(d.url), "MES 推送工单到 WMS 的地址", "WMS");
    if (d.key !== undefined) await put("wms.mo_push_key", str(d.key), "推送到 WMS 用的 X-Api-Key", "WMS");
    if (d.enabled !== undefined) {
      await put("wms.mo_push_enabled", ["1", "true", "on"].includes(str(d.enabled).toLowerCase()) ? "1" : "0",
        "是否启用自动推送工单", "WMS");
    }
    const cfg = (await query(
      `SELECT param_key, param_val FROM sys_param
        WHERE param_key IN ('wms.mo_push_url','wms.mo_push_key','wms.mo_push_enabled')`)).rows;
    const m = Object.fromEntries(cfg.map((r) => [r.param_key, r.param_val]));
    return ok(res, {
      url: m["wms.mo_push_url"] || "", key: m["wms.mo_push_key"] || "",
      enabled: (m["wms.mo_push_enabled"] || "0") === "1",
    }, "推送配置已保存");
  });

  // ── SMT 上料基准配置（源 /smt/baseline/config POST）──────────────────────
  router.post("/smt/baseline/config", perm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const enabled = d.enabled === undefined
      ? undefined
      : ["1", "true", "on"].includes(str(d.enabled).toLowerCase());
    let lockHits = d.lock_hits;
    if (lockHits !== undefined && str(lockHits) !== "") {
      lockHits = numv(lockHits, NaN);
      if (!Number.isFinite(lockHits)) return fail(res, "固化次数必须是数字");
      lockHits = Math.max(Math.trunc(lockHits), 1);
    } else {
      lockHits = undefined;
    }
    // 落地 sys_param（全厂生效、重启不丢），再同步 smt-core 的内存 PARAMS
    const put = async (key, val, name) => {
      await query(
        `INSERT INTO sys_param (param_key, param_val, param_name, group_name, updated_at)
         VALUES ($1,$2,$3,'SMT',now())
         ON CONFLICT (param_key) DO UPDATE
            SET param_val=EXCLUDED.param_val, param_name=EXCLUDED.param_name, updated_at=now()`,
        [key, String(val), name]);
    };
    if (enabled !== undefined) await put("smt.baseline_enabled", enabled ? "1" : "0", "上料基准学习开关（1=学习并自动带出）");
    if (lockHits !== undefined) await put("smt.baseline_lock_hits", String(lockHits), "同一位置累计几次后自动固化（转强制校验）");
    await smtCore.baselineConfig({ enabled, lockHits });
    const stats = await smtCore.baselineStats();
    return ok(res, stats, "设置已保存");
  });

  // ── 工单推送 WMS（源 api/wmsmo.py：/mo/<no>/push、/mo/push-all、/mo/list）─────
  // 推送状态记在 itf_api_log（sn=工单号，api_path='wms.mo.upsert'），不新造表。
  const PUSH_PATH = "wms.mo.upsert";
  const pushCfg = async () => {
    const rows = (await query(
      `SELECT param_key, param_val FROM sys_param
        WHERE param_key IN ('wms.mo_push_url','wms.mo_push_key','wms.mo_push_enabled')`)).rows;
    const m = Object.fromEntries(rows.map((r) => [r.param_key, r.param_val]));
    return {
      url: str(m["wms.mo_push_url"]),
      key: str(m["wms.mo_push_key"]),
      enabled: (m["wms.mo_push_enabled"] || "0") === "1",
    };
  };

  const buildMoPayload = async (moNo) => {
    const mo = (await query(
      `SELECT mo_no, product_code, fg_code, po_no, po_line, cust_code, plan_qty, line_code,
              status, process_code, plan_start, plan_end, actual_start, actual_end, remark
         FROM ord_mo WHERE mo_no=$1`, [moNo])).rows[0];
    if (!mo) return [null, `工单不存在：${moNo}`];
    const materials = await moMaterials({ mo_no: moNo });
    return [{
      event: "mo.upsert",
      sentAt: nowLocal(),
      data: {
        moNo: mo.mo_no, productCode: mo.product_code, fgCode: mo.fg_code || "",
        poNo: mo.po_no || "", poLine: mo.po_line || "", custCode: mo.cust_code || "",
        planQty: numv(mo.plan_qty), lineCode: mo.line_code || "", status: mo.status || "",
        processCode: mo.process_code || "", planStart: mo.plan_start, planEnd: mo.plan_end,
        actualStart: mo.actual_start, actualEnd: mo.actual_end, remark: mo.remark || "",
        materials: materials.map((x) => ({
          materialCode: x.material_code, materialName: x.material_name || "",
          spec: x.spec || "", unit: x.unit || "", qty: numv(x.qty),
          segment: x.segment || "", itemType: x.item_type || "", lineSeq: x.line_seq,
        })),
        materialCount: materials.length,
      },
    }, ""];
  };

  const doPush = async (moNo, force = false) => {
    const cfg = await pushCfg();
    if (!cfg.url) return [false, "未配置 wms.mo_push_url（页面：订单管理 → 工单下发 WMS → 推送设置）"];
    const [payload, err] = await buildMoPayload(moNo);
    if (err) return [false, err];
    // buildMoPayload returns [null, reason] on failure, so `err` already covers it
    // at runtime; the tuple carries no correlation, so narrowing here is what lets
    // the compiler read payload.data below.
    if (!payload || typeof payload === "string") return [false, err || "工单数据为空"];
    const raw = JSON.stringify(payload);
    const h = createHash("sha1").update(raw).digest("hex").slice(0, 16);
    const prev = (await query(
      `SELECT req_body FROM itf_api_log WHERE api_path=$1 AND sn=$2 AND success=1
        ORDER BY id DESC LIMIT 1`, [PUSH_PATH, moNo])).rows[0];
    if (prev && !force) {
      const prevHash = createHash("sha1").update(String(prev.req_body || "")).digest("hex").slice(0, 16);
      if (prevHash === h) return [true, "内容未变化，跳过（上次已推成功）"];
    }
    const body = JSON.stringify({ code: 0, message: "mo.upsert", requestId: h, data: payload });
    const t0 = Date.now();
    let httpStatus = 0, respText = "", okFlag = false, msg = "";
    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8",
          ...(cfg.key ? { "X-Api-Key": cfg.key } : {}) },
        body, signal: AbortSignal.timeout(15000),
      });
      httpStatus = res.status;
      respText = (await res.text()).slice(0, 500);
      let parsed = {};
      try { parsed = JSON.parse(respText); } catch { parsed = {}; }
      if (res.ok && (parsed.code === undefined || parsed.code === 0)) {
        okFlag = true;
        msg = `推送成功（${payload.data.materialCount} 条用料）`;
      } else {
        msg = `WMS 返回 code=${parsed.code ?? ""} ${parsed.message ?? respText.slice(0, 120)}`;
      }
    } catch (ex) {
      msg = `${ex.name || "Error"}: ${String(ex.message || ex).slice(0, 160)}`;
    }
    await query(
      `INSERT INTO itf_api_log (direction, api_path, method, req_body, resp_body, http_status,
                                success, cost_ms, sn, created_at)
       VALUES ('out',$1,'POST',$2,$3,$4,$5,$6,$7,now())`,
      [PUSH_PATH, raw, respText, httpStatus, okFlag ? 1 : 0, Date.now() - t0, moNo]).catch(() => {});
    return [okFlag, msg];
  };

  router.post("/mo/:moNo/push", perm("prod.trace"), async (req, res) => {
    const moNo = str(req.params.moNo);
    const force = ["1", "true", "on"].includes(str(req.body?.force).toLowerCase());
    const [pushed, msg] = await doPush(moNo, force);
    if (!pushed) return fail(res, msg);
    return ok(res, null, msg);
  });

  router.post("/mo/push-all", perm("prod.trace"), async (req, res) => {
    const limit = Math.min(Math.max(numv(req.body?.limit, 50), 1), 500);
    const mos = (await query(
      `SELECT mo_no FROM ord_mo
        WHERE COALESCE(status,'') NOT IN ('已完工','已关闭','取消','已取消')
        ORDER BY mo_no DESC LIMIT $1`, [limit])).rows;
    let okN = 0, failN = 0;
    const detail = [];
    for (const m of mos) {
      const [pushed, msg] = await doPush(m.mo_no, false);
      if (pushed) okN++; else { failN++; detail.push({ mo_no: m.mo_no, msg }); }
    }
    let msg = `推送完成：成功 ${okN}，失败 ${failN}`;
    if (failN && detail.length) msg += `；首条失败原因：${detail[0].msg}`;
    return ok(res, { ok: okN, fail: failN, detail: detail.slice(0, 20) }, msg);
  });

  // 工单列表（带推送状态，源 /mo/list）
  router.get("/mo/list", async (req, res) => {
    const page = Math.max(1, numv(req.query.page, 1));
    const size = Math.min(200, Math.max(1, numv(req.query.size, 50)));
    const args = [];
    const where = [];
    const since = str(req.query.since);
    if (since) { args.push(since); where.push(`updated_at >= $${args.length}::timestamptz`); }
    const line = str(req.query.line);
    if (line) { args.push(line); where.push(`line_code = $${args.length}`); }
    const po = str(req.query.po);
    if (po) { args.push(po); where.push(`po_no = $${args.length}`); }
    const status = str(req.query.status);
    if (status) { args.push(status); where.push(`status = $${args.length}`); }
    if (["1", "true", "on"].includes(str(req.query.open || "1").toLowerCase())) {
      where.push(`COALESCE(status,'') NOT IN ('已完工','已关闭','取消','已取消')`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number((await query(`SELECT COUNT(*)::int AS n FROM ord_mo ${clause}`, args)).rows[0]?.n || 0);
    const items = (await query(
      `SELECT mo_no, product_code, fg_code, po_no, plan_qty, line_code, status,
              plan_start, plan_end, actual_start, actual_end, updated_at
         FROM ord_mo ${clause} ORDER BY mo_no DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, (page - 1) * size])).rows;
    const states = (await query(
      `SELECT DISTINCT ON (sn) sn, created_at, success, resp_body
         FROM itf_api_log WHERE api_path=$1 AND sn IS NOT NULL
        ORDER BY sn, id DESC`, [PUSH_PATH])).rows;
    const pushMap = new Map(states.map((x) => [x.sn, {
      at: x.created_at, ok: Number(x.success), msg: String(x.resp_body || "").slice(0, 200),
    }]));
    return ok(res, {
      items: items.map((x) => ({ ...x, push: pushMap.get(x.mo_no) || null })),
      total, page, size,
    });
  });

  // ── 采购订单选项（MO 创建页数据源；源系统由 _crud_routes 生成 /po/list）──
  router.get("/order/po", async (req, res) => {
    const page = Math.max(1, numv(req.query.page, 1));
    const size = Math.min(500, Math.max(1, numv(req.query.size, 100)));
    const args = [];
    const where = [];
    const kw = str(req.query.keyword || req.query.q);
    if (kw) { args.push(`%${kw}%`); where.push(`(po_no ILIKE $${args.length} OR product_code ILIKE $${args.length})`); }
    const st = str(req.query.status);
    if (st) { args.push(st); where.push(`status = $${args.length}`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number((await query(
      `SELECT COUNT(*)::int AS n FROM ord_po ${clause}`, args)).rows[0]?.n || 0);
    const rows = (await query(
      `SELECT id, po_no, po_line, cust_code, product_code, order_qty, delivery_date, status,
              oqc_status, release_locked, remark, created_at
         FROM ord_po ${clause}
        ORDER BY delivery_date NULLS LAST, po_no LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, (page - 1) * size])).rows;
    return ok(res, { rows, total, page, size });
  });
}
