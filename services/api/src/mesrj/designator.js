/**
 * W12 按位号反查料号 + 该料的可领批次/周期（D/C）
 * 源 core/designator.py
 * 关键：成品 BOM 不是元件级，需逐层展开 SFG 半成品
 */
import { query } from "../db.js";

const SPLIT_RE = /[,;，；、\s/]+/;
const RANGE_RE = /^([A-Za-z]+)(\d+)\s*[-~—–]\s*([A-Za-z]*)(\d+)$/;
const ONE_RE = /^([A-Za-z]+)(\d+)$/;
const POS_OK_RE = /^[A-Za-z]{1,4}\d{1,4}$/;

/** 把 pos_ref 拆成具体位号：R19,R20 → [R19, R20]；R19-R22 → [R19,R20,R21,R22] */
export function posTokens(posRef) {
  const out = [];
  for (const part of String(posRef || "").split(SPLIT_RE)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(RANGE_RE);
    if (m) {
      const p1 = m[1].toUpperCase(), n1 = parseInt(m[2], 10);
      const p2 = (m[3] || m[1]).toUpperCase(), n2 = parseInt(m[4], 10);
      if (p1 === p2 && n2 - n1 >= 0 && n2 - n1 <= 200) {
        for (let i = n1; i <= n2; i++) out.push(`${p1}${i}`);
        continue;
      }
    }
    if (POS_OK_RE.test(p)) out.push(p.toUpperCase());
  }
  return out;
}

/** pos_ref 里是否包含位号 want（精确匹配，不是前缀） */
export function posMatch(posRef, want) {
  const w = String(want || "").trim().toUpperCase();
  if (!w) return false;
  return posTokens(posRef).includes(w);
}

/** 成品 → 半成品逐层展开，返回 [{product_code, depth, parent_name}] */
async function codes(productCode, maxDepth = 2) {
  const out = [];
  const seen = new Set();
  const queue = [{ code: productCode, depth: 0, pname: "" }];
  while (queue.length) {
    const { code, depth, pname } = queue.shift();
    if (!code || seen.has(code) || depth > maxDepth) continue;
    seen.add(code);
    out.push({ code, depth, pname });
    if (depth === maxDepth) continue;
    const rows = await query(
      `SELECT DISTINCT material_code, material_name FROM bom_item
       WHERE product_code=$1 AND UPPER(COALESCE(item_type,''))='SFG'`,
      [code]);
    for (const r of rows.rows) {
      queue.push({ code: r.material_code, depth: depth + 1, pname: r.material_name || "" });
    }
  }
  return out;
}

/** 自然排序键：R1, R2, R10 而不是 R1, R10, R2 */
function natKey(x) {
  const m = String(x.designator || "").match(ONE_RE);
  return m ? [m[1], parseInt(m[2], 10)] : [x.designator || "", 0];
}

/** 补越南料号 */
async function withVn(rows) {
  for (const x of rows) {
    try {
      const r = await query("SELECT vn_code FROM md_material WHERE material_code=$1", [x.material_code]);
      x.vn_code = r.rows[0]?.vn_code || "";
    } catch {
      x.vn_code = "";
    }
  }
  rows.sort((a, b) => {
    const ka = natKey(a), kb = natKey(b);
    if (ka[0] !== kb[0]) return ka[0].localeCompare(kb[0]);
    return ka[1] - kb[1];
  });
  return rows;
}

/**
 * 按位号找料
 * keyword 可以是完整位号（R19），也可以是前缀（R1 → 列出 R1/R10/R11…）
 * 返回 [{designator, material_code, material_name, spec, qty_per, from_bom, from_bom_name, vn_code, is_alt, depth, pos_ref}]
 */
export async function lookup(productCode, keyword, limit = 50) {
  const kw = String(keyword || "").trim().toUpperCase();
  if (!productCode || !kw) return [];
  const out = [];
  const seen = new Set();
  for (const { code, depth, pname } of await codes(productCode)) {
    const rows = await query(
      `SELECT material_code, material_name, spec, qty_per, pos_ref, is_alt
       FROM bom_item WHERE product_code=$1 AND COALESCE(pos_ref,'')<>''`,
      [code]);
    for (const r of rows.rows) {
      const toks = posTokens(r.pos_ref);
      const exact = toks.filter(t => t === kw);
      const hits = exact.length ? exact : toks.filter(t => t.startsWith(kw));
      for (const tok of hits) {
        const key = `${tok}|${r.material_code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          designator: tok,
          pos_ref: r.pos_ref,
          material_code: r.material_code || "",
          material_name: r.material_name || "",
          spec: r.spec || "",
          qty_per: r.qty_per,
          is_alt: parseInt(r.is_alt || 0, 10),
          bom_code: code,
          bom_name: pname || (depth === 0 ? "成品" : ""),
          depth,
        });
        if (out.length >= limit) return withVn(out);
      }
      if (exact.length) break;
    }
  }
  return withVn(out);
}

/**
 * 该料号的批次与 D/C：
 * - used: 这批板实际上的料（prd_material_load，最准）
 * - stock: 现在还能领的库存（erp_inventory）
 */
export async function batches(materialCode, moNo = "", limit = 8) {
  const code = String(materialCode || "").trim();
  if (!code) return { used: [], stock: [] };
  let used = [];
  try {
    used = (await query(
      `SELECT batch_no, COALESCE(dc_code,'') AS dc_code, COALESCE(lot_no,'') AS lot_no,
              COALESCE(qty,0) AS qty, COALESCE(mo_no,'') AS mo_no,
              COALESCE(created_at,'') AS at, COALESCE(operator,'') AS operator
       FROM prd_material_load WHERE material_code=$1
         AND (COALESCE(batch_no,'')<>'' OR COALESCE(dc_code,'')<>'')
       ORDER BY (COALESCE(mo_no,'')=$2) DESC, id DESC LIMIT $3`,
      [code, moNo || "", limit])).rows;
  } catch {
    used = [];
  }
  let stock = [];
  try {
    stock = (await query(
      `SELECT batch_no, COALESCE(production_date,'') AS production_date,
              COALESCE(qty,0) AS qty, COALESCE(location_code,'') AS location,
              COALESCE(warehouse_code,'') AS warehouse, COALESCE(label_no,'') AS label_no
       FROM erp_inventory WHERE material_code=$1 AND COALESCE(qty,0)>0
       ORDER BY COALESCE(production_date,'') DESC LIMIT $2`,
      [code, limit])).rows;
  } catch {
    stock = [];
  }
  return { used, stock };
}