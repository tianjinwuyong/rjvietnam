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
