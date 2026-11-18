/**
 * AQL sampling engine (ANSI/ASQ Z1.4 / ISO 2859-1), single sampling.
 *
 * Ported from the Python MES (`core/aql.py`) so the SMT system can decide
 * 出货抽检 plans and verdicts on PostgreSQL without calling the old service.
 * Pure functions only: the caller supplies lot qty / AQL / level / severity and
 * this module returns the sample plan or the pass/fail verdict.
 *
 * Vocabulary (matches the shop floor):
 *   CR  致命缺陷   Ac is always 0 — one critical defect fails the lot outright
 *   MA  主要缺陷
 *   MI  轻微缺陷
 */

import { CODE_ORDER, LEVEL_SHIFT, LOT_RANGES, PLANS, SAMPLE_SIZE } from "./aql-plans.js";

export const SEVERITIES = Object.freeze(["normal", "tightened", "reduced"]);
export const LEVELS = Object.freeze(["I", "II", "III"]);

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Lot quantity + inspection level -> code letter.
 * @returns {{code: string|null, note: string}}
 */
export function codeFor(lotQty, level = "II") {
  const n = num(lotQty);
  if (!(n > 0)) return { code: null, note: "批量必须大于 0" };
  const key = String(level ?? "II").trim().toUpperCase();
  const shift = LEVEL_SHIFT[key];
  if (shift === undefined) {
    return { code: null, note: `检验水平只支持 I / II / III，收到 ${level}` };
  }
  let code = "A";
  for (const [lo, hi, letter] of LOT_RANGES) {
    if (lo <= n && n <= hi) {
      code = letter;
      break;
    }
  }
  const index = CODE_ORDER.indexOf(code);
  const shifted = Math.min(Math.max(index + shift, 0), CODE_ORDER.length - 1);
  return { code: CODE_ORDER[shifted], note: "" };
}

/**
 * Find the (Ac, Re) row for an AQL value. Z1.4 has holes in the table: when the
 * requested AQL does not exist on this code letter the standard says to move to
 * the next available letter (up first, then down) — that is what the Python MES
 * did, and the note tells the operator which sample size was actually used.
 */
function resolve(plans, code, aql) {
  const row = plans[code] || {};
  if (row[aql]) {
    const [ac, re] = row[aql];
    return { code, ac, re, note: "" };
  }
  const index = CODE_ORDER.indexOf(code);
  const upward = index >= 0 ? CODE_ORDER.slice(index + 1) : [];
  const downward = index > 0 ? CODE_ORDER.slice(0, index).reverse() : [];
  for (const candidate of [...upward, ...downward]) {
    const r = plans[candidate] || {};
    if (r[aql]) {
      const [ac, re] = r[aql];
      return {
        code: candidate,
        ac,
        re,
        note: `按 Z1.4 表头跳到样本代字 ${candidate}（样本量 ${SAMPLE_SIZE[candidate]}）`,
      };
    }
  }
  return { code: null, ac: null, re: null, note: "该 AQL 在标准表里没有可用方案" };
}

/**
 * Single-defect-class plan.
 * @param {number} lotQty
 * @param {number} aql
 * @param {"I"|"II"|"III"} [level]
 * @param {"normal"|"tightened"|"reduced"} [severity]
 */
export function plan(lotQty, aql, level = "II", severity = "normal") {
  const sev = String(severity || "normal").toLowerCase();
  const plans = PLANS[sev] || PLANS.normal;
  const { code, note: codeNote } = codeFor(lotQty, level);
  if (!code) return { ok: false, note: codeNote };

  const a = num(aql);
  if (Number.isNaN(a)) return { ok: false, note: `AQL 必须是数字，收到 ${aql}` };
  if (a <= 0) return { ok: false, note: "AQL 必须大于 0（零缺陷另走 Ac=0 全检流程）" };

  const found = resolve(plans, code, a);
  if (!found.code) return { ok: false, note: found.note };
  const n = SAMPLE_SIZE[found.code];
  if (found.ac !== null && found.ac > n) {
    return { ok: false, note: `判定数 Ac=${found.ac} 大于样本量 ${n}，数据可疑` };
  }
  return {
    ok: true,
    code: found.code,
    lotCode: code,
    n,
    ac: found.ac,
    re: found.re,
    aql: a,
    severity: sev,
    note: found.note,
  };
}

/**
 * One-shot plan for all three defect classes: CR is fixed at Ac=0, MA and MI
 * come from their own AQLs. The sample size is the larger of the two so a single
 * physical sample can be judged against all three classes.
 */
export function plansFor(lotQty, aqlMa = 1.0, aqlMi = 2.5, level = "II", severity = "normal") {
  const ma = plan(lotQty, aqlMa, level, severity);
  const mi = plan(lotQty, aqlMi, level, severity);
  if (!ma.ok) return { ok: false, note: ma.note };
  if (!mi.ok) return { ok: false, note: mi.note };
  const code = ma.n >= mi.n ? ma.code : mi.code;
  return {
    ok: true,
    n: Math.max(ma.n, mi.n),
    level: String(level || "II").toUpperCase(),
    code,
    lotCode: ma.lotCode,
    severity: String(severity || "normal").toLowerCase(),
    cr: { ac: 0, re: 1, aql: 0 },
    ma: { ac: ma.ac, re: ma.re, aql: ma.aql, n: ma.n, note: ma.note || "" },
    mi: { ac: mi.ac, re: mi.re, aql: mi.aql, n: mi.n, note: mi.note || "" },
  };
}

/**
 * Judge an inspection.
 * @param {{cr?: number, ma?: number, mi?: number}} defects  counts found in the sample
 * @param {ReturnType<typeof plansFor>} p
 * @returns {{ok: boolean|null, accepted: boolean|null, reasons: string[]}}
 */
export function verdict(defects = {}, p = {}) {
  if (!p || !p.ok) {
    return { ok: null, accepted: null, reasons: [`抽样方案无效：${p?.note || "未知原因"}`] };
  }
  const cr = Math.trunc(num(defects.cr ?? 0) || 0);
  const ma = Math.trunc(num(defects.ma ?? 0) || 0);
  const mi = Math.trunc(num(defects.mi ?? 0) || 0);
  const reasons = [];
  if (cr > 0) reasons.push(`致命缺陷 ${cr} 个（Ac=0），整批判不合格`);
  if (ma > p.ma.ac) reasons.push(`主要缺陷 ${ma} > Ac ${p.ma.ac}`);
  if (mi > p.mi.ac) reasons.push(`轻微缺陷 ${mi} > Ac ${p.mi.ac}`);
  const accepted = reasons.length === 0;
  return {
    ok: accepted,
    accepted,
    reasons: accepted
      ? [`合格：主要 ${ma} ≤ Ac ${p.ma.ac}，轻微 ${mi} ≤ Ac ${p.mi.ac}`]
      : reasons,
  };
}

/** Severity label used by the UI and by stored batch rows. */
export const SEVERITY_LABELS = Object.freeze({
  normal: "正常检验",
  tightened: "加严检验",
  reduced: "放宽检验",
});

// ═══════════════════════════════════════════════════════════════════════════
// OQC 托盘/PO 台数拆分（逐语义移植自源 core/oqc_aql.py 的 _po_lot_qty / _belongs）
//
// _po_lot_qty(po_no)：按 PO 号从 prd_pallet 汇总 total_qty；为 0 时再从 prd_box
// 汇总 qty。用于 OQC 批量创建时，lotQty 未填则自动推导批量。
// _belongs(pallet_no, sn)：校验 SN 是否属于指定托盘，用于 OQC 扫码归属检查。
//
// 两个函数都接收 (query, ...) 作为参数，query 签名与 db.js 的 query 一致，
// 便于单元测试时 mock，不依赖真实数据库。
// ════════════════════════════════════════════════════════════════════════════

/**
 * Port of `_po_lot_qty(po_no)` from core/oqc_aql.py.
 *
 * Lot quantity basis for an OQC batch when the operator did not enter one:
 *   1. SUM(total_qty) from prd_pallet where po_no = $1  (basis = "po")
 *   2. else SUM(qty) from prd_box where po_no = $1      (basis = "box")
 *   3. else 0                                           (basis = "none")
 *
 * @param {Function} query  sql query function (db.js style): (sql, params) => Promise<{rows}>
 * @param {string|null} poNo
 * @returns {{n: number, basis: "po"|"box"|"none"}}
 */
export async function poLotQty(query, poNo) {
  const p = String(poNo ?? "").trim();
  if (!p) return { n: 0, basis: "none" };

  const palletRows = await query(
    `SELECT COALESCE(SUM(total_qty), 0) AS n FROM prd_pallet WHERE po_no = $1`,
    [p],
  );
  const n = Number(palletRows.rows[0]?.n ?? 0);
  if (n > 0) return { n, basis: "po" };

  const boxRows = await query(
    `SELECT COALESCE(SUM(qty), 0) AS n FROM prd_box WHERE po_no = $1`,
    [p],
  );
  const m = Number(boxRows.rows[0]?.n ?? 0);
  if (m > 0) return { n: m, basis: "box" };

  return { n: 0, basis: "none" };
}

/**
 * Port of `_belongs(pallet_no, sn)` from core/oqc_aql.py.
 *
 * Verify a scanned SN belongs to the given pallet for OQC rework/inspection:
 *   - SN must exist in prd_sn
 *   - prd_sn.pallet_no must equal palletNo (case-insensitive)
 *
 * @param {Function} query  sql query function (db.js style)
 * @param {string|null} palletNo
 * @param {string|null} sn
 * @returns {{ok: boolean, reason?: string, actualPallet?: string|null}}
 */
export async function snBelongsToPallet(query, palletNo, sn) {
  const code = String(sn ?? "").trim();
  if (!code) return { ok: false, reason: "SN 不能为空" };

  const rows = await query(
    `SELECT pallet_no FROM prd_sn WHERE upper(sn) = upper($1) LIMIT 1`,
    [code],
  );
  const row = rows.rows[0];
  if (!row) return { ok: false, reason: "SN 未建档" };

  const actual = String(row.pallet_no ?? "").trim();
  const expected = String(palletNo ?? "").trim();
  if (!expected) return { ok: true, actualPallet: actual || null };
  if (actual.toUpperCase() !== expected.toUpperCase()) {
    return {
      ok: false,
      reason: `SN ${code} 属于托盘 ${actual || "(未绑定)"}，不属于托盘 ${expected}`,
      actualPallet: actual || null,
    };
  }
  return { ok: true, actualPallet: actual };
}
