// ============================================================================
// MES-ruijing W8 AOI 机型口径（逐字移植自源 core/aoi_model.py）
// 把设备程序名归一到「标准机型」：
//   EPS18R1G-36-261017-1 / EPS18RIG-36-EPS18 / EPS18RJG-36 → EPS18R1G-36
//   EPS6 V2 / EPS6-V2 / EPS6V2                                → EPS6V2
// 处理策略（不改生产数据，查询时归一）：
//   1) 人工映射 cfg_aoi_program_map 优先（现场可改，兜住规则猜不到的）
//   2) 规则：大写 + 去掉所有非字母数字 + 易错字符纠偏（RIG/RJG → R1G）
//      再对「权威机型集合」做最长前缀命中
//   3) 都不命中 → 原样返回并标 unmapped
// 权威机型集合 = cfg_aoi_points.model ∪ md_product.product_model
//              ∪ cfg_panel_layout.model ∪ cfg_aoi_program_map.model
// ============================================================================
import { query } from "../db.js";

/** 设备/键盘把数字 1 打成 I、J 是现场高发错误，按已知机型片段纠偏 */
const ALIAS = [["RJG", "R1G"], ["RIG", "R1G"]];

/** 归一化：大写 + 吃掉空格/连字符/下划线 + 易错字符纠偏 */
export function aoiSqueeze(s) {
  s = (s || "").toUpperCase();
  for (const [a, b] of ALIAS) s = s.split(a).join(b);
  return s.replace(/[^A-Z0-9]/g, "");
}

/** 名字的「系列首段」：EPS48.001 → EPS48；EPS48-CAITIEN → EPS48；EPS48R1-36 → EPS48R1 */
export function aoiSeries(s) {
  const parts = (s || "").trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  return parts.length ? aoiSqueeze(parts[0]) : "";
}

/**
 * 两个名字是否「同一系列」（首段互为前缀）。
 * EPS48.001 / EPS48-CAITIEN ↔ EPS48R1-36 → 同系列
 * EPS6-CAITIEN            ↔ EPS48R1-36 → 不同系列
 * 首段太短（< minLen）时一律判否，避免 "E"/"18" 把什么都串起来。
 */
export function aoiSeriesLike(a, b, minLen = 4) {
  const x = aoiSeries(a), y = aoiSeries(b);
  if (x.length < minLen || y.length < minLen) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/** 权威机型集合（保留原始写法，长度降序，便于最长前缀命中） */
export async function aoiCanonicalModels() {
  const out = new Set();
  const sqls = [
    "SELECT DISTINCT model FROM cfg_aoi_points WHERE COALESCE(model,'')<>''",
    "SELECT DISTINCT product_model AS model FROM md_product WHERE COALESCE(product_model,'')<>''",
    "SELECT DISTINCT model FROM cfg_panel_layout WHERE COALESCE(model,'')<>''",
    "SELECT DISTINCT model FROM cfg_aoi_program_map WHERE COALESCE(model,'')<>''",
  ];
  for (const sql of sqls) {
    try {
      for (const r of (await query(sql)).rows) {
        const m = (r.model || "").trim();
        if (m) out.add(m);
      }
    } catch { /* 表不存在则跳过该来源 */ }
  }
  return [...out].sort((x, y) => aoiSqueeze(y).length - aoiSqueeze(x).length);
}

/** {程序名 → 标准机型}（人工维护优先） */
export async function aoiManualMap() {
  try {
    const rows = (await query(
      "SELECT program_name, model FROM cfg_aoi_program_map WHERE COALESCE(model,'')<>''")).rows;
    const out = {};
    for (const r of rows) out[r.program_name || ""] = r.model || "";
    return out;
  } catch {
    return {};
  }
}

/**
 * 单个程序名归一。返回 {model, hit, how}
 * how ∈ manual | wildcard | prefix | none
 */
export async function aoiResolveEx(program, models = null, manual = null) {
  const raw = (program || "").trim();
  if (!raw) return { model: "", hit: false, how: "none" };
  const mm = manual !== null ? manual : await aoiManualMap();
  if (raw in mm) return { model: mm[raw], hit: true, how: "manual" };

  const n = aoiSqueeze(raw);
  // 通配规则（现场口径放在这里，改配置即可，不用改代码）
  let best = "", bestLen = -1;
  for (const [pat, mdl] of Object.entries(mm || {})) {
    if (!pat.endsWith("*")) continue;
    const pn = aoiSqueeze(pat.slice(0, -1));
    if (pn && n.startsWith(pn) && pn.length > bestLen) { best = mdl; bestLen = pn.length; }
  }
  if (best) return { model: best, hit: true, how: "wildcard" };

  // 权威机型集合的最长前缀
  const ms = models !== null ? models : await aoiCanonicalModels();
  best = ""; bestLen = -1;
  for (const m of ms) {
    const mn = aoiSqueeze(m);
    if (mn && n.startsWith(mn) && mn.length > bestLen) { best = m; bestLen = mn.length; }
  }
  if (best) return { model: best, hit: true, how: "prefix" };
  return { model: raw, hit: false, how: "none" };
}

/** 单个程序名归一 → [标准机型, 是否命中] */
export async function aoiResolve(program, models = null, manual = null) {
  const r = await aoiResolveEx(program, models, manual);
  return [r.model, r.hit];
}

/** 批量归一：给一组程序名，返 {程序名: {model, hit}}。只查一次库 */
export async function aoiBuildMap(programs) {
  const models = await aoiCanonicalModels();
  const manual = await aoiManualMap();
  const out = {};
  for (const p of new Set(programs || [])) {
    if (!p) continue;
    out[p] = await aoiResolveEx(p, models, manual);
  }
  return out;
}

/** 标准机型 → 对应的全部程序名（给 SQL 的 IN 过滤用） */
export async function aoiVariants(programs, models = null, manual = null) {
  const mm = manual !== null ? manual : await aoiManualMap();
  const ms = models !== null ? models : await aoiCanonicalModels();
  const out = {};
  for (const p of programs || []) {
    const r = await aoiResolveEx(p, ms, mm);
    if (!out[r.model]) out[r.model] = [];
    out[r.model].push(p);
  }
  return out;
}
