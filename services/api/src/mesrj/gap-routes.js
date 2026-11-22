// ============================================================================
// ruijing-mes → mesrj 残余缺口嫁接（源 b374884，实跑 rjms:8088）
//   标准：docs/grafting-standards.md（七步/§4 信封分层/§5 方言映射）
//         docs/integration/grafting-protocol.md（§1 裁决：同 MES 两版本 → 补齐嫁接）
//   认领：.factory/locks/CLAIM-mesrj-ruijing-mes-gap-api.md
//   契约：.factory/mailbox/OUTBOX-mesrj-gap-graft-proposal.md
//
//   对账结论（.factory/mes-graft-census.json）：源 499 条路由，折叠改名等价后 489 条已在
//   mesrj 落地；本文件补最后 10 条真缺口。数据层无迁移——10 条端点读的表/列全部已在
//   live DB 核实存在（台账教训：查库不查 ls migrations）。
//
//   两个导出：
//     registerMesrjGapRoutes  —— JWT 之后，mesrj 域信封 {success,msg,data} + requireMesrjPerm
//     registerDeviceGapRoutes —— X-Api-Key，JWT 之前，源逐字契约（PascalCase / verdict）
// ============================================================================
import { keyOk } from "./device-key.js";
import { enqueue } from "./ultra.js";
import * as smtCore from "./smt-core.js";

const normU = (v) => String(v || "").trim().toUpperCase();
const KEY_RE = /[^0-9A-Z]+/g;
const key = (v) => String(v || "").toUpperCase().replace(KEY_RE, "");

// 超声扫码设备接口常量（源 devcfg_fix.py；与 ultra.js 内 STATION/ATE1 同值）
const ULTRA_STATION = "ASSY-L01-ULTRASONIC";
const ATE1_STATION = "ASSY-L01-ATE1";

// 工位看板默认五类主力工位（源 analyze.py DEFAULT_STATIONS）
const DEFAULT_STATIONS = ["DIP-L02-ICT", "DIP-L02-FCT", "ASSY-L02-ATE", "ASSY-L02-AGING", "PACK-L02-HIPOT"];

// ── 越南裸串日期（PG timestamptz → +07:00 日期）；出口口径见 §6 ──
const VN_DATE = "to_char(pass_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')";

// ════════════════════════════════════════════════════════════════════════════
// 共享 helper（纯逻辑，可单测）
// ═══════════════════════════════════════════════════════════════════════════

/** 工单 → 机型（软回退，源 smt.py _mo_model_soft：feeder_model → fg_code→product_model → ''） */
async function moModelSoft(query, mo) {
  if (!mo) return "";
  const fm = String(mo.feeder_model || "").trim();
  if (fm) return fm;
  const fg = String(mo.fg_code || "").trim();
  if (fg) {
    const r = (await query("SELECT product_model FROM md_product WHERE product_code=$1", [fg])).rows[0];
    return String(r?.product_model || "").trim();
  }
  return "";
}

/** 工单 → 成品机型号（源 _mo_product_model） */
async function moProductModel(query, mo) {
  if (!mo) return "";
  const fg = String(mo.fg_code || mo.product_code || "").trim();
  if (!fg) return "";
  const r = (await query("SELECT product_model FROM md_product WHERE product_code=$1", [fg])).rows[0];
  return String(r?.product_model || "").trim();
}

/** 站位表里属于某机型的所有「板别」（源 _variants_of_model：相等 → 包含 两级匹配） */
async function variantsOfModel(query, pm) {
  if (!pm) return [];
  const all = (await query("SELECT DISTINCT model FROM md_feeder_slot WHERE COALESCE(model,'')<>'' ORDER BY model")).rows.map(r => r.model);
  const mu = key(pm);
  if (!mu) return [];
  let vs = all.filter(m => key(m) === mu);
  if (!vs.length) vs = all.filter(m => key(m).includes(mu) || mu.includes(key(m)));
  return vs;
}

/** 上料 BOM 校验（源 _bom_check：成品 → 半成品 SFG 递归展开；level ok/alt/block） */
async function bomCheck(query, mo, rj) {
  if (String(await smtCore.smtParam("smt.bom_check", "1")) !== "1") return { level: "ok" };
  const pc = String(mo?.product_code || "").trim();
  if (!mo || !pc) return { level: "ok" };
  if ((await query("SELECT 1 FROM bom_item WHERE product_code=$1 AND UPPER(material_code)=UPPER($2) AND is_alt=0 LIMIT 1", [pc, rj])).rows.length)
    return { level: "ok" };
  if ((await query("SELECT 1 FROM bom_item WHERE product_code=$1 AND UPPER(material_code)=UPPER($2) AND is_alt=1 LIMIT 1", [pc, rj])).rows.length)
    return { level: "alt" };
  const sub = (await query(`WITH RECURSIVE sub(code) AS (
      SELECT b.material_code FROM bom_item b WHERE b.product_code=$1 AND COALESCE(b.item_type,'')='SFG'
      UNION
      SELECT b2.material_code FROM bom_item b2 JOIN sub s ON b2.product_code=s.code WHERE COALESCE(b2.item_type,'')='SFG')
    SELECT b3.is_alt FROM bom_item b3 JOIN sub s2 ON b3.product_code=s2.code WHERE UPPER(b3.material_code)=UPPER($2) LIMIT 1`, [pc, rj])).rows[0];
  if (sub) return { level: Number(sub.is_alt || 0) === 1 ? "alt" : "ok" };
  return { level: "block" };
}

/** 这颗料该装哪些站位（源 feeder_slot.slots_of_material：替代料表 join + 主表兜底 + 机型两级匹配） */
async function slotsOfMaterial(query, scanned, model, vn) {
  const su = normU(scanned), vu = normU(vn);
  if (!su && !vu) return [];
  const ids = new Set(), rows = [];
  const c1 = [], a1 = [];
  if (su) c1.push(`UPPER(a.material_code)=$${a1.push(su)}`);
  if (vu) c1.push(`UPPER(a.vn_code)=$${a1.push(vu)}`);
  if (c1.length) {
    for (const r of (await query(`SELECT s.* FROM md_feeder_slot s JOIN md_feeder_slot_alt a ON a.slot_id=s.id WHERE ${c1.join(" OR ")}`, a1)).rows)
      if (!ids.has(r.id)) { ids.add(r.id); rows.push(r); }
  }
  const c2 = [], a2 = [];
  if (su) c2.push(`UPPER(material_code)=$${a2.push(su)}`);
  if (vu) c2.push(`UPPER(vn_code)=$${a2.push(vu)}`);
  if (c2.length) {
    for (const r of (await query(`SELECT * FROM md_feeder_slot WHERE ${c2.join(" OR ")}`, a2)).rows)
      if (!ids.has(r.id)) { ids.add(r.id); rows.push(r); }
  }
  if (model) {
    const mu = key(model);
    let exact = rows.filter(r => key(r.model) === mu);
    if (!exact.length) exact = rows.filter(r => key(r.model).includes(mu) || mu.includes(key(r.model)));
    if (exact.length) { rows.length = 0; rows.push(...exact); }
  }
  rows.sort((x, y) => key(x.model).localeCompare(key(y.model)) || String(x.machine_no || "").localeCompare(String(y.machine_no || "")) || String(x.slot_no || "").localeCompare(String(y.slot_no || "")));
  return rows.slice(0, 30);
}

/** 多阶 BOM 递归展开成真料清单（源 plan.py _expand_bom_items：SFG 段节点连乘用量、不进结果） */
async function expandBomItems(query, pc, seen = null, depth = 0) {
  seen = seen || new Set();
  if (seen.has(pc) || depth > 6) return [];
  seen.add(pc);
  const out = [];
  let rows = [];
  try {
    rows = (await query(`SELECT material_code, COALESCE(material_name,'') nm, COALESCE(spec,'') spec,
            COALESCE(qty_per,0) qty_per, COALESCE(item_type,'RM') it, COALESCE(alt_group,'') alt_group,
            COALESCE(is_alt,0) is_alt, COALESCE(pos_ref,'') pos
            FROM bom_item WHERE product_code=$1 ORDER BY seq_no`, [pc])).rows;
  } catch { return []; }
  for (const r of rows) {
    const q = Number(r.qty_per || 0);
    if (String(r.it || "RM").toUpperCase() === "SFG") {
      for (const s of await expandBomItems(query, r.material_code, seen, depth + 1)) {
        const c = { ...s, qty_per: s.qty_per * q };
        if (r.nm) c.via = (c.via || "") + r.nm + ">";
        out.push(c);
      }
    } else {
      out.push({ ...r, qty_per: q, via: "" });
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// JWT 侧（mesrj 域信封）
// ════════════════════════════════════════════════════════════════════════════

export function registerMesrjGapRoutes(router, { query, ok, fail, perm: requireMesrjPerm, anyPerm: requireAnyPerm }) {
  const who = (req) => String(req.mesrjUser?.login_name || "");

  // ── 源 smt.py mo_variants：这张工单可选的生产板别（PCB1/PCB2…）──
  router.get("/smt/mo_variants", requireMesrjPerm(null), async (req, res) => {
    try {
      const mo_no = String(req.query.mo_no || "").trim();
      const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [mo_no])).rows[0];
      if (!mo) return fail(res, `工单不存在：${mo_no}`);
      const pm = await moProductModel(query, mo);
      const variants = await variantsOfModel(query, pm);
      return ok(res, { mo_no, product_model: pm, variants, current: String(mo.feeder_model || "").trim() });
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── 源 smt.py mo_variant：记住这张工单在做哪一面（写 ord_mo.feeder_model）──
  router.post("/smt/mo_variant", requireMesrjPerm("md.edit"), async (req, res) => {
    try {
      const d = req.body || {};
      const mo_no = String(d.mo_no || "").trim();
      const model = String(d.model || "").trim();
      const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [mo_no])).rows[0];
      if (!mo) return fail(res, `工单不存在：${mo_no}`);
      const vs = await variantsOfModel(query, await moProductModel(query, mo));
      if (model && vs.length && !vs.includes(model))
        return fail(res, `「${model}」不是工单 ${mo_no} 的可选板别（可选：${vs.join("、")}）`);
      const old = String(mo.feeder_model || "").trim();
      await query("UPDATE ord_mo SET feeder_model=$1, updated_at=now() WHERE mo_no=$2", [model, mo_no]);
      await smtCore.audit(who(req), "生产执行", "设置生产板别", mo_no, `${old || "(空)"} → ${model || "(空)"}`, req.ip);
      return ok(res, { mo_no, model }, `已设为 ${model || "（自动：按料号判断）"}`);
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── 源 smt.py load_recommend：扫料盘 → 候选站位（机型非前置；替代料校准；基准兜底）──
  router.post("/smt/load_recommend", requireMesrjPerm("md.edit"), async (req, res) => {
    try {
      await smtCore.ensureSchema();
      const d = req.body || {};
      const mo_no = String(d.mo_no || "").trim();
      const code = String(d.material_code || "").trim();
      if (!mo_no || !code) return ok(res, { success: false, msg: "请先选工单并扫料盘条码" });
      const reel = smtCore.parseReel(code);
      const rj = (reel.rj || reel.materialCode || "").trim();
      const dt = "";   // 源 reel 11-10 起不再产 dt；留空不影响主流程
      if (!rj) return ok(res, { success: false, msg: "扫不出料号，请检查料盘条码" });
      const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [mo_no])).rows[0];
      const model = String(d.model || "").trim() || await moModelSoft(query, mo);
      const line_code = String(mo?.line_code || "").trim();

      const b = await bomCheck(query, mo, rj);
      const bom_note = b.level === "alt" ? "（⚠ 替代料，请品质确认）" : b.level === "block" ? "（⚠ 不在本工单 BOM 中，仅记录）" : "";

      // 替代料自动校准：扫到替代料 → 找同组主料
      let alt_info = null, pc0 = String(mo?.product_code || "").trim();
      if (pc0) {
        const me = (await query("SELECT * FROM bom_item WHERE product_code=$1 AND UPPER(material_code)=UPPER($2) AND is_alt=1 AND COALESCE(alt_group,'')<>'' LIMIT 1", [pc0, rj])).rows[0];
        if (me && me.alt_group) {
          const main = (await query("SELECT * FROM bom_item WHERE product_code=$1 AND alt_group=$2 AND is_alt=0 LIMIT 1", [pc0, me.alt_group])).rows[0];
          if (main) alt_info = { scanned: rj, main: main.material_code, group: me.alt_group, scanned_spec: String(me.spec || "").slice(0, 60), main_spec: String(main.spec || "").slice(0, 60) };
        }
      }
      let slots = await slotsOfMaterial(query, rj, model, dt);
      if (!slots.length && alt_info) slots = await slotsOfMaterial(query, alt_info.main, model, dt);

      if (!slots.length) {
        // 站位表没配 → 看系统学到的「上料基准」；有则带出，无则柔性建档
        const bl = (await smtCore.baselineVerify(line_code, model, rj, "")).hit
          || (alt_info ? (await smtCore.baselineVerify(line_code, model, alt_info.main, "")).hit : null);
        if (bl) return ok(res, {
          success: true, no_slot: true, from_baseline: true, baseline: bl, rj, dt, model, slots: [], alt: alt_info,
          recommend: { machine_no: bl.machine_no, slot_no: bl.slot_no, feeder_no: "" },
        }, `按上次记录带出：设备 ${bl.machine_no} / 通道 ${bl.slot_no}${Number(bl.locked || 0) ? "（已固化，按此位置校验）" : "（学习中）"}`);
        return ok(res, { success: true, no_slot: true, need_manual: true, rj, dt, model, slots: [], alt: alt_info },
          "新位置：请扫 设备 → 通道 → 飞达，本次扫码自动建档，之后自动带出");
      }

      // 防重复：该料盘是否已在机上
      if (reel.reelSn) {
        const onm = (await query(`SELECT machine_no, slot_no FROM prd_material_load
          WHERE reel_sn=$1 AND UPPER(material_code)=UPPER($2) AND COALESCE(lot_no,'')=$3 AND active='1' AND check_result='OK' LIMIT 1`,
          [reel.reelSn, rj, reel.lotNo || ""])).rows[0];
        if (onm) return ok(res, { success: false, msg: `✕ 该料盘已上机（${onm.machine_no} ${onm.slot_no}），同一料盘不能重复上料`, data: { model } });
      }
      // 历史推荐：该机型+料号上次装的位置
      const hist = (await query(`SELECT machine_no, slot_no, feeder_no FROM prd_material_load
        WHERE model=$1 AND (UPPER(material_code)=UPPER($2) OR UPPER(material_code)=UPPER($3)) AND check_result='OK' ORDER BY id DESC LIMIT 1`,
        [model, rj, dt])).rows[0];

      const slotJson = (s) => {
        const mainCode = String(s.material_code || "").trim();
        const isAlt = normU(rj) !== normU(mainCode) && normU(rj) !== normU(s.vn_code || "");
        return { machine_no: s.machine_no, machine_code: s.machine_code, slot_no: s.slot_no, feeder_no: s.feeder_no,
          designators: s.designators, spec: s.spec, main_code: mainCode, is_alt: isAlt, alt_count: 0 };
      };
      return ok(res, {
        success: true, model, rj, dt, alt: alt_info, lot: reel.lotNo, dc: reel.dc, qty: reel.qty, reel_sn: reel.reelSn,
        slots: slots.map(slotJson), strict: smtCore.feederSlotStrict(),
        recommend: hist ? { machine_no: hist.machine_no, slot_no: hist.slot_no, feeder_no: hist.feeder_no } : null,
      }, `✓ 解析到 ${slots.length} 个位置${hist ? "（含历史推荐）" : ""}${bom_note}`);
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── 源 plan.py kitting：排产齐套检查（多阶 BOM 展开 + 替代组归并 + 需求/已领/库存）──
  router.get("/plan/kitting", requireMesrjPerm(null), async (req, res) => {
    try {
      const mo_no = String(req.query.mo_no || "").trim();
      if (!mo_no) return fail(res, "请提供工单号");
      const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [mo_no])).rows[0];
      if (!mo) return fail(res, `工单不存在：${mo_no}`);
      const pc = String(mo.product_code || "").trim();
      const plan_qty = Number(mo.plan_qty || 0);

      const raw = await expandBomItems(query, pc);
      const merged = {};
      for (const r of raw) {
        const k = normU(r.material_code);
        if (!merged[k]) merged[k] = { ...r };
        else {
          merged[k].qty_per = Number(merged[k].qty_per || 0) + Number(r.qty_per || 0);
          if (r.via && !String(merged[k].via || "").includes(r.via)) merged[k].via = (merged[k].via || "") + r.via;
        }
      }
      const bom = Object.values(merged);
      const excl_cnt = Number((await query("SELECT COUNT(*)::int n FROM bom_item WHERE product_code=$1 AND COALESCE(item_type,'RM')='SFG'", [pc])).rows[0]?.n || 0);
      if (!bom.length) return ok(res, { mo_no, rows: [], warn: `该机型（${pc}）没有 BOM，无法做齐套检查`, demand_total: 0, issued_total: 0, short_cnt: 0, excluded_cnt: excl_cnt });

      const issued = {};
      for (const r of (await query(`SELECT i.material_code, SUM(COALESCE(NULLIF(i.issued_qty,0), COALESCE(i.issue_qty,0))) q
          FROM ord_issue_item i JOIN ord_issue h ON h.issue_no=i.issue_no WHERE h.mo_no=$1 GROUP BY i.material_code`, [mo_no])).rows)
        issued[normU(r.material_code)] = Number(r.q || 0);

      const stock = {};
      try {
        for (const r of (await query(`SELECT material_code, SUM(COALESCE(qty,0)) q FROM erp_inventory
            WHERE COALESCE(stock_status,'good') IN ('good','') GROUP BY material_code`)).rows)
          stock[normU(r.material_code)] = Number(r.q || 0);
      } catch { /* 无库存按 0 */ }

      const groups = {};
      for (const r of bom) {
        const ag = normU(r.alt_group);
        const k = (Number(r.is_alt || 0) === 1 && ag) ? ("ALT#" + ag) : ("M#" + normU(r.material_code));
        const g = groups[k] || (groups[k] = { key: k, qty_per: 0, members: [] });
        g.qty_per = Math.max(g.qty_per, Number(r.qty_per || 0));
        g.members.push({ material_code: r.material_code, name: r.nm, spec: r.spec, is_alt: Number(r.is_alt || 0),
          qty_per: Number(r.qty_per || 0), pos: String(r.pos || "").slice(0, 120), via: String(r.via || "").replace(/>$/, "").slice(0, 60),
          issued: issued[normU(r.material_code)] || 0, stock: stock[normU(r.material_code)] || 0, stock_known: normU(r.material_code) in stock });
      }

      const rows = [];
      let demand_total = 0, issued_total = 0, stock_total = 0, pending_total = 0;
      for (const g of Object.values(groups)) {
        const demand = g.qty_per * plan_qty;
        const got = g.members.reduce((s, m) => s + m.issued, 0);
        const have = g.members.reduce((s, m) => s + m.stock, 0);
        const pending = Math.max(0, demand - got);
        const short = Math.max(0, pending - have);
        demand_total += demand; issued_total += got; stock_total += have; pending_total += pending;
        rows.push({ is_alt_group: g.members.length > 1, demand: +demand.toFixed(2), issued: +got.toFixed(2),
          pending: +pending.toFixed(2), stock: +have.toFixed(2), short: +short.toFixed(2),
          ratio: demand ? +((Math.min(got + have, demand) / demand * 100)).toFixed(1) : 100,
          stock_known: g.members.some(m => m.stock_known), members: g.members, main: g.members[0] });
      }
      rows.sort((a, b) => (-a.short) || String(a.main.material_code).localeCompare(String(b.main.material_code)));
      const short_rows = rows.filter(x => x.short > 0);
      return ok(res, { mo_no, rows, demand_total: +demand_total.toFixed(2), issued_total: +issued_total.toFixed(2),
        stock_total: +stock_total.toFixed(2), pending_total: +pending_total.toFixed(2), short_cnt: short_rows.length,
        excluded_cnt: excl_cnt });
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── 源 analyze.py station_board：多工位 × 日期范围 → 投入/产出/良率/FPY/NDF ──
  router.get("/report/station-board", requireMesrjPerm(null), async (req, res) => {
    try {
      const d1 = String(req.query.from || "").trim() || smtCore.addHours(smtCore.todayStr() + " 00:00:00", -144).slice(0, 10);
      const d2 = String(req.query.to || "").trim() || smtCore.todayStr();
      const raw = String(req.query.stations || "").trim();
      let stations = raw ? raw.split(",").map(x => x.trim()).filter(Boolean) : [...DEFAULT_STATIONS];
      stations = stations.slice(0, 20);

      const namemap = {};
      if (stations.length) {
        for (const r of (await query("SELECT station_code, COALESCE(NULLIF(short_name,''), station_name) nm FROM md_station WHERE station_code = ANY($1)", [stations])).rows)
          namemap[r.station_code] = r.nm || r.station_code;
      }
      const SQL = `WITH p AS (
        SELECT sn, result, COALESCE(ng_code,'') ng, ${VN_DATE} d,
               ROW_NUMBER() OVER (PARTITION BY sn ORDER BY id) rn1,
               ROW_NUMBER() OVER (PARTITION BY sn ORDER BY id DESC) rnN
        FROM prd_pass WHERE station_code=$1 AND ${VN_DATE} BETWEEN $2 AND $3
      ), per AS (
        SELECT sn, d,
               MAX(CASE WHEN rn1=1 THEN result END) first_r,
               MAX(CASE WHEN rnN=1 THEN result END) last_r,
               MAX(CASE WHEN result='NG' THEN 1 ELSE 0 END) had_ng,
               MAX(CASE WHEN result='NG' AND ng IN ('','NDF') THEN 1 ELSE 0 END) had_ndf
        FROM p GROUP BY sn, d)
      SELECT d, COUNT(*) in_qty,
             SUM(CASE WHEN last_r='OK' THEN 1 ELSE 0 END) out_qty,
             SUM(CASE WHEN first_r='OK' THEN 1 ELSE 0 END) fpy_ok,
             SUM(had_ng) ng_qty, SUM(had_ndf) ndf_qty
      FROM per GROUP BY d ORDER BY d`;
      const rate = (a, b) => (b ? +(a * 100 / b).toFixed(1) : null);
      const out_rows = [], summary = [], errors = [];
      for (const code of stations) {
        let rs;
        try { rs = (await query(SQL, [code, d1, d2])).rows; }
        catch (e) { rs = []; errors.push(`${code}：${e.message}`); }
        const tot = { in: 0, out: 0, fpy: 0, ng: 0, ndf: 0 };
        for (const r of rs) {
          const iq = Number(r.in_qty || 0), oq = Number(r.out_qty || 0), fq = Number(r.fpy_ok || 0), nq = Number(r.ng_qty || 0), dq = Number(r.ndf_qty || 0);
          tot.in += iq; tot.out += oq; tot.fpy += fq; tot.ng += nq; tot.ndf += dq;
          out_rows.push({ station_code: code, station_name: namemap[code] || code, day: r.d, in_qty: iq, out_qty: oq, fpy_ok: fq,
            ng_qty: nq, ndf_qty: dq, yield: rate(oq, iq), fpy: rate(fq, iq), ndf: rate(dq, nq) });
        }
        if (tot.in || tot.ng) summary.push({ station_code: code, station_name: namemap[code] || code, in_qty: tot.in, out_qty: tot.out,
          fpy_ok: tot.fpy, ng_qty: tot.ng, ndf_qty: tot.ndf, yield: rate(tot.out, tot.in), fpy: rate(tot.fpy, tot.in), ndf: rate(tot.ndf, tot.ng) });
      }
      return ok(res, { from: d1, to: d2, stations, summary, rows: out_rows, errors });
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── 源 md.py machine_source_point_to_mo：把工单路线涉及的机台一次全部指向该工单 ──
  router.post("/md/machine-source/point-to-mo", requireMesrjPerm("md.edit"), async (req, res) => {
    try {
      const d = req.body || {};
      const mo_no = String(d.mo_no || "").trim();
      const only = d.machine_nos;
      if (!mo_no) return fail(res, "请选择要指向的工单");
      const mo = (await query("SELECT mo_no, status, product_code FROM ord_mo WHERE mo_no=$1", [mo_no])).rows[0];
      if (!mo) return fail(res, "工单不存在");
      // 路线快照：先按单号，再按组（前 9 位）
      let snap = [];
      for (const [tbl, keyCol, val] of [["prd_mo_route", "mo_no", mo_no], ["prd_mo_group_route", "group_key", mo_no.slice(0, 9)]]) {
        let r; try { r = (await query(`SELECT snapshot FROM ${tbl} WHERE ${keyCol}=$1`, [val])).rows[0]; } catch { r = null; }
        if (r && r.snapshot) { try { snap = JSON.parse(r.snapshot); break; } catch { snap = []; } }
      }
      if (!snap.length) return fail(res, `工单 ${mo_no} 还没有路线快照（工艺没锁），无法确定涉及哪些工位`);
      const stations = [];
      for (const s of snap) { const c = String(s.station_code || "").trim(); if (c && !stations.includes(c)) stations.push(c); }
      if (!stations.length) return fail(res, `工单 ${mo_no} 的路线里没有工位`);

      let rows = (await query("SELECT id, machine_no, station_code, mo_hint FROM cfg_machine_source WHERE COALESCE(enabled,1)=1 AND station_code = ANY($1)", [stations])).rows;
      if (only) { const keep = new Set((Array.isArray(only) ? only : []).map(String)); rows = rows.filter(x => keep.has(String(x.machine_no))); }
      if (!rows.length) return ok(res, { updated: 0, machines: [], stations: stations.length }, `工单 ${mo_no} 涉及 ${stations.length} 个工位，但这些工位上一台设备都没登记`);

      const changed = [], same = [];
      for (const x of rows) {
        if (String(x.mo_hint || "") === mo_no) { same.push(x.machine_no); continue; }
        await query("UPDATE cfg_machine_source SET mo_hint=$1, updated_at=now() WHERE id=$2", [mo_no, x.id]);
        changed.push(x.machine_no);
      }
      await smtCore.audit(who(req), "设备", "机台工单指向", mo_no, `指向 ${changed.length} 台：${changed.join("、") || "-"}（原本已指向 ${same.length} 台）`, req.ip);
      return ok(res, { updated: changed.length, machines: changed, already: same, stations: stations.length },
        changed.length ? `✓ ${changed.length} 台机台已指向工单 ${mo_no}（设备约 20 秒内自动跟随）` : `这 ${same.length} 台机台本来就已经指向 ${mo_no}，无需改动`);
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── 源 bind.py teardown：拆壳返工（action='拆壳'，与「换标=作废」严格区分）──
  //   记成「作废」会让新铭牌继承旧板的 ATE1/超声履历、跳过重测 —— 违背拆壳必须重测。
  router.post("/bind/teardown", requireAnyPerm("prod.bind", "prod.decode"), async (req, res) => {
    try {
      const d = req.body || {};
      const sn = String(d.sn || "").trim();
      const reason = String(d.reason || "").trim() || "拆壳返工";
      const remark = String(d.remark || "").trim();
      const station = String(d.station || "").trim();
      if (!sn) return fail(res, "请先扫码");

      // 该 SN 当前有效的 PCBA_Link
      const links = (await query(`SELECT * FROM prd_sn_rel WHERE rel_type='PCBA_Link' AND is_active=1 AND (parent_sn=$1 OR child_sn=$1)`, [sn])).rows;
      if (!links.length) return fail(res, `SN【${sn}】当前没有绑定铭牌 —— 可能已经拆过了，不需要再拆。\n如果是想换标签，请走「解码 / 换标」。`);

      // 已装箱/上栈板的先拦（否则箱内清单对不上）
      for (const r of links) {
        for (const code of [r.parent_sn, r.child_sn]) {
          const c = (await query("SELECT box_no, pallet_no FROM prd_sn WHERE sn=$1", [code])).rows[0];
          if (c && (c.box_no || c.pallet_no)) return fail(res, `SN【${code}】已装在箱【${c.box_no || "-"}】/栈板【${c.pallet_no || "-"}】，请先取消装箱再拆壳`);
        }
      }

      const operator = who(req);
      const done = [];
      for (const r of links) {
        const pcba = String(r.parent_sn || "").trim();
        const label = String(r.child_sn || "").trim();
        await query("UPDATE prd_sn_rel SET is_active=0, reason=$1, void_at=now(), void_by=$2 WHERE id=$3", [reason, operator, r.id]);
        await query("UPDATE prd_sn SET status='报废', updated_at=now() WHERE sn=$1", [label]);
        await query(`INSERT INTO mesrj_decode_log (action,sn,rel_id,parent_sn,child_sn,rel_type,void_sn,reason,remark,operator,station,mo_no,created_at)
          VALUES ('拆壳',$1,$2,$3,$4,'PCBA_Link',$5,$6,$7,$8,$9,$10,now())`,
          [sn, r.id, pcba, label, label, reason, remark, operator, station, r.mo_no || ""]);
        if (pcba) await query("UPDATE prd_sn SET cur_station='', cur_seq=0, updated_at=now() WHERE sn=$1 AND status IN ('在制','待修')", [pcba]);
        done.push({ pcba, old_label: label });
      }
      await smtCore.audit(operator, "绑码", "拆壳返工", sn, `解绑并作废 ${done.length} 张铭牌：${done.map(x => x.old_label).join("、")}；原因：${reason}${remark ? "（" + remark + "）" : ""}`, req.ip);
      return ok(res, { sn, done }, `✓ 已拆壳：${done.length} 张铭牌作废，PCBA 回到未绑码，必须重新走 绑码 → ATE1 → 超声`);
    } catch (ex) { return fail(res, ex.message); }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 设备侧（X-Api-Key，注册在 JWT 之前）—— 源逐字契约
// ════════════════════════════════════════════════════════════════════════════

export function registerDeviceGapRoutes(router, { query, ok, fail }) {
  // ── 源 devsrc.py open_mo：机台端「选工单」下拉（PascalCase 契约）──
  router.get("/DeviceConfig/OpenMo", async (req, res) => {
    if (!(await keyOk(req, query))) return res.json({ Success: false, Message: "鉴权失败" });
    try {
      const rows = (await query(`SELECT m.mo_no, m.fg_code, m.product_code, m.line_code, m.plan_qty, m.status,
          COALESCE(p.product_model,'') model, COALESCE(p.product_name,'') product_name
        FROM ord_mo m LEFT JOIN md_product p ON p.product_code = m.fg_code
        WHERE m.status IN ('待排产','已排产','已下达','生产中')
        ORDER BY CASE WHEN m.status='生产中' THEN 0 ELSE 1 END, m.mo_no DESC LIMIT 100`)).rows;
      const out = rows.map(r => ({ MoNumber: r.mo_no || "", Model: r.model || r.product_name || "",
        ProductCode: r.fg_code || r.product_code || "", LineSn: r.line_code || "", PlanQty: Number(r.plan_qty || 0), Status: r.status || "" }));
      return res.json({ Success: true, Count: out.length, Rows: out });
    } catch (e) { return res.json({ Success: false, Message: `查询制令单失败: ${e.message}` }); }
  });

  // ── 源 devcfg_fix.py ultra_scan：超声扫码旁路闸门（校验+留痕+入队，不写过站）──
  router.post("/Device/UltraScan", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    const d = req.body || {};
    const sn = normU(d.Sn);
    const emp = String(d.Emp || "").trim();
    const src = String(d.Source || "serial").trim();
    const rawTs = String(d.ScannedAt || "").trim();
    let scanTs = new Date();
    if (rawTs) { const p = new Date(rawTs.replace(" ", "T") + "+07:00"); if (!Number.isNaN(p.getTime())) scanTs = p; }

    let verdict = "OK", reason = "", row = null;
    try {
      if (!/^[0-9A-Z]{10}$/.test(sn)) { verdict = "BAD_FORMAT"; reason = "SN 格式不对（应为 10 位字母数字）"; }
      else {
        row = (await query("SELECT status, mo_no, product_code FROM prd_sn WHERE UPPER(sn)=$1", [sn])).rows[0];
        if (!row) { verdict = "NO_SN"; reason = "系统里没有这个 SN（未建档）"; }
        else if (["待修", "报废"].includes(String(row.status || ""))) { verdict = "BLOCKED"; reason = `该板状态=${row.status}，不能焊`; }
        else {
          const ate = (await query("SELECT 1 FROM prd_pass WHERE UPPER(sn)=$1 AND station_code=$2 AND result='OK' ORDER BY id DESC LIMIT 1", [sn, ATE1_STATION])).rows.length;
          const dup = (await query("SELECT 1 FROM prd_ultra_scan WHERE UPPER(sn)=$1 AND verdict='OK' AND scanned_at >= now() - interval '5 minutes' LIMIT 1", [sn])).rows.length;
          if (dup) { verdict = "DUP"; reason = "5 分钟内重复扫码"; }
          else if (!ate) { verdict = "NO_ATE1"; reason = "还没过 ATE1（顺序不对）"; }
          else {
            const passed = (await query("SELECT 1 FROM prd_pass WHERE UPPER(sn)=$1 AND station_code=$2 AND result='OK' LIMIT 1", [sn, ULTRA_STATION])).rows.length;
            if (passed) { verdict = "DONE"; reason = "这块板已经有超声过站记录"; }
          }
        }
      }
    } catch (e) { verdict = "ERR"; reason = String(e.message || e).slice(0, 120); }

    try { await query(`INSERT INTO prd_ultra_scan(sn,scanned_at,station_code,verdict,reason,source,emp,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, [sn, scanTs, ULTRA_STATION, verdict, reason, src, emp]); } catch { /* 流水失败不影响判定 */ }

    const passed = verdict === "OK";
    let queued = false;
    if (passed) {
      try { queued = (await enqueue(query, sn, row?.mo_no || "", row?.product_code || "", emp, "")).ok; } catch { queued = false; }
    }
    return ok(res, { sn, verdict, ok: passed, reason, queued }, reason || (queued ? "已登记并排队" : "已登记"));
  });

  // ── 源 devcfg_fix.py ultra_scan_recent：最近扫码流水 ──
  router.get("/Device/UltraScan/recent", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    try {
      const n = Math.min(200, Math.max(1, Number(req.query.limit || 30)));
      const rows = (await query("SELECT sn, to_char(scanned_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD HH24:MI:SS') scanned_at, verdict, reason, emp FROM prd_ultra_scan ORDER BY id DESC LIMIT $1", [n])).rows;
      return ok(res, rows);
    } catch (ex) { return fail(res, ex.message); }
  });
}
