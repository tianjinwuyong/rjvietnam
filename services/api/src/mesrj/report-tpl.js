// ============================================================================
// MES-ruijing W8 出货报告模板（逐字移植自源 core/report_tpl.py）
// 源用 openpyxl 读写 .xlsx；本移植改用 SheetJS（xlsx），已在 deps 里。
// 模板文件存在 services/api/data/report_tpl/ 下（cfg_report_tpl.rel_path）。
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { query } from "../db.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 模板与产物根目录（services/api/data/report_tpl） */
export const TPL_ROOT = path.resolve(HERE, "../../data/report_tpl");
export const TPL_OUT = path.join(TPL_ROOT, "out");

export const KIND_COC = "coc";
export const KIND_OQC = "oqc";
export const KIND_CPK = "cpk";
export const KINDS = {
  [KIND_COC]: "COC 出货证明",
  [KIND_OQC]: "OQC 出货报告",
  [KIND_CPK]: "CPK 过程能力",
};

const pad2 = n => String(n).padStart(2, "0");
const nowStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
const todayStr = () => nowStr().slice(0, 10);

/** 千分位（源 _fmt_int） */
function fmtInt(v) {
  const n = Number(v || 0);
  return n.toLocaleString("en-US");
}
/** YYYY.MM.DD（源 _d_dot） */
function dDot(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? `${m[1]}.${m[2]}.${m[3]}` : (s || "");
}
/** DD/MM/YYYY（源 _d_slash） */
function dSlash(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || "");
}

async function getParam(key, dflt = "") {
  const r = await query("SELECT param_val FROM sys_param WHERE param_key=$1", [key]);
  return r.rows[0]?.param_val != null ? r.rows[0].param_val : dflt;
}

// ── 可映射字段清单（源 FIELD_LABELS）──────────────────────────────────────
const FIELD_LABELS = [
  ["po_no", "PO 号"],
  ["po_line", "PO 行号"],
  ["cust_code", "客户编码"],
  ["cust_name", "客户名称"],
  ["product_code", "料号（MES 内部编码）"],
  ["product_model", "机型 / 物料编号"],
  ["product_name", "物料名称"],
  ["plan_qty", "订单数量（纯数字，无千分位）"],
  ["plan_qty_s", "订单数量（带千分位）"],
  ["plan_qty_pcs", "订单数量（带 pcs）"],
  ["ship_qty", "已封板数量（纯数字）"],
  ["ship_qty_s", "已封板数量（带千分位）"],
  ["ship_qty_pcs", "已封板数量（带 pcs）"],
  ["ins_qty", "OQC 检验数"],
  ["pallet_n", "已封板栈板数"],
  ["pallet_n_all", "栈板总数（含未封板）"],
  ["box_n", "外箱数"],
  ["sample_box_n", "抽检箱数"],
  ["today", "今天（YYYY-MM-DD）"],
  ["today_dot", "今天（YYYY.MM.DD）"],
  ["today_slash", "今天（DD/MM/YYYY）"],
  ["insp_date", "检验日期（YYYY-MM-DD）"],
  ["insp_date_dot", "检验日期（YYYY.MM.DD）"],
  ["insp_date_slash", "检验日期（DD/MM/YYYY）"],
  ["ship_date", "出货日期（YYYY-MM-DD）"],
  ["ship_date_dot", "出货日期（YYYY.MM.DD）"],
  ["ship_date_slash", "出货日期（DD/MM/YYYY）"],
  ["po_line_text", "订单号码整行（PO#xxx, Qty n）"],
  ["po_qty_text", "订单号码单行（PO#xxx, Qty n）"],
  ["oqc_no", "OQC 抽检单号"],
  ["oqc_result", "OQC 判定（合格/不合格）"],
  ["oqc_ok", "OQC 判定文案（合格 Approved）"],
  ["oqc_inspector", "OQC 检验员"],
  ["vendor_name", "供应商名称"],
  ["signer", "负责人签名"],
  ["signer_title", "负责人职务"],
  ["form_no", "表单编号"],
];

/** 页面「生成前可改」的字段（源 EDITABLE） */
const EDITABLE = [
  ["ship_date_dot", "出货日期"],
  ["ship_qty_pcs", "送货数量"],
  ["po_line_text", "订单号码"],
  ["signer", "负责人签名"],
  ["signer_title", "负责人职务"],
  ["vendor_name", "供应商名称"],
  ["insp_date_slash", "检验日期"],
  ["form_no", "表单编号"],
];

/** 全部可映射字段（含 OQC 逐项检验的动态字段；源 all_fields） */
export async function allFields() {
  const out = FIELD_LABELS.map(([k, v]) => ({ key: k, label: v }));
  try {
    for (const r of (await query(
      "SELECT seq, cat, item_name FROM cfg_oqc_item WHERE enabled=1 AND model='' ORDER BY seq")).rows) {
      const k = `ck${Number(r.seq)}`;
      const nm = `[${r.cat || ""}] ${(r.item_name || "").slice(0, 14)}`;
      out.push({ key: `${k}_inspqty`, label: `${nm} · 检验数` });
      out.push({ key: `${k}_okqty`, label: `${nm} · 良品数量` });
      out.push({ key: `${k}_ngqty`, label: `${nm} · 不良数量` });
      out.push({ key: `${k}_ngrate`, label: `${nm} · 不良率` });
    }
  } catch { /* 表不存在则只有静态字段 */ }
  return out;
}

/** 给页面看的可选字段（源 field_options） */
export function fieldOptions() {
  return EDITABLE.map(([k, v]) => ({ key: k, label: v }));
}

// ── 报告上下文（源 build_ctx）───────────────────────────────────────────────
export async function buildCtx(poNo, overrides = null) {
  poNo = (poNo || "").trim();
  const po = (await query(
    "SELECT po_no, po_line, cust_code, product_code, order_qty, status FROM ord_po WHERE po_no=$1",
    [poNo])).rows[0] || {};
  const cust = (await query("SELECT cust_name FROM md_customer WHERE cust_code=$1",
    [po.cust_code || ""])).rows[0] || {};
  const prod = (await query("SELECT product_model, product_name FROM md_product WHERE product_code=$1",
    [po.product_code || ""])).rows[0] || {};

  const planQty = Number(po.order_qty || 0);
  const pallets = (await query(
    "SELECT pallet_no, total_qty, status FROM prd_pallet WHERE po_no=$1", [poNo])).rows;
  const sealed = pallets.filter(p => (p.status || "") === "已封板");
  const shipQty = sealed.reduce((a, p) => a + Number(p.total_qty || 0), 0);
  const boxN = Number((await query("SELECT COUNT(*)::int AS n FROM prd_box WHERE po_no=$1",
    [poNo])).rows[0]?.n || 0);

  // OQC 抽检单（最近一张）
  let oqc = {};
  try {
    oqc = (await query(
      "SELECT oqc_no, sample_n, sample_boxes, result, inspector, inspect_time, "
      + "pallet_qty, box_total FROM qlt_oqc_order WHERE po_no=$1 ORDER BY id DESC LIMIT 1",
      [poNo])).rows[0] || {};
  } catch { oqc = {}; }

  const insp = (oqc.inspect_time || "").slice(0, 10) || todayStr();
  const today = todayStr();
  const model = prod.product_model || "";
  const vendor = ((await getParam("report.vendor_name", "")) || "").trim()
    || "BLUEWAY VINA COMPANY LIMITED";

  const ctx = {
    po_no: poNo,
    po_line: po.po_line || "1",
    cust_code: po.cust_code || "",
    cust_name: cust.cust_name || "",
    product_code: po.product_code || "",
    product_model: model,
    product_name: prod.product_name || model,
    plan_qty: planQty,
    plan_qty_s: fmtInt(planQty),
    ship_qty: shipQty,
    ship_qty_s: fmtInt(shipQty),
    ship_qty_pcs: `${fmtInt(shipQty)}pcs`,
    plan_qty_pcs: `${fmtInt(planQty)}pcs`,
    ins_qty: fmtInt(oqc.sample_n || 0),
    pallet_n: sealed.length,
    pallet_n_all: pallets.length,
    box_n: boxN,
    sample_box_n: oqc.sample_boxes
      ? String(oqc.sample_boxes).split(",").filter(x => x.trim()).length : 0,
    today, today_dot: dDot(today), today_slash: dSlash(today),
    insp_date: insp, insp_date_dot: dDot(insp), insp_date_slash: dSlash(insp),
    ship_date: today, ship_date_dot: dDot(today), ship_date_slash: dSlash(today),
    po_line_text: `\n\nPO#${poNo}, Qty ${fmtInt(planQty)}\n\n`,
    po_qty_text: `PO#${poNo}, Qty ${fmtInt(planQty)}`,
    oqc_no: oqc.oqc_no || "",
    oqc_result: oqc.result || "",
    oqc_ok: (oqc.result || "") === "合格" ? "合格 Approved" : "",
    oqc_inspector: oqc.inspector || "",
    vendor_name: vendor,
    signer: ((await getParam("report.signer", "")) || "").trim(),
    signer_title: ((await getParam("report.signer_title", "")) || "").trim(),
    form_no: "",
  };

  // OQC 逐项检验（源 core/oqc_check.ctx）
  ctx.ins_qty_pcs = "";
  try {
    const rows = (await query(
      "SELECT seq, insp_qty, ng_qty FROM qlt_oqc_check WHERE po_no=$1 ORDER BY seq", [poNo])).rows;
    if (rows.length) {
      let ins = 0, ok = 0, ng = 0;
      for (const r of rows) {
        ins += Number(r.insp_qty || 0);
        ng += Number(r.ng_qty || 0);
        const k = `ck${Number(r.seq)}`;
        ctx[`${k}_inspqty`] = Number(r.insp_qty || 0);
        ctx[`${k}_ngqty`] = Number(r.ng_qty || 0);
        ctx[`${k}_okqty`] = Math.max(Number(r.insp_qty || 0) - Number(r.ng_qty || 0), 0);
        ctx[`${k}_ngrate`] = Number(r.insp_qty || 0)
          ? Math.round(Number(r.ng_qty || 0) / Number(r.insp_qty || 0) * 10000) / 100 : 0;
      }
      ok = ins - ng;
      ctx.ins_qty_pcs = fmtInt(ins);
      ctx.ins_ok_qty = fmtInt(ok);
      ctx.ins_ng_qty = fmtInt(ng);
    }
  } catch { /* 无逐项检验数据 */ }

  ctx.part_no_po = `${ctx.product_code || ""}\n(订单号码 : ${poNo})`;
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (k in ctx || k.startsWith("x_")) ctx[k] = v;
    }
  }
  return ctx;
}

// ── 模板 CRUD（源 list_tpl / get_tpl / save_upload / save_mapping / toggle / delete_tpl）──
export async function listTpl(kind = "") {
  const rows = kind
    ? (await query("SELECT * FROM cfg_report_tpl WHERE kind=$1 ORDER BY kind, id", [kind])).rows
    : (await query("SELECT * FROM cfg_report_tpl ORDER BY kind, id")).rows;
  return rows.map(r => ({
    ...r,
    sheets: safeJson(r.sheets, []),
    mapping: safeJson(r.mapping, {}),
  }));
}

function safeJson(s, dflt) {
  try { const v = JSON.parse(s || ""); return v ?? dflt; } catch { return dflt; }
}

export async function getTpl(tplId) {
  // 调用方传 Number(req.params.id)，非数字时是 NaN——pg 把它当字符串塞进
  // bigint 参数直接 22P02。空/非数字一律按“不存在”处理。
  const id = Number(tplId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = (await query("SELECT * FROM cfg_report_tpl WHERE id=$1", [id])).rows[0];
  if (!r) return null;
  return { ...r, sheets: safeJson(r.sheets, []), mapping: safeJson(r.mapping, {}) };
}

/** 上传模板（源 save_upload）。buffer 是 .xlsx 文件内容 */
export async function saveUpload(buffer, kind, tplName, remark, by) {
  kind = (kind || KIND_COC).trim();
  tplName = (tplName || "").trim();
  if (!tplName) return [null, "请填模板名称"];
  if (!buffer || !buffer.length) return [null, "没有收到文件"];
  fs.mkdirSync(TPL_ROOT, { recursive: true });
  const code = `RT-${kind.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const safeName = `${code}.xlsx`;
  const relPath = path.join("tpl", safeName);
  const full = path.join(TPL_ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  // 读工作表名
  let sheets = [];
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    sheets = wb.SheetNames || [];
  } catch (e) {
    try { fs.unlinkSync(full); } catch { /* ignore */ }
    return [null, `Excel 文件读不出来：${e?.message || e}`];
  }
  await query(
    `INSERT INTO cfg_report_tpl (tpl_code, tpl_name, kind, file_name, rel_path, sheets,
     mapping, enabled, remark, created_by, created_at, updated_at, doc_no)
     VALUES ($1,$2,$3,$4,$5,$6,'{}',1,$7,$8,$9,$9,'')`,
    [code, tplName, kind, path.basename(safeName), relPath, JSON.stringify(sheets),
      remark || "", by || "", nowStr()]);
  return [await getTpl(Number((await query(
    "SELECT id FROM cfg_report_tpl WHERE tpl_code=$1", [code])).rows[0].id)), null];
}

/** 保存字段映射（源 save_mapping）：{sheet: {B8: "product_model"}} */
export async function saveMapping(tplId, mapping) {
  const tpl = await getTpl(tplId);
  if (!tpl) return [null, "模板不存在"];
  if (!mapping || typeof mapping !== "object") return [null, "映射格式不对"];
  const clean = {};
  for (const [sheet, cells] of Object.entries(mapping)) {
    if (!tpl.sheets.includes(sheet)) return [null, `模板里没有这张表「${sheet}」`];
    if (!cells || typeof cells !== "object") continue;
    const ok = {};
    for (const [cell, field] of Object.entries(cells)) {
      const c = String(cell).trim().toUpperCase();
      if (!/^[A-Z]{1,3}[1-9][0-9]{0,4}$/.test(c)) return [null, `单元格地址不合法：${c}`];
      const f = String(field || "").trim();
      if (f) ok[c] = f;
    }
    if (Object.keys(ok).length) clean[sheet] = ok;
  }
  await query("UPDATE cfg_report_tpl SET mapping=$1, updated_at=$2 WHERE id=$3",
    [JSON.stringify(clean), nowStr(), tplId]);
  return [await getTpl(tplId), null];
}

export async function toggleTpl(tplId, enabled) {
  await query("UPDATE cfg_report_tpl SET enabled=$1, updated_at=$2 WHERE id=$3",
    [enabled ? 1 : 0, nowStr(), tplId]);
  return getTpl(tplId);
}

export async function deleteTpl(tplId) {
  const tpl = await getTpl(tplId);
  if (!tpl) return [false, "模板不存在"];
  try {
    const full = path.join(TPL_ROOT, tpl.rel_path || "");
    if (fs.existsSync(full) && path.resolve(full).startsWith(path.resolve(TPL_ROOT))) {
      fs.unlinkSync(full);
    }
  } catch { /* 文件删不掉也要能删记录 */ }
  await query("DELETE FROM cfg_report_tpl WHERE id=$1", [tplId]);
  return [true, null];
}

/** 列出模板某张表里的非空单元格（源 tpl_cells） */
export async function tplCells(tplId, sheet = null, limit = 400) {
  const tpl = await getTpl(tplId);
  if (!tpl) return [null, "模板不存在"];
  const full = path.join(TPL_ROOT, tpl.rel_path || "");
  if (!fs.existsSync(full)) return [null, "模板文件不见了，请重新上传"];
  const wb = XLSX.readFile(full, { cellFormula: true });
  const names = sheet ? [sheet] : (tpl.sheets.length ? tpl.sheets : wb.SheetNames || []);
  const out = [];
  for (const nm of names) {
    if (!(wb.SheetNames || []).includes(nm)) continue;
    const ws = wb.Sheets[nm];
    const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
    if (!range) continue;
    const maxR = Math.min(range.e.r, range.s.r + 120);
    const maxC = Math.min(range.e.c, range.s.c + 30);
    let n = 0;
    for (let r = range.s.r; r <= maxR && n < limit; r++) {
      for (let c = range.s.c; c <= maxC && n < limit; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
        let s = String(cell.v).replace(/\n/g, " ");
        if (s.length > 60) s = s.slice(0, 60) + "…";
        out.push({ sheet: nm, cell: addr, value: s });
        n++;
      }
    }
  }
  return [out, null];
}

/** 生成前检查（源 precheck）。返回 {ok, warnings, ctx} */
export async function precheck(poNo) {
  const warn = [];
  poNo = (poNo || "").trim();
  if (!poNo) return { ok: false, warnings: ["请填 PO 号"], ctx: {} };
  const po = (await query("SELECT po_no, order_qty FROM ord_po WHERE po_no=$1", [poNo])).rows[0];
  if (!po) {
    return {
      ok: false,
      warnings: [`PO ${poNo} 不在订单主档里（ord_po）。先在建单时把 PO 号填上`],
      ctx: {},
    };
  }
  const ctx = await buildCtx(poNo);
  if (!ctx.ship_qty) {
    warn.push("⚠ PO 还没有已封板栈板，送货数量会是 0 —— 正式出货前必须先封板并做 OQC 抽检");
  }
  if (!ctx.oqc_no) {
    warn.push("⚠ PO 还没有 OQC 抽检单，报告里的检验数与判定会是空的");
  } else if (ctx.oqc_result !== "合格") {
    warn.push(`OQC 判定是「${ctx.oqc_result || "未判定"}」，不是「合格」——不允许出出货报告`);
    return { ok: false, warnings: warn, ctx };
  }
  if (ctx.plan_qty && ctx.ship_qty && ctx.ship_qty !== ctx.plan_qty) {
    warn.push(`已封板 ${ctx.ship_qty} ≠ 订单量 ${ctx.plan_qty} 台（部分出货正常，确认是否只出一部分）`);
  }
  try {
    const rows = (await query(
      "SELECT COUNT(*)::int AS n FROM qlt_oqc_check WHERE po_no=$1", [poNo])).rows[0];
    if (!Number(rows?.n || 0)) {
      warn.push("OQC 逐项检验还没录（质量与追溯 → OQC 逐项检验录入）—— "
        + "报告明细区的检验数/良品数会停在模板原值");
    }
  } catch { /* ignore */ }
  return { ok: true, warnings: warn, ctx };
}

/**
 * 按模板生成报告（源 gen）。返回 {buffer, name, ctx, warnings}
 * buffer 是 xlsx 文件内容（前端下载）
 */
export async function genReport(tplId, poNo, overrides = null) {
  const tpl = await getTpl(tplId);
  if (!tpl) return { buffer: null, warnings: ["模板不存在"] };
  const { ok, warnings, ctx } = await precheck(poNo);
  if (!ok) return { buffer: null, ctx, warnings };

  const full = path.join(TPL_ROOT, tpl.rel_path || "");
  if (!fs.existsSync(full)) return { buffer: null, ctx, warnings: ["模板文件不见了，请重新上传"] };

  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== null && v !== undefined && v !== "") ctx[k] = v;
    }
  }

  const wb = XLSX.readFile(full, { cellStyles: true });
  let filled = 0;
  for (const [sheet, cells] of Object.entries(tpl.mapping || {})) {
    if (!(wb.SheetNames || []).includes(sheet)) continue;
    const ws = wb.Sheets[sheet];
    for (const [cell, field] of Object.entries(cells || {})) {
      const v = ctx[field];
      if (v === null || v === undefined) continue;
      const addr = String(cell).trim().toUpperCase();
      const prev = ws[addr] || {};
      ws[addr] = { ...prev, t: typeof v === "number" ? "n" : "s", v };
      filled++;
    }
  }
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  ctx._filled = filled;
  const safe = String(poNo).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 20) || "PO";
  const name = `${(tpl.kind || "report").toUpperCase()}_${safe}_${todayStr().replace(/-/g, "")}.xlsx`;
  return { buffer, name, ctx, warnings, filled };
}
