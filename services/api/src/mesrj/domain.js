// ============================================================================
// MES-ruijing W4 领域助手 —— 逐字移植自源 core/seg.py、core/moroute.py、
//   core/eta.py、core/vncode.py、api/route.py（_pick_line/_template_process/
//   _model_process）、api/exec.py（is_sampling/snapshot_route）。
// 全部函数只依赖 pg query，供 mesrj.js 路由层调用。
// ============================================================================
import { query } from "../db.js";

// ── 段（源 core/seg.py）─────────────────────────────────────────────────────
// 分现场段（中文，顺序即机板的打印顺序：AI 段先进机器、贴片段合并上 SMT 产台）
export const SEGS = ["AI段", "贴片段", "插件段", "组装段", "包装段", "辅料"];
export const SEG_EN = { "AI段": "AI", "贴片段": "SMT", "插件段": "DIP", "组装段": "ASM", "包装段": "PACK", "辅料": "AUX" };
export const SEG_ORDER = Object.fromEntries(SEGS.map((s, i) => [s, i]));
export const SEG_LABEL = {
  "AI段": "AI 段（自动插件）", "贴片段": "贴片段（SMT）", "插件段": "插件段（DIP）",
  "组装段": "组装段", "包装段": "包装段", "辅料": "辅料（通用）",
};
// 段 → 工序代码（只供产线逻辑用：路线判断、排班、报表）
export const PROC_OF_SEG = { "AI段": "01", "贴片段": "01", "插件段": "02", "组装段": "03", "包装段": "04", "辅料": "" };
export const SEG_OF_PROC = { "01": ["AI段", "贴片段"], "02": ["插件段"], "03": ["组装段"], "04": ["包装段"] };
// wo_type/历史写法 → 段（一律小写去空格比对）
const WO_TO_SEG = {
  "smt": "贴片段", "贴片": "贴片段", "贴片段": "贴片段",
  "dip": "插件段", "插件": "插件段", "插件段": "插件段",
  "asm": "组装段", "组装": "组装段", "组装段": "组装段",
  "pack": "包装段", "包装": "包装段", "包装段": "包装段",
  "ai": "AI段", "ai段": "AI段",
  "辅": "辅料", "辅料": "辅料",
};
export const AUX_SEG = "辅料";

// 领料分组：谁去领、领几次（源 seg.ISSUE_GROUP/LABEL/ORDER）
export const ISSUE_GROUP = { "AI段": "SMT", "贴片段": "SMT", "插件段": "DIP", "组装段": "ASM", "包装段": "PACK", "辅料": "AUX", "未分段": "NA" };
export const ISSUE_LABEL = { "SMT": "贴片段 + AI段", "DIP": "插件段（DIP）", "ASM": "组装段", "PACK": "包装段", "AUX": "辅料（通用）", "NA": "未分段（BOM 未标段）" };
export const ISSUE_ORDER = { "SMT": 0, "DIP": 1, "ASM": 2, "PACK": 3, "AUX": 4, "NA": 5 };

export function issueGroup(segName, mergeAiSmt = true) {
  const s = (segName || "").trim();
  if (!mergeAiSmt && s === "AI段") return "AI";
  return ISSUE_GROUP[s] ?? "NA";
}
export const issueLabel = g => ISSUE_LABEL[(g || "").trim()] ?? (g || "").trim();
export const issueRank = g => ISSUE_ORDER[(g || "").trim()] ?? 99;

export function segNormalize(v) {
  const k = (v || "").trim().toLowerCase().replace(/\s+/g, "");
  return WO_TO_SEG[k] ?? "";
}
export const segRank = s => SEG_ORDER[(s || "").trim()] ?? 99;
export const segLabel = s => SEG_LABEL[(s || "").trim()] ?? (s || "").trim();
export const segEn = s => SEG_EN[(s || "").trim()] ?? "X";
export const segIsAux = s => (s || "").trim() === AUX_SEG;

// ── 工序名（源 order.py PROC_NAME / SEG_TO_PROC；bom.py SEG_TO_WO）─────────
export const PROC_NAME = { "01": "SMT", "02": "DIP", "03": "组装", "04": "包装" };
export const SEG_TO_PROC = { "贴片段": "01", "AI段": "01", "插件段": "02", "组装段": "03", "包装段": "04" };
export const SEG_TO_WO = { "贴片段": "SMT", "AI段": "SMT", "插件段": "DIP", "组装段": "组装", "包装段": "包装", "辅料": "辅料" };
// BOM 归集 → 半成品组（源 bom.py SEG_TO_SFG / SFG_MAIN_SEG / SFG_ORDER）
export const SEG_TO_SFG = { "贴片段": "SMT", "AI段": "SMT", "插件段": "DIP", "组装段": "组装", "包装段": "包装" };
export const SFG_MAIN_SEG = { "SMT": "贴片段", "DIP": "插件段", "组装": "组装段", "包装": "包装段" };
export const SFG_ORDER = ["SMT", "DIP", "组装", "包装"];
// 路线分段（源 route.py PROC_SEGMENTS）
export const PROC_SEGMENTS = [["01", "SMT 贴片"], ["02", "DIP 插件"], ["03", "组装"], ["04", "包装"]];

// ── 越南码（源 core/vncode.py）──────────────────────────────────────────────
/** {中国料号: 越南码}，只含已维护的 */
export async function vnMapping(codes) {
  const list = [...new Set((codes || []).map(c => (c || "").trim()).filter(Boolean))].sort();
  const out = {};
  for (let i = 0; i < list.length; i += 400) {
    const chunk = list.slice(i, i + 400);
    const ph = chunk.map((_, k) => `$${k + 1}`).join(",");
    const r = await query(
      `SELECT material_code, vn_code FROM md_material WHERE material_code IN (${ph})`, chunk);
    for (const row of r.rows) {
      const v = (row.vn_code || "").trim();
      if (v) out[row.material_code] = v;
    }
  }
  return out;
}

/** 给一组 dict 行补 vn_code 字段（就地复制返回，不改入参） */
export async function vnAttach(rows, key = "material_code") {
  const out = (rows || []).map(r => ({ ...r }));
  const m = await vnMapping(out.map(r => r[key]));
  for (const r of out) r.vn_code = m[(r[key] || "").trim()] ?? "";
  return out;
}

// ── 机型工艺路线（源 api/route.py）──────────────────────────────────────────
function modelToken(model) {
  const m = /^([A-Za-z]+\d+)/.exec((model || "").trim());
  return m ? m[1].toUpperCase() : "";
}

async function stationSampling(stationCode) {
  try {
    const r = await query(
      "SELECT COALESCE(is_sampling,0) AS n FROM md_station WHERE station_code=$1", [stationCode]);
    return Number(r.rows[0]?.n ?? 0) ? 1 : 0;
  } catch { return 0; }
}

/** 某工序选线：历史常用线 → 线名含机型 token → 第一条 */
export async function pickLine(proc, model = "") {
  if (model) {
    const pc = await query(
      "SELECT product_code FROM md_product WHERE product_model=$1 LIMIT 1", [model]);
    const pcode = pc.rows[0]?.product_code;
    if (pcode) {
      const r = await query(
        `SELECT line_code, COUNT(*)::int AS n FROM ord_mo
         WHERE process_code=$1 AND COALESCE(line_code,'')<>'' AND fg_code=$2
         GROUP BY line_code ORDER BY n DESC LIMIT 1`, [proc, pcode]);
      if (r.rows[0]) return r.rows[0].line_code;
    }
    const tok = modelToken(model);
    if (tok) {
      const lines = await query(
        "SELECT line_code, line_name FROM md_line WHERE process_code=$1 ORDER BY line_code", [proc]);
      for (const r of lines.rows) {
        if ((r.line_name || "").toUpperCase().includes(tok)) return r.line_code;
      }
    }
  }
  const r = await query(
    "SELECT line_code FROM md_line WHERE process_code=$1 ORDER BY line_code LIMIT 1", [proc]);
  return r.rows[0]?.line_code ?? "";
}

/** 从各线标准路线拼一条"通用工艺"（每工序按选线取 -STD 路线） */
export async function templateProcess(model = "") {
  const rows = [];
  let seq = 0;
  const seen = new Set();
  for (const [proc] of PROC_SEGMENTS) {
    const lineCode = await pickLine(proc, model);
    if (!lineCode) continue;
    const steps = await query(
      "SELECT * FROM proc_step WHERE route_code=$1 ORDER BY seq_no", [`${lineCode}-STD`]);
    for (const s of steps.rows) {
      if (seen.has(s.station_code)) continue;
      seen.add(s.station_code);
      seq += 10;
      rows.push({
        seq_no: seq, station_code: s.station_code,
        station_name: s.station_name, process_code: s.process_code || proc,
        is_must_pass: Number(s.is_must_pass || 0), remark: s.remark || "",
        enabled: 1, is_sampling: await stationSampling(s.station_code),
      });
    }
  }
  return rows;
}

/** 某机型（某变体）的工艺：自维护 → 无变体回标准 → 模板拼装 */
export async function modelProcess(model, variant = "") {
  variant = (variant || "").trim();
  const sql = `SELECT p.seq_no, p.station_code, p.station_name, p.process_code, p.is_must_pass,
                      COALESCE(p.enabled,1) AS enabled, p.remark,
                      COALESCE(s.is_sampling,0) AS is_sampling
               FROM cfg_model_process p LEFT JOIN md_station s ON s.station_code = p.station_code
               WHERE p.model=$1 AND COALESCE(p.variant,'')=$2 ORDER BY p.seq_no`;
  let rows = (await query(sql, [model, variant])).rows;
  if (rows.length) return [rows, "own"];
  if (variant) {
    rows = (await query(sql, [model, ""])).rows;
    if (rows.length) return [rows, "fallback"];
  }
  return [await templateProcess(model), "template"];
}

/** 只要"启用工位"（停用工位 = 手工过站，不进系统顺序校验） */
export async function modelProcessLive(model, variant = "") {
  const [steps, src] = await modelProcess(model, variant);
  return [steps.filter(x => Number(x.enabled ?? 1) === 1), src];
}

/** 机型工艺 → 4 段 {工序: [工位...]}（源 order.py _model_process_segments） */
export async function modelProcessSegments(model, variant = "") {
  if (!model) return {};
  const [steps] = await modelProcessLive(model, variant);
  const out = {};
  for (const [proc] of PROC_SEGMENTS) {
    out[proc] = steps.filter(x => (x.process_code || "") === proc);
  }
  return out;
}

// ── 总工单（组）路线（源 core/moroute.py）───────────────────────────────────
export const GROUP_LEN = 9; // mo_no 前 9 位 = 总工单号
export const groupKeyOf = moNo => (moNo || "").trim().slice(0, GROUP_LEN);
// 只有 Hi-pot（耐压）NG 才算大修：ICT / FCT / ATE 的 NG 转维修
const KEY_ST_SUFFIX = ["PRESSURETEST", "HIPOT"];

async function stationRetestMap(codes) {
  const st = {};
  if (!codes.length) return st;
  const ph = codes.map((_, i) => `$${i + 1}`).join(",");
  try {
    const r = await query(
      `SELECT station_code, allow_retest, max_retest FROM md_station WHERE station_code IN (${ph})`, codes);
    for (const row of r.rows) st[row.station_code] = row;
  } catch { /* 表还没建/字段缺失时，兜底路线照给 */ }
  return st;
}

/** 工位重测参数：以 md_station 为唯一准绳（缺省 1/2） */
export async function applyStationRetest(steps) {
  const rows = [...(steps || [])];
  const codes = [...new Set(rows.map(x => (x.station_code || "").trim()).filter(Boolean))].sort();
  const st = await stationRetestMap(codes);
  return rows.map(x => {
    const d = { ...x };
    const cfg = st[(d.station_code || "").trim()];
    if (cfg) {
      d.allow_retest = Number(cfg.allow_retest || 0);
      d.max_retest = Number(cfg.max_retest || 0);
    } else {
      d.allow_retest = d.allow_retest ?? 1;
      d.max_retest = d.max_retest ?? 2;
    }
    return d;
  });
}

/** 补齐过站必用字段（is_key_station / is_sampling / 重测参数） */
export async function normalizeSteps(allSteps) {
  const withRetest = await applyStationRetest(allSteps);
  return withRetest.map(d => {
    const c = (d.station_code || "").trim();
    d.is_key_station = d.is_key_station ?? (KEY_ST_SUFFIX.some(s => c.toUpperCase().endsWith(s)) ? 1 : 0);
    d.is_sampling = d.is_sampling ?? 0;
    return d;
  });
}

const groupGet = async groupKey =>
  (await query("SELECT * FROM prd_mo_group_route WHERE group_key=$1", [groupKey])).rows[0] ?? null;

const groupMembers = async groupKey =>
  (await query(
    "SELECT mo_no, process_code, status FROM ord_mo WHERE substr(mo_no,1,9)=$1 ORDER BY process_code",
    [groupKey])).rows;

async function groupFrozen(groupKey) {
  const r = await query(
    "SELECT COUNT(*)::int AS n FROM prd_pass WHERE substr(mo_no,1,9)=$1", [groupKey]);
  const n = Number(r.rows[0]?.n ?? 0);
  return [n > 0, n];
}

/** 写/更新组路线（总路线） */
export async function putGroupRoute(groupKey, model, allSteps, by = "", routeName = "", remark = "") {
  if (!allSteps.length) return null;
  const seqd = allSteps.map((x, i) => ({ ...x, seq_no: (i + 1) * 10 }));
  const snap = JSON.stringify(seqd);
  const slug = modelSlug(model);
  const data = {
    group_key: groupKey, model: model || "",
    route_code: model ? `MP-${slug}` : "",
    route_name: routeName || `${model || ""} 机型总路线`,
    version: "V1.0", snapshot: snap, step_count: seqd.length,
    locked_by: by || "system", locked_at: nowStr(),
    remark: remark || "开单时锁定的机型总路线（总工单共用）",
  };
  const old = await groupGet(groupKey);
  if (old) {
    await query(
      `UPDATE prd_mo_group_route SET model=$2, route_code=$3, route_name=$4, version=$5,
       snapshot=$6, step_count=$7, locked_by=$8, locked_at=$9, remark=$10 WHERE group_key=$1`,
      [groupKey, data.model, data.route_code, data.route_name, data.version,
       data.snapshot, data.step_count, data.locked_by, data.locked_at, data.remark]);
  } else {
    await query(
      `INSERT INTO prd_mo_group_route
       (group_key, model, route_code, route_name, version, snapshot, step_count, locked_by, locked_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [data.group_key, data.model, data.route_code, data.route_name, data.version,
       data.snapshot, data.step_count, data.locked_by, data.locked_at, data.remark]);
  }
  return groupGet(groupKey);
}

/** 把组路线按工序下发到每张分工单（prd_mo_route），返回 {mo_no: 站数} */
export async function writeMembers(groupKey, allSteps, by = "", remark = "总工单路线逐工单下发") {
  const gr = await groupGet(groupKey);
  const segs = {};
  for (const s of allSteps || []) {
    (segs[s.process_code || ""] ??= []).push(s);
  }
  const out = {};
  for (const m of await groupMembers(groupKey)) {
    const proc = m.process_code || "";
    const seg = proc ? (segs[proc] || []) : [...allSteps];
    if (!seg.length) { out[m.mo_no] = 0; continue; }
    const data = {
      mo_no: m.mo_no,
      route_code: (gr?.route_code || "MP") + (proc ? `-${proc}` : ""),
      route_name: proc ? `${gr?.route_name || ""} ${proc}`.trim() : (gr?.route_name || ""),
      version: "V1.0",
      snapshot: JSON.stringify(seg.map((x, i) => ({ ...x, seq_no: (i + 1) * 10 }))),
      step_count: seg.length, is_locked: 1,
      locked_by: by || "system", locked_at: gr?.locked_at || nowStr(),
      remark,
    };
    const old = await query("SELECT mo_no FROM prd_mo_route WHERE mo_no=$1", [m.mo_no]);
    if (old.rows[0]) {
      await query(
        `UPDATE prd_mo_route SET route_code=$2, route_name=$3, version=$4, snapshot=$5,
         step_count=$6, is_locked=$7, locked_by=$8, locked_at=$9, remark=$10 WHERE mo_no=$1`,
        [data.mo_no, data.route_code, data.route_name, data.version, data.snapshot,
         data.step_count, data.is_locked, data.locked_by, data.locked_at, data.remark]);
    } else {
      await query(
        `INSERT INTO prd_mo_route
         (mo_no, route_code, route_name, version, snapshot, step_count, is_locked, locked_by, locked_at, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [data.mo_no, data.route_code, data.route_name, data.version, data.snapshot,
         data.step_count, data.is_locked, data.locked_by, data.locked_at, data.remark]);
    }
    out[m.mo_no] = seg.length;
  }
  return out;
}

/** 锁整组路线（一锁全组）：冻结后拒绝，除非 force */
export async function lockGroup(moNoOrKey, model, allSteps, by = "", routeName = "", force = false) {
  const gk = (moNoOrKey || "").length === GROUP_LEN ? moNoOrKey : groupKeyOf(moNoOrKey);
  const [fz, n] = await groupFrozen(gk);
  if (fz && !force) {
    return { ok: false, group_key: gk, msg: `该总工单已过站 ${n} 片，路线已冻结（追溯凭证）` };
  }
  const norm = await normalizeSteps(allSteps);
  const gr = await putGroupRoute(gk, model, norm, by, routeName);
  const steps = await writeMembers(gk, norm, by);
  return {
    ok: true, group_key: gk, route_code: gr?.route_code || "",
    total: norm.length, steps,
    msg: `已按机型总路线锁定 ${gk}（共 ${norm.length} 站，覆盖 ${Object.keys(steps).length} 张工单）`,
  };
}

// ── 通用小助手 ──────────────────────────────────────────────────────────────
/** 机型 → 路线码片段（源 core/route_order.model_slug：仅字母数字与 -，≤24） */
export function modelSlug(model) {
  let s = (model || "").toUpperCase().trim();
  s = s.replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 24);
}

export function nowStr() {
  // 源 util.now_str()："YYYY-MM-DD HH:MM:SS"（本地时区）
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function todayStr() {
  return nowStr().slice(0, 10);
}

export function ymNow() {
  const d = new Date();
  return [String(d.getFullYear()).slice(2), String(d.getMonth() + 1).padStart(2, "0")];
}

// ── ETA 完工时间预估（源 core/eta.py）───────────────────────────────────────
// 瓶颈段前缀（上料/加工不算段——不是瓶颈时 station_code 也没有段前缀）
const ETA_SEGMENTS = [
  ["SMT", ["SMT-"]],
  ["DIP", ["DIP-"]],
  ["ASSY", ["ASSY-"]],
  ["PACK", ["PACK-"]],
];
const ETA_SEG_OF_PROCESS = {
  "SMT": "SMT", "SMT-PCB1": "SMT", "SMT-PCB2": "SMT",
  "插件": "DIP", "加工": "DIP",
  "组装": "ASSY", "装配": "ASSY",
  "包装": "PACK",
};

function hhmm(s, dflt) {
  const m = /^(\d{1,2}):(\d{2})/.exec((s || "").trim());
  if (!m) return dflt;
  return { h: Number(m[1]), m: Number(m[2]) };
}

async function getParamRaw(key, dflt) {
  const r = await query("SELECT param_val FROM sys_param WHERE param_key=$1", [key]);
  return r.rows[0]?.param_val ?? dflt;
}

async function etaLoadShifts() {
  const eff = {
    DAY: Number(await getParamRaw("plan.hours_day", "10") || 10),
    NIGHT: Number(await getParamRaw("plan.hours_night", "10") || 10),
  };
  const r = await query(
    `SELECT shift_code, shift_name, begin_time, end_time, cross_day FROM md_shift
     WHERE COALESCE(status,1)=1 ORDER BY begin_time`);
  const out = [];
  for (const row of r.rows) {
    const b = hhmm(row.begin_time, { h: 8, m: 0 });
    const e = hhmm(row.end_time, { h: 20, m: 0 });
    let span = (e.h * 60 + e.m - b.h * 60 - b.m) / 60;
    if (span <= 0 || Number(row.cross_day)) span += 24;
    out.push({
      code: row.shift_code, name: row.shift_name || row.shift_code,
      begin: b, span_h: span,
      eff_h: Math.min(eff[row.shift_code] ?? span, span),
    });
  }
  if (!out.length) {
    out.push({ code: "ALL", name: "全天", begin: { h: 0, m: 0 }, span_h: 24, eff_h: 24 });
  }
  return out;
}

async function etaLoadCalendar() {
  const r = await query("SELECT cal_date, is_workday FROM md_calendar");
  const off = new Set(r.rows.filter(x => !Number(x.is_workday)).map(x => x.cal_date));
  return [off, r.rows.length > 0];
}

/** 从 start 起按有效工时推进（班次顺次时间折算），返回预计完成时刻 */
export function etaAddWorkHours(start, hours, shifts, offDays = null, maxDays = 120) {
  if (hours <= 0) return start;
  offDays = offDays || new Set();
  let left = hours;
  const day = new Date(start);
  day.setDate(day.getDate() - 1);
  for (let i = 0; i < maxDays * 2 + 2; i++) {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    if (!offDays.has(key)) {
      for (const sh of shifts) {
        const s0 = new Date(day); s0.setHours(sh.begin.h, sh.begin.m, 0, 0);
        const s1 = new Date(s0.getTime() + sh.span_h * 3600 * 1000);
        if (s1 <= start) continue;
        const a = s0 > start ? s0 : start;
        const avail = (s1 - a) / 3600000;
        if (avail <= 0) continue;
        const rate = sh.span_h ? sh.eff_h / sh.span_h : 1;
        const can = avail * rate;
        if (can >= left) return new Date(a.getTime() + (left / rate) * 3600000);
        left -= can;
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return new Date(start.getTime() + maxDays * 24 * 3600 * 1000);
}

async function etaModelOf(codes) {
  const out = {};
  const list = codes.filter(Boolean);
  for (let i = 0; i < list.length; i += 300) {
    const part = list.slice(i, i + 300);
    const ph = part.map((_, k) => `$${k + 1}`).join(",");
    const r = await query(
      `SELECT product_code, product_model FROM md_product WHERE product_code IN (${ph})`, part);
    for (const row of r.rows) out[row.product_code] = row.product_model || "";
  }
  return out;
}

async function etaSegUph(models) {
  const out = {};
  const ms = models.filter(Boolean);
  for (let i = 0; i < ms.length; i += 300) {
    const part = ms.slice(i, i + 300);
    const ph = part.map((_, k) => `$${k + 1}`).join(",");
    const r = await query(
      `SELECT product_code, process, uph FROM cfg_capacity
       WHERE enabled=1 AND COALESCE(uph,0)>0 AND product_code IN (${ph})`, part);
    for (const row of r.rows) {
      const seg = ETA_SEG_OF_PROCESS[(row.process || "").trim()];
      if (!seg) continue;
      const cur = out[row.product_code] ??= {};
      const u = Number(row.uph);
      cur[seg] = Math.min(cur[seg] ?? u, u);
    }
  }
  return out;
}

async function etaSegDone(moNos) {
  const out = {};
  if (!moNos.length) return out;
  for (let i = 0; i < moNos.length; i += 300) {
    const part = moNos.slice(i, i + 300);
    const ph = part.map((_, k) => `$${k + 1}`).join(",");
    const r = await query(
      `SELECT mo_no, station_code, COUNT(DISTINCT sn)::int AS n FROM prd_pass
       WHERE result='OK' AND mo_no IN (${ph}) GROUP BY mo_no, station_code`, part);
    for (const row of r.rows) {
      let seg = null;
      const sc = row.station_code || "";
      for (const [name, prefixes] of ETA_SEGMENTS) {
        if (sc.startsWith(prefixes[0])) { seg = name; break; }
      }
      if (seg) {
        const d = out[row.mo_no] ??= {};
        d[seg] = (d[seg] ?? 0) + Number(row.n || 0);
      }
    }
  }
  return out;
}

/** 算工单 ETA：{mo_no: {plan_qty, done_qty, left_qty, hours, doneAt, bottleneck, segs, reason}} */
export async function etaCompute(moNos = null, now = null) {
  now = now || new Date();
  let where = "", args = [];
  if (moNos) {
    moNos = moNos.filter(Boolean);
    if (!moNos.length) return {};
    where = ` AND m.mo_no IN (${moNos.map((_, i) => `$${i + 1}`).join(",")})`;
    args = moNos;
  } else {
    where = " AND m.status='生产中'";
  }
  const rows = (await query(
    `SELECT m.mo_no, m.product_code, m.plan_qty, m.status,
            COALESCE(p.product_model,'') AS product_model
     FROM ord_mo m LEFT JOIN md_product p ON p.product_code=m.product_code
     WHERE 1=1${where}`, args)).rows;
  if (!rows.length) return {};

  const modelMap = await etaModelOf(rows.map(r => r.product_code));
  const uphMap = await etaSegUph([...new Set(Object.values(modelMap))]);
  const doneMap = await etaSegDone(rows.map(r => r.mo_no));
  const shifts = await etaLoadShifts();
  const [offDays, calOn] = await etaLoadCalendar();

  const out = {};
  for (const r of rows) {
    const mo = r.mo_no;
    const model = modelMap[r.product_code] || r.product_model || "";
    const planQty = Number(r.plan_qty || 0);
    const uphs = uphMap[model] || {};
    const done = doneMap[mo] || {};
    const order = ETA_SEGMENTS.map(([s]) => s);
    let doneQty = 0;
    for (const seg of [...order].reverse()) {
      if (seg in done) { doneQty = done[seg]; break; }
    }
    const left = Math.max(0, planQty - doneQty);
    const segs = [];
    for (const seg of order) {
      const u = uphs[seg];
      if (!u) continue;
      const d = Number(done[seg] ?? 0);
      const segLeft = Math.max(0, planQty - d);
      segs.push({ seg, uph: Math.round(u), done: d, left: segLeft, hours: u ? Math.round(segLeft / u * 10) / 10 : null });
    }
    segs.sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0));
    const item = {
      mo_no: mo, model, plan_qty: planQty, done_qty: doneQty, left_qty: left,
      segs, hours: null, done_at: null, bottleneck: null, reason: "",
    };
    if (planQty <= 0) {
      item.reason = "计划数量为 0（常驻池工单请按实际投产数领料，无法预估）";
    } else if (!segs.length) {
      item.reason = `机型「${model || "未知"}」没有维护 UPH（产能标准 → 产能标准维护）`;
    } else if (left <= 0) {
      item.hours = 0; item.done_at = now; item.reason = "已全部完成";
    } else {
      const b = segs[0];
      item.hours = b.hours;
      item.bottleneck = b.seg;
      item.done_at = etaAddWorkHours(now, b.hours, shifts, offDays);
      if (!calOn) item.reason = "未设工作日历（默认每天都开工）";
    }
    out[mo] = item;
  }
  return out;
}

// ============================================================================
// 工单与开单机制（源 api/order.py）
// ============================================================================

export async function latestBomVersion(productCode) {
  const r = await query(
    `SELECT version FROM bom_header WHERE product_code=$1 AND status='有效'
     ORDER BY version DESC LIMIT 1`, [productCode]);
  return r.rows[0]?.version ?? "";
}

/** 该产品 BOM 里的全部半成品料号（按段序排，产出物扩展集合） */
export async function allSfg(productCode, version) {
  const r = await query(
    `SELECT material_code, segment FROM bom_item
     WHERE product_code=$1 AND version=$2 AND item_type='SFG'`, [productCode, version]);
  r.rows.sort((a, b) => (segRank(segNormalize(a.segment)) - segRank(segNormalize(b.segment)))
    || a.material_code.localeCompare(b.material_code));
  return r.rows.map(x => x.material_code);
}

/** 组装工单号：9 位 YY+MM+类型+流水，多批 -1/-2（源 _mo_no_all） */
export function moNoAll(yy, mm, typeCode, seq, batch = null) {
  const base = `${yy}${mm}${typeCode}${seq}`;
  return batch === null ? base : `${base}-${batch}`;
}

/** 下一炉（下一张单要占用的）流水号——只看不占，用于预览 */
export async function peekNextSeq(yy, mm, typeCode) {
  const r = await query(
    `SELECT MAX(CAST(seq_no AS INTEGER)) AS mx FROM ord_mo_seq
     WHERE yy=$1 AND mm=$2 AND type_code=$3`, [yy, mm, typeCode]);
  const mx = Number(r.rows[0]?.mx ?? 0);
  return String(mx + 1).padStart(4, "0");
}

/** 取流水号：同 PO 同产品复用已有号；force_new 时新占一个（源 next_mo_seq） */
export async function nextMoSeq(yy, mm, typeCode, poNo, productCode, forceNew = true) {
  if (!forceNew) {
    const r = await query(
      `SELECT seq_no FROM ord_mo_seq WHERE yy=$1 AND mm=$2 AND type_code=$3
       AND po_no=$4 AND product_code=$5`, [yy, mm, typeCode, poNo, productCode]);
    if (r.rows[0]) return r.rows[0].seq_no;
  }
  const seq = await peekNextSeq(yy, mm, typeCode);
  await query(
    `INSERT INTO ord_mo_seq (yy, mm, type_code, seq_no, po_no, product_code)
     VALUES ($1,$2,$3,$4,$5,$6)`, [yy, mm, typeCode, seq, poNo, productCode]);
  return seq;
}

/** 开单前预览工单号（不占号） */
export async function previewCreate(productCode, typeCode, poNo, nBatches = 1) {
  const [yy, mm] = ymNow();
  let seq = null, will = false;
  if (poNo) {
    const r = await query(
      `SELECT seq_no FROM ord_mo_seq WHERE yy=$1 AND mm=$2 AND type_code=$3
       AND po_no=$4 AND product_code=$5`, [yy, mm, typeCode, poNo, productCode]);
    seq = r.rows[0]?.seq_no ?? null;
  }
  if (!seq) { seq = await peekNextSeq(yy, mm, typeCode); will = true; }
  const n = Math.max(1, Number(nBatches || 1));
  const mos = [];
  for (let i = 0; i < n; i++) mos.push(moNoAll(yy, mm, typeCode, seq, n > 1 ? i + 1 : null));
  return { yy, mm, seq_no: seq, will_allocate: will, type_code: typeCode, mo_nos: mos };
}

/** 该工序工单的产出物：成品或对应半成品（源 _output_of） */
export async function outputOf(productCode, processCode) {
  const wo = PROC_NAME[processCode] ?? "";
  if (!wo || wo === "包装") return [productCode, [productCode]];
  const ver = await latestBomVersion(productCode);
  if (!ver) return [productCode, [productCode]];
  const r = await query(
    `SELECT material_code FROM bom_item WHERE product_code=$1 AND version=$2
     AND item_type='SFG' AND wo_type=$3 ORDER BY seq_no`, [productCode, ver, wo]);
  if (!r.rows.length) return [productCode, [productCode]];
  return [r.rows[0].material_code, r.rows.map(x => x.material_code)];
}

/** 预览一炉多段工单号（旧分段子接口，页面看 11 位分段号用） */
export async function previewMoNos(productCode, typeCode, poNo, procs) {
  const [yy, mm] = ymNow();
  let seq = null, willAllocate = false;
  if (poNo) {
    const r = await query(
      `SELECT seq_no FROM ord_mo_seq WHERE yy=$1 AND mm=$2 AND type_code=$3
       AND po_no=$4 AND product_code=$5`, [yy, mm, typeCode, poNo, productCode]);
    seq = r.rows[0]?.seq_no ?? null;
  }
  if (!seq) { seq = await peekNextSeq(yy, mm, typeCode); willAllocate = true; }
  const items = [];
  for (const p of procs) {
    if (!(p in PROC_NAME)) continue;
    const [outMain, outAll] = await outputOf(productCode, p);
    items.push({
      process_code: p, name: PROC_NAME[p] ?? p,
      mo_no: `${yy}${mm}${typeCode}${seq}${p}`,
      product_code: outMain, output_codes: outAll, fg_code: productCode,
    });
  }
  return { yy, mm, seq_no: seq, will_allocate: willAllocate, type_code: typeCode, items };
}

/** 常驻池：同产品未结的常驻工单（同产品只允许一张） */
async function poolMoOf(productCode) {
  const r = await query(
    `SELECT mo_no, plan_qty, status FROM ord_mo
     WHERE product_code=$1 AND is_pool=1
       AND COALESCE(status,'') NOT IN ('已完工','已关闭','作废')
     ORDER BY id DESC LIMIT 1`, [productCode]);
  return r.rows[0] ?? null;
}

/** 产品 → 预配线路/路线（源 _product_route_map） */
export async function productRouteMap(productCode) {
  const r = await query(
    `SELECT process_code, line_code, route_code FROM cfg_product_route WHERE product_code=$1`,
    [productCode]).catch(() => ({ rows: [] }));
  const lm = {}, rm = {};
  for (const row of r.rows) {
    if (row.line_code) lm[row.process_code] = row.line_code;
    if (row.route_code) rm[row.process_code] = row.route_code;
  }
  return [lm, rm];
}

/** 开单时把机型工艺直接写成工单路线（源 _lock_mo_route_steps） */
export async function lockMoRouteSteps(moNo, steps, routeCode, routeName, by = "") {
  if (!steps.length) return 0;
  const snap = await normalizeSteps(await Promise.all(steps.map(async (x, i) => ({
    seq_no: i * 10, process_code: x.process_code || "",
    station_code: x.station_code,
    station_name: x.station_name || x.station_code,
    is_must_pass: Number(x.is_must_pass || 0),
    is_sampling: await stationSampling(x.station_code),
    remark: x.remark || "",
  }))));
  const data = {
    mo_no: moNo, route_code: routeCode, route_name: routeName,
    version: "V1.0", snapshot: JSON.stringify(snap), step_count: snap.length,
    is_locked: 1, locked_by: by || "系统", locked_at: nowStr(),
    remark: "开单时按机型工艺路线锁定",
  };
  const old = await query("SELECT mo_no FROM prd_mo_route WHERE mo_no=$1", [moNo]);
  if (old.rows[0]) {
    await query(
      `UPDATE prd_mo_route SET route_code=$2, route_name=$3, version=$4, snapshot=$5,
       step_count=$6, is_locked=$7, locked_by=$8, locked_at=$9, remark=$10 WHERE mo_no=$1`,
      [data.mo_no, data.route_code, data.route_name, data.version, data.snapshot,
       data.step_count, data.is_locked, data.locked_by, data.locked_at, data.remark]);
  } else {
    await query(
      `INSERT INTO prd_mo_route
       (mo_no, route_code, route_name, version, snapshot, step_count, is_locked, locked_by, locked_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [data.mo_no, data.route_code, data.route_name, data.version, data.snapshot,
       data.step_count, data.is_locked, data.locked_by, data.locked_at, data.remark]);
  }
  return snap.length;
}

/** 开单时按产品路线库锁定（源 _lock_mo_route） */
export async function lockMoRoute(moNo, routeCode, by = "") {
  const rt = (await query("SELECT * FROM proc_route WHERE route_code=$1", [routeCode])).rows[0];
  if (!rt) return 0;
  const steps = await snapshotRoute(routeCode);
  if (!steps.length) return 0;
  const data = {
    mo_no: moNo, route_code: rt.route_code, route_name: rt.route_name,
    version: rt.version || "V1.0", snapshot: JSON.stringify(steps),
    step_count: steps.length, is_locked: 1,
    locked_by: by || "系统", locked_at: nowStr(),
    remark: "开单时按产品路线库锁定",
  };
  const old = await query("SELECT mo_no FROM prd_mo_route WHERE mo_no=$1", [moNo]);
  if (old.rows[0]) {
    await query(
      `UPDATE prd_mo_route SET route_code=$2, route_name=$3, version=$4, snapshot=$5,
       step_count=$6, is_locked=$7, locked_by=$8, locked_at=$9, remark=$10 WHERE mo_no=$1`,
      [data.mo_no, data.route_code, data.route_name, data.version, data.snapshot,
       data.step_count, data.is_locked, data.locked_by, data.locked_at, data.remark]);
  } else {
    await query(
      `INSERT INTO prd_mo_route
       (mo_no, route_code, route_name, version, snapshot, step_count, is_locked, locked_by, locked_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [data.mo_no, data.route_code, data.route_name, data.version, data.snapshot,
       data.step_count, data.is_locked, data.locked_by, data.locked_at, data.remark]);
  }
  return steps.length;
}

/** 路线快照（源 exec.snapshot_route：proc_step + 工位重测参数） */
export async function snapshotRoute(routeCode) {
  const r = await query("SELECT * FROM proc_step WHERE route_code=$1 ORDER BY seq_no", [routeCode]);
  if (!r.rows.length) return [];
  return applyStationRetest(r.rows.map(s => ({
    seq_no: s.seq_no, station_code: s.station_code, station_name: s.station_name,
    process_code: s.process_code, is_must_pass: s.is_must_pass,
    is_sampling: s.is_sampling ?? 0, remark: s.remark,
  })));
}

/** 工位是否抽检站（源 exec.is_sampling，简化为直查） */
export async function isSampling(stationCode) {
  return stationSampling(stationCode);
}

export { stationSampling };

/** 同产线是否已有"生产中"工单（源 core/mo.line_busy_mo） */
export async function lineBusyMo(moNo) {
  const mo = (await query(
    "SELECT mo_no, line_code, product_code FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
  if (!mo || !(mo.line_code || "")) return null;
  const busy = (await query(
    `SELECT mo_no, product_code, status FROM ord_mo
     WHERE line_code=$1 AND status='生产中' AND mo_no<>$2 ORDER BY id DESC LIMIT 1`,
    [mo.line_code, moNo])).rows[0];
  if (!busy) return null;
  busy.line_code = mo.line_code;
  return busy;
}

/**
 * 一 PO 一张总工单（源 create_mo_all）：batches=[{qty, plan_end}] 时开多批。
 * 返回 {seq, created, exists}；created 每项含 mo_no/plan_qty/segs/steps。
 */
export async function createMoAll({
  productCode, planQty, typeCode, batches = null,
  poNo = "", poLine = "1", custCode = "", planStart = "", planEnd = "",
  remark = "", srcMoNo = "", createdBy = "", syncPlan = false,
  segLines = null, routeMap = null, variant = "", isPool = false,
}) {
  const [yy, mm] = ymNow();
  const seq = await nextMoSeq(yy, mm, typeCode, poNo, productCode, true);
  const ver = await latestBomVersion(productCode);
  if (!ver) return { seq, created: [], exists: [{ error: `产品 ${productCode} 没有有效版 BOM` }] };

  const sfg = await allSfg(productCode, ver);
  // 组装段/包装段直接挂在成品 BOM 下的（成品自己也算扩展集合）
  const roots = [...sfg];
  if (!roots.includes(productCode)) roots.push(productCode);
  const segsAll = [];
  for (const code of roots) {
    const r = await query(
      `SELECT DISTINCT segment FROM bom_item WHERE product_code=$1 AND COALESCE(item_type,'RM')<>'SFG'`,
      [code]);
    for (const row of r.rows) {
      const s = segNormalize(row.segment);
      if (s && !segsAll.includes(s)) segsAll.push(s);
    }
  }
  segsAll.sort((a, b) => segRank(a) - segRank(b));

  // 批次：没有就一张单全量
  const bl = [];
  if (batches) {
    for (let i = 0; i < batches.length; i++) {
      const q = Number(batches[i]?.qty || 0);
      if (q <= 0) return { seq, created: [], exists: [{ error: `第 ${i + 1} 批数量必须大于 0` }] };
      bl.push({
        qty: q, plan_end: (batches[i]?.plan_end || planEnd || "").trim(),
        line_map: batches[i]?.line_map || {},
      });
    }
    const sum = bl.reduce((a, x) => a + x.qty, 0);
    if (sum !== Number(planQty || 0)) {
      return { seq, created: [], exists: [{ error: `批次数量合计 ${sum} 与计划数量 ${Number(planQty || 0)} 不一致` }] };
    }
  } else {
    bl.push({ qty: Number(planQty || 0), plan_end: planEnd, line_map: {} });
  }

  let model = "";
  const p0 = await query(
    "SELECT product_model FROM md_product WHERE product_code=$1", [productCode]);
  if (p0.rows[0]) model = p0.rows[0].product_model || "";
  let modelSegs = model ? await modelProcessSegments(model, variant) : {};
  if (modelSegs && !["01", "02", "03", "04"].some(p => modelSegs[p]?.length)) modelSegs = {};

  const created = [], exists = [];
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i];
    const moNo = moNoAll(yy, mm, typeCode, seq, bl.length > 1 ? i + 1 : null);
    const dup = await query("SELECT id FROM ord_mo WHERE mo_no=$1", [moNo]);
    if (dup.rows[0]) { exists.push(moNo); continue; }
    const lm = { ...(segLines || {}), ...(b.line_map || {}) };
    const line = lm["01"] || lm["贴片段"] || "";
    const status = syncPlan && line ? "已排产" : "待排产";
    await query(
      `INSERT INTO ord_mo
       (mo_no, yy, mm, type_code, seq_no, process_code, wo_type, po_no, po_line, cust_code,
        fg_code, output_codes, product_code, plan_qty, line_code, plan_start, plan_end,
        status, src_mo_no, variant, is_pool, remark, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [moNo, yy, mm, typeCode, seq, "", "总装", poNo, poLine || "1", custCode,
       productCode, roots.join(","), productCode, b.qty, line,
       planStart || "", b.plan_end || "", status, srcMoNo || "",
       variant || "", isPool ? 1 : 0, remark || "", createdBy || ""]);
    // 分段记录（排产/产出/进度都挂这里）
    for (const s of segsAll) {
      await query(
        `INSERT INTO ord_mo_seg
         (mo_no, segment, seg_no, line_code, plan_qty, out_qty, ng_qty, status, plan_start, plan_end, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,$8,$9,$9)`,
        [moNo, s, segRank(s),
         lm[PROC_OF_SEG[s] ?? ""] || lm[s] || "",
         b.qty, "待排产", planStart || "", b.plan_end || "", nowStr()]);
    }
    // 路线：机型工艺全流程（4 段拼总），再按组锁一次
    let steps = [];
    for (const p of ["01", "02", "03", "04"]) steps.push(...(modelSegs[p] || []));
    let nstep = steps.length
      ? await lockMoRouteSteps(moNo, steps, "MO-ALL", "机型全流程", createdBy) : 0;
    if (!nstep) {
      const rc = routeMap?.all || routeMap?.["00"] || "";
      if (rc) nstep = await lockMoRoute(moNo, rc, createdBy);
    }
    if (status === "已排产") {
      const date = planStart || todayStr();
      const mx = await query(
        "SELECT MAX(seq_no) AS m FROM pln_schedule WHERE plan_date=$1 AND line_code=$2", [date, line]);
      await query(
        `INSERT INTO pln_schedule
         (plan_date, shift_code, line_code, mo_no, product_code, plan_qty, seq_no, status, remark, created_by)
         VALUES ($1,'DAY',$2,$3,$4,$5,$6,'计划中','开单时同步排产',$7)`,
        [date, line, moNo, productCode, b.qty, Number(mx.rows[0]?.m ?? 0) + 1, createdBy || ""]);
    }
    created.push({
      mo_no: moNo, plan_qty: b.qty, line_code: line, status,
      segs: segsAll, steps: nstep, product_code: productCode,
    });
  }
  // 总工单组路线：一锁全组（同 seq 的多批共用一份总路线）
  if (created.length && modelSegs) {
    const groupSteps = [];
    for (const p of ["01", "02", "03", "04"]) groupSteps.push(...(modelSegs[p] || []));
    if (groupSteps.length) {
      const gk = groupKeyOf(created[0].mo_no);
      const r = await lockGroup(gk, model, groupSteps, createdBy);
      if (r.ok) {
        for (const it of created) {
          it.route_code = (r.route_code || "MP");
          it.steps = r.steps[it.mo_no] ?? it.steps;
        }
      }
    }
  }
  return { seq, created, exists };
}

// ============================================================================
// 领料机制（源 api/order.py 下半部）
// ============================================================================

/** 领料排除料号清单（参数 bom.issue_exclude，逗号/中文逗号分隔） */
async function issueExclude() {
  const v = await getParamRaw("bom.issue_exclude", "").catch(() => "");
  return new Set(v.replace(/，/g, ",").split(",").map(x => x.trim()).filter(Boolean));
}

/** 强制改段（参数 bom.seg_override，格式 料号=段,料号=段） */
async function segOverride() {
  const v = await getParamRaw("bom.seg_override", "").catch(() => "");
  const out = {};
  for (let part of v.replace(/，/g, ",").split(",")) {
    part = part.trim();
    if (!part || !part.includes("=")) continue;
    const [k, s] = part.split("=");
    if (k.trim() && s.trim()) out[k.trim()] = s.trim();
  }
  return out;
}

/** BOM 明细聚合（源 _merge_rows）：替代组合并 + 多位号归集 */
export function mergeRows(rows, bySeg = false) {
  if (!rows || !rows.length) return [];
  // 先找出真正的替代组（组内 >=2 行且至少 1 行 is_alt=1）
  const byGroup = {};
  for (const it of rows) {
    const ag = (it.alt_group || "").trim();
    if (ag) (byGroup[ag] ??= []).push(it);
  }
  const realAlt = new Set(Object.entries(byGroup)
    .filter(([, lst]) => lst.length >= 2 && lst.some(x => Number(x.is_alt || 0)))
    .map(([ag]) => ag));

  const groups = new Map();
  for (const it of rows) {
    const ag = (it.alt_group || "").trim();
    const isAlt = !!Number(it.is_alt || 0);
    const sg = bySeg ? (segNormalize(it.segment) || "") : "";
    const key = ag && realAlt.has(ag) ? `ALT|${ag}|${sg}` : `MAT|${it.material_code}|${sg}`;
    let g = groups.get(key);
    if (!g) {
      g = { main: null, qty: 0, alts: new Set(), alt_qty: {}, pos: [], mpq: 1, row: it, group: key.startsWith("ALT") ? ag : "", sg };
      groups.set(key, g);
    }
    const q = Number(it.qty_per || 0);
    if (isAlt) {
      g.alts.add(it.material_code);
      g.alt_qty[it.material_code] = q;
    } else {
      if (!g.main) g.main = it;
      g.qty += q;
    }
    const pos = (it.pos_ref || "").trim();
    if (pos && !g.pos.includes(pos) && !(isAlt && pos.endsWith("（代）"))) {
      if (isAlt) g.pos.push(pos); else g.pos.unshift(pos);
    }
    if (Number(it.mpq || 1) > g.mpq) g.mpq = Number(it.mpq || 1);
  }

  const out = [];
  for (const g of groups.values()) {
    const it = g.main || g.row;
    const qty = g.main ? g.qty : Number(it.qty_per || 0);
    let alts = [...g.alts].sort();
    if (!g.main) alts = alts.filter(c => c !== it.material_code);
    out.push({
      material_code: it.material_code,
      material_name: it.material_name,
      spec: it.spec, unit: it.unit || "PCS",
      segment: (it.segment || "").trim(),
      qty_per: Math.round(qty * 1e6) / 1e6,
      pos_ref: g.pos.slice(0, 10).join("，"),
      alt_list: alts.join("，").slice(0, 300),
      alt_qty: g.alt_qty,
      alt_group: g.group,
      mpq: g.mpq || 1,
    });
  }
  out.sort((a, b) => (segRank(a.segment) - segRank(b.segment))
    || a.material_code.localeCompare(b.material_code));
  return out;
}

/** 按工序取 BOM 明细并聚合（源 _agg_bom_items） */
export async function aggBomItems(productCode, version, processCode, outputCodes = "") {
  let codes = (outputCodes || "").split(",").map(c => c.trim()).filter(Boolean);
  if (!codes.length) {
    const prod = (await query(
      "SELECT product_type FROM md_product WHERE product_code=$1", [productCode])).rows[0];
    if (prod && (prod.product_type || "") === "SFG") {
      codes = [productCode];
    } else {
      const wo = PROC_NAME[processCode] ?? "";
      if (wo) {
        const sfg = await query(
          `SELECT material_code FROM bom_item WHERE product_code=$1 AND version=$2
           AND item_type='SFG' AND wo_type=$3 ORDER BY seq_no`, [productCode, version, wo]);
        codes = sfg.rows.map(r => r.material_code);
      }
    }
  }
  let rows;
  if (codes.length) {
    const ph = codes.map((_, i) => `$${i + 1}`).join(",");
    rows = (await query(
      `SELECT * FROM bom_item WHERE COALESCE(item_type,'RM')<>'SFG' AND product_code IN (${ph})
       ORDER BY material_code`, codes)).rows;
  } else {
    // 单层（没有半制品的简单 BOM）：按段的工序归属取
    const segs = Object.entries(SEG_TO_PROC).filter(([, p]) => p === processCode).map(([s]) => s);
    if (!segs.length) return [];
    const ph = segs.map((_, i) => `$${i + 3}`).join(",");
    rows = (await query(
      `SELECT * FROM bom_item WHERE product_code=$1 AND version=$2
       AND COALESCE(item_type,'RM')<>'SFG' AND segment IN (${ph}) ORDER BY material_code`,
      [productCode, version, ...segs])).rows;
  }
  return mergeRows(rows);
}

/** 全料 BOM 按段分组：每段一张领料单（源 _agg_bom_by_seg） */
export async function aggBomBySeg(productCode, version, outputCodes = "") {
  let codes = (outputCodes || "").split(",").map(c => c.trim()).filter(Boolean);
  if (!codes.length) codes = await allSfg(productCode, version) || [productCode];
  if (productCode && !codes.includes(productCode)) codes.push(productCode);
  const ph = codes.map((_, i) => `$${i + 1}`).join(",");
  const rows = (await query(
    `SELECT * FROM bom_item WHERE COALESCE(item_type,'RM')<>'SFG' AND product_code IN (${ph})
     ORDER BY material_code`, codes)).rows;
  const ov = await segOverride();
  if (Object.keys(ov).length) {
    for (const r of rows) {
      const s0 = ov[(r.material_code || "").trim()];
      if (s0) r.segment = s0;
    }
  }
  const ex = await issueExclude();
  const out = {};
  for (const it of mergeRows(rows, true)) {
    if (ex.size && ex.has(it.material_code)) continue;
    const s = segNormalize(it.segment) || "";
    (out[s || "未分段"] ??= []).push(it);
  }
  return out;
}

/** 写一张领料单明细（按 MPQ 向上取整，KG/L/M/G 保留小数） */
export async function writeIssueItems(issueNo, items, qty) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const need = it.qty_per * qty;
    const mpq = it.mpq || 1;
    const issueQty = ["KG", "L", "M", "G"].includes(it.unit)
      ? Math.round(need * 1e4) / 1e4
      : (mpq ? Math.ceil(need / mpq) * mpq : Math.round(need));
    await query(
      `INSERT INTO ord_issue_item
       (issue_no, material_code, main_code, is_substitute, material_name, spec, unit,
        segment, qty_per, need_qty, mpq, issue_qty, pos_ref, alt_list, line_seq)
       VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [issueNo, it.material_code, it.material_code, it.material_name, it.spec, it.unit,
       it.segment || "", it.qty_per, Math.round(need * 1e4) / 1e4, mpq, issueQty,
       it.pos_ref, it.alt_list, i + 1]);
  }
}

/** 下一张领料单流水基号（11 位，无段后缀：LL261031001） */
export async function nextIssueBase() {
  const d = todayStr().replace(/-/g, "").slice(2);
  const prefix = `LL${d}`;
  const r = await query(
    `SELECT MAX(CAST(SUBSTRING(issue_no, 9, 3) AS INTEGER)) AS mx FROM ord_issue
     WHERE issue_no LIKE $1`, [`${prefix}%`]);
  const mx = Number(r.rows[0]?.mx ?? 0);
  return `${prefix}${String(mx + 1).padStart(3, "0")}`;
}

/**
 * 为一张工单生成领料单（源 create_issue_for_mo）：
 * 分段总工单 → 按段拆多张（LL...-SMT / -AI / -DIP / -ASM / -PACK / -AUX）；
 * 老式分段工单 → 一张单。返回 {ok, data, msg}。
 * qty：常驻池工单必须传实际投产数（没有计划数量）。
 */
export async function createIssueForMo(moNo, user = "", force = false, qty = null) {
  moNo = (moNo || "").trim();
  const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
  if (!mo) return { ok: false, msg: `找不到工单：${moNo}` };
  let qtyReq = Number(qty || 0);
  if (qtyReq <= 0) qtyReq = Number(mo.plan_qty || 0);
  if (qtyReq <= 0) {
    return { ok: false, msg: "该工单没有计划数量（常驻池工单请传入实际投产数再生成领料单）" };
  }
  const proc = (mo.process_code || "").trim();
  const oc = mo.output_codes ?? "";

  // ── 老式分段工单（process_code 非空）→ 一张单 ──
  if (proc) {
    const has = await query(
      "SELECT id FROM ord_issue WHERE mo_no=$1 AND status<>'作废'", [moNo]);
    if (has.rows[0] && !force) {
      return { ok: false, msg: "该工单已有领料单（如需重开请勾选「强制重开」）" };
    }
    const ver = await latestBomVersion(mo.product_code);
    if (!ver) return { ok: false, msg: `产品 ${mo.product_code} 没有有效版 BOM` };
    const items = await aggBomItems(mo.product_code, ver, proc, oc);
    if (!items.length) {
      return { ok: false, msg: `该工单（${PROC_NAME[proc] ?? proc}）在 BOM 里没有对应物料，请检查 BOM 分段` };
    }
    const issueNo = await nextIssueBase();
    await query(
      `INSERT INTO ord_issue
       (issue_no, mo_no, wo_type, segment, line_code, issue_type, apply_qty, status, created_by)
       VALUES ($1,$2,$3,'',$4,'整单领料',$5,'待确认',$6)`,
      [issueNo, moNo, mo.wo_type, mo.line_code, qtyReq, user]);
    await writeIssueItems(issueNo, items, qtyReq);
    await auditSafe(user, "领料", "生成领料单", issueNo,
      `${moNo} / ${PROC_NAME[proc] ?? ""} / ${items.length} 行`);
    return {
      ok: true, data: { issue_no: issueNo, rows: items.length, issue_nos: [issueNo] },
      msg: `已生成领料单 ${issueNo}（${items.length} 行物料）`,
    };
  }

  // ── 一 PO 一单（按段拆 N 张）──
  const fg = (mo.fg_code || mo.product_code || "").trim();
  const ver = await latestBomVersion(fg);
  if (!ver) return { ok: false, msg: `产品 ${fg} 没有有效版 BOM` };
  const bySeg = await aggBomBySeg(fg, ver, oc);
  if (!Object.keys(bySeg).length) {
    return { ok: false, msg: "该工单的 BOM 里没有可领物料，请检查 BOM 是否已维护" };
  }
  const mergeAi = String(await getParamRaw("issue.merge_ai_smt", "1")).trim().toLowerCase() !== "0";
  const groups = {};
  for (const [s, items] of Object.entries(bySeg)) {
    const gk = issueGroup(s, mergeAi);
    const slot = groups[gk] ??= { segs: [], items: [] };
    slot.segs.push(s);
    slot.items.push(...items);
  }
  const have = new Set();
  for (const r of (await query(
    "SELECT COALESCE(segment,'') AS s FROM ord_issue WHERE mo_no=$1 AND status<>'作废'", [moNo])).rows) {
    const v = (r.s || "").trim();
    if (!v) continue;
    have.add(ISSUE_LABEL[v] ? v : issueGroup(v, mergeAi));
  }
  const segLines = {};
  for (const r of (await query(
    "SELECT segment, line_code FROM ord_mo_seg WHERE mo_no=$1", [moNo])).rows) {
    segLines[r.segment] = r.line_code || "";
  }
  const issueQty0 = qtyReq;
  const base = await nextIssueBase();
  const made = [], skipped = [];
  const gks = Object.keys(groups).sort((a, b) => (issueRank(a) - issueRank(b)) || a.localeCompare(b));
  for (const gk of gks) {
    if (have.has(gk) && !force) { skipped.push(issueLabel(gk)); continue; }
    const issueNo = `${base}-${gk}`;
    const dup = await query("SELECT id FROM ord_issue WHERE issue_no=$1", [issueNo]);
    if (dup.rows[0] && !force) { skipped.push(issueLabel(gk)); continue; }
    const isAux = gk === "AUX" || gk === "NA";
    let line = "";
    for (const s0 of groups[gk].segs) {
      if (segLines[s0]) { line = segLines[s0]; break; }
    }
    await query(
      `INSERT INTO ord_issue
       (issue_no, mo_no, wo_type, segment, line_code, issue_type, apply_qty, status, created_by)
       VALUES ($1,$2,'总装',$3,$4,$5,$6,'待确认',$7)`,
      [issueNo, moNo, gk,
       isAux ? "" : (line || mo.line_code || ""),
       isAux ? "辅料领料" : "分段领料", issueQty0, user]);
    await writeIssueItems(issueNo, groups[gk].items, issueQty0);
    made.push({ issue_no: issueNo, segment: gk, label: issueLabel(gk), segs: groups[gk].segs, rows: groups[gk].items.length });
  }
  if (!made.length) {
    return { ok: false, msg: `没有生成新领料单（已存在：${skipped.join("、")}）；如需重开请勾选「强制重开」` };
  }
  await auditSafe(user, "领料", "生成多段领料单", moNo,
    `${made.length} 张 / ${made.reduce((a, m) => a + m.rows, 0)} 行`);
  let msg = `共生成 ${made.length} 张领料单：${made.map(m => `${m.label}(${m.rows}行)`).join("、")}`;
  if (skipped.length) msg += `；已存在跳过：${skipped.join("、")}`;
  return {
    ok: true,
    data: { mo_no: moNo, items: made, issue_nos: made.map(m => m.issue_no), rows: made.reduce((a, m) => a + m.rows, 0) },
    msg,
  };
}

/** 审计的容错包装（domain.js 里没有 g 上下文，失败不阻断业务） */
export async function auditSafe(user, module, action, target, detail = "") {
  try {
    const { audit } = await import("../routes/mesrj.js");
    await audit(user, module, action, target, detail);
  } catch { /* 审计失败不影响业务 */ }
}

/** 工单 → {料号: 段}（含半成品扩展 BOM；源 _seg_map_for_mo） */
export async function segMapForMo(mo) {
  if (!mo) return {};
  const fg = mo.fg_code || mo.product_code;
  const ver = await latestBomVersion(fg);
  if (!ver) return {};
  let codes = (mo.output_codes || "").split(",").map(c => c.trim()).filter(Boolean);
  if (!codes.length) {
    const [, oc] = await outputOf(fg, mo.process_code);
    codes = oc;
  }
  codes = codes.length ? codes : [fg];
  const ph = codes.map((_, i) => `$${i + 1}`).join(",");
  const rows = (await query(
    `SELECT material_code, segment FROM bom_item WHERE product_code IN (${ph})
     AND COALESCE(item_type,'RM')<>'SFG' AND version=$${codes.length + 1}`,
    [...codes, ver])).rows;
  const out = {};
  for (const r of rows) out[r.material_code] = (r.segment || "").trim();
  return out;
}

/** 领料单没有段列时按 BOM 补齐并重排队号（幂等；源 _backfill_issue_segments） */
export async function backfillIssueSegments(issueNo, mo) {
  const smap = await segMapForMo(mo);
  if (!Object.keys(smap).length) return;
  const rows = (await query(
    "SELECT id, material_code, segment FROM ord_issue_item WHERE issue_no=$1 ORDER BY line_seq",
    [issueNo])).rows;
  let changed = false;
  for (const r of rows) {
    if ((r.segment || "").trim()) continue;
    const seg = smap[r.material_code];
    if (seg) {
      await query("UPDATE ord_issue_item SET segment=$1 WHERE id=$2", [seg, r.id]);
      changed = true;
    }
  }
  if (!changed) return;
  const rows2 = (await query(
    "SELECT id, material_code, segment FROM ord_issue_item WHERE issue_no=$1", [issueNo])).rows;
  rows2.sort((a, b) => (segRank(a.segment) - segRank(b.segment))
    || a.material_code.localeCompare(b.material_code));
  for (let i = 0; i < rows2.length; i++) {
    await query("UPDATE ord_issue_item SET line_seq=$1 WHERE id=$2", [i + 1, rows2[i].id]);
  }
}

// ============================================================================
// 列表行装饰（源 _decorate_mo / _decorate_item_vn / _check_po）
// ============================================================================

/** 工单列表装饰：按成品料号补机型/品名/客户 + 在制工单 ETA 预估 */
export async function decorateMo(rows) {
  rows = rows.map(r => ({ ...r }));
  const codes = [...new Set(rows
    .map(r => ((r.fg_code || r.product_code || "") || "").trim())
    .filter(Boolean))].sort();
  if (!codes.length) return rows;
  const m = {};
  const ph = codes.map((_, i) => `$${i + 1}`).join(",");
  for (const x of (await query(
    `SELECT product_code, product_model, product_name, cust_code FROM md_product WHERE product_code IN (${ph})`,
    codes)).rows) {
    m[x.product_code] = x;
  }
  for (const r of rows) {
    const code = ((r.fg_code || r.product_code || "") || "").trim();
    const pr = m[code] || {};
    r.product_model = pr.product_model || "";
    r.product_name = pr.product_name || "";
    if (!(r.cust_code || "").trim()) r.cust_code = pr.cust_code || "";
  }
  // 完工时间预估：只对「生产中」工单算（列表不卡顿——算不动就跳过）
  try {
    const live = rows.filter(r => (r.status || "") === "生产中" && r.mo_no).map(r => r.mo_no);
    if (live.length) {
      const est = await etaCompute(live);
      for (const r of rows) {
        const it = est[r.mo_no];
        if (!it) continue;
        r.eta_hours = it.hours;
        r.eta_at = it.done_at ? fmtMdHm(it.done_at) : "";
        r.eta_bottleneck = it.bottleneck || "";
        r.eta_note = it.reason || "";
        const pe = (r.plan_end || "").trim();
        r.eta_late = !!(pe && it.done_at && fmtYmd(it.done_at) > pe);
      }
    }
  } catch { /* 预计算不出就不展示，不拦列表 */ }
  return rows;
}

function fmtYmd(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtMdHm(d) {
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** BOM 明细装饰：越南码 + 机型（成品直取 / 半成品反查引用它的成品机型集合） */
export async function decorateItemVn(rows) {
  rows = rows.map(r => ({ ...r }));
  const codes = [...new Set(rows.map(r => (r.material_code || "").trim()).filter(Boolean))].sort();
  if (codes.length) {
    const m = {};
    const ph = codes.map((_, i) => `$${i + 1}`).join(",");
    for (const x of (await query(
      `SELECT material_code, vn_code FROM md_material WHERE material_code IN (${ph})`, codes)).rows) {
      const v = (x.vn_code || "").trim();
      if (v) m[x.material_code] = v;
    }
    for (const r of rows) r.vn_code = m[(r.material_code || "").trim()] ?? "";
  }
  // 机型
  const pcs = [...new Set(rows.map(r => (r.product_code || "").trim()).filter(Boolean))].sort();
  if (!pcs.length) return rows;
  const ph2 = pcs.map((_, i) => `$${i + 1}`).join(",");
  const pmap = {}, isFg = {};
  for (const x of (await query(
    `SELECT product_code, product_model, COALESCE(product_type,'FG') AS pt FROM md_product WHERE product_code IN (${ph2})`,
    pcs)).rows) {
    isFg[x.product_code] = ((x.pt || "FG").toUpperCase() === "FG");
    if (isFg[x.product_code]) pmap[x.product_code] = (x.product_model || "").trim();
  }
  const sfg = pcs.filter(c => !isFg[c]);
  if (sfg.length) {
    const ph3 = sfg.map((_, i) => `$${i + 1}`).join(",");
    for (const x of (await query(
      `SELECT b.material_code AS sfg, STRING_AGG(DISTINCT p.product_model, ',') AS models
       FROM bom_item b JOIN md_product p ON p.product_code=b.product_code
       WHERE b.material_code IN (${ph3}) AND COALESCE(p.product_type,'FG')='FG'
       GROUP BY b.material_code`, sfg)).rows) {
      pmap[x.sfg] = (x.models || "").trim();
    }
  }
  for (const r of rows) r.model = pmap[(r.product_code || "").trim()] ?? "";
  return rows;
}

/** PO 唯一性校验（同 PO 号同行号不重复） */
export async function checkPo(d, isNew, old) {
  if (!d.po_no) return [false, "PO 号必填"];
  const pl = String(d.po_line || "1");
  let q = "SELECT id FROM ord_po WHERE po_no=$1 AND po_line=$2";
  const args = [d.po_no, pl];
  if (old) { q += " AND id<>$3"; args.push(old.id); }
  const r = await query(q, args);
  if (r.rows[0]) return [false, `同 PO 号行号已存在（${d.po_no} 第 ${pl} 行）`];
  return [true, ""];
}

// ============================================================================
// 领料单打印 xlsx（源 core/issue_doc.py；模板文件源库缺失，按其布局重建）
//   Sheet 布局：B2:E3 标题《ĐƠN XIN LÝ NHẬN LIỆU / 领料申请单》；
//   第 4 行表头 STT|料号|品名|规格|单位|数量|实领|备注；第 5~24 行明细（20 行/页）；
//   第 25 行尾注（单号/工单/分段/行数 + VN 未维护提示）；超 20 行自动分页。
// ============================================================================
const ISSUE_PER_PAGE = 20;

function issueNum(v) {
  const f = Number(v || 0);
  if (!Number.isFinite(f)) return v ?? "";
  return Math.abs(f - Math.round(f)) < 1e-9 ? Math.round(f) : Math.round(f * 1e4) / 1e4;
}

export async function buildIssueDoc(issueNo) {
  const XLSX = await import("xlsx");
  const head = (await query("SELECT * FROM ord_issue WHERE issue_no=$1", [issueNo])).rows[0];
  if (!head) throw new Error(`找不到领料单：${issueNo}`);
  const items = (await query(
    "SELECT * FROM ord_issue_item WHERE issue_no=$1 ORDER BY line_seq, id", [issueNo])).rows;
  if (!items.length) throw new Error("该领料单没有明细行");

  const vnMap = await vnMapping(items.map(it => it.material_code));
  const missingTotal = items.filter(it => !vnMap[(it.material_code || "").trim()]).length;

  const wb = XLSX.utils.book_new();
  const pages = Math.max(1, Math.ceil(items.length / ISSUE_PER_PAGE));
  const dept = issueLabel(head.segment || "") || "-";
  const moNo = head.mo_no || "";
  for (let pi = 0; pi < pages; pi++) {
    const aoa = [];
    // 行 1~3：标题区（B2:E3 合并）
    for (let r = 0; r < 4; r++) aoa.push(["", "", "", "", "", "Người lĩnh", "", "Người phát", "", ""]);
    aoa[1][1] = "ĐƠN XIN LÝ NHẬN LIỆU / 领料申请单";
    aoa[1][5] = "Người lĩnh"; aoa[1][6] = "";
    aoa[1][7] = "Người phát"; aoa[1][8] = "";
    aoa[2][5] = "Xác nhận"; aoa[2][7] = "Xác nhận";
    // 行 4：表头
    aoa.push(["STT", "Mã liệu", "Tên liệu", "Quy cách", "Đơn vị", "Số lượng", "Số thực tế", "Ghi chú", "", ""]);
    // 行 5~24：明细（本页切片）
    const chunk = items.slice(pi * ISSUE_PER_PAGE, (pi + 1) * ISSUE_PER_PAGE);
    for (let k = 0; k < ISSUE_PER_PAGE; k++) {
      const it = chunk[k];
      if (!it) { aoa.push(["", "", "", "", "", "", "", "", "", ""]); continue; }
      const cn = (it.material_code || "").trim();
      const vn = vnMap[cn] || "";
      const note = vn ? "" : "VN未维护";
      aoa.push([
        pi * ISSUE_PER_PAGE + k + 1, vn || cn, it.material_name || "", it.spec || "",
        it.unit || "", issueNum(it.issue_qty), "", note, "", "",
      ]);
    }
    // 行 25：尾注
    const tail = pages > 1 ? `，第 ${pi + 1}/${pages} 页` : "";
    const note2 = missingTotal ? `（※ 有 ${missingTotal} 行越南码未维护）` : "";
    aoa.push([`单号 ${issueNo}，工单 ${moNo}，分段 ${dept}，应领 ${items.length} 行${note2}${tail}`, "", "", "", "", "", "", "", "", ""]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = [
      { s: { r: 1, c: 1 }, e: { r: 3, c: 4 } },   // B2:E3 标题
      { s: { r: 24, c: 0 }, e: { r: 24, c: 9 } }, // A25:J25 尾注
    ];
    ws["!cols"] = [{ wch: 5 }, { wch: 18 }, { wch: 26 }, { wch: 18 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 4 }, { wch: 4 }];
    XLSX.utils.book_append_sheet(wb, ws, `第${pi + 1}页`);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return [buf, `领料单_${issueNo}.xlsx`];
}

// ============================================================================
// 工艺路线排序规则（源 core/route_order.py，逐字移植）
//   顺序：工位后缀 → 固定 rank；路线编码 {线}-STD / {线}-{机型} / {线}-TMP
// ============================================================================

export const KIND_STD = "std";
export const KIND_MODEL = "model";
export const KIND_TMP = "tmp";

export const RANKS = {
  "01": {
    LASER: 10, PRINT: 20, SPI: 30, SPISMT: 30,
    AI1: 40, AI2: 45,
    SMT1: 50, SMT2: 60, REFLOW: 70,
    AOISMT: 80, "SMT-AOI": 80, STATIONCHECK: 90,
    CODETRANSFER: 100, PCBSMT: 110,
  },
  "02": { "DIP-PASS": 20, WAVE: 30, "WS-AOI": 40, ICT: 50, FCT: 60 },
  "03": {
    BAKING: 5, PCBASSY: 10, LINK: 15, AOIASSY: 20,
    ICT: 30, FCT: 40, PANELSPLIT: 50, DIVIDE: 50,
    CODETRANSFER: 60, "CODETRANSFER-1": 60, "CODETRANSFER-2": 65,
    PCMCHECK: 68,
    ATE1: 69,
    ULTRASONIC: 70, ULTRA: 70, "BI-LOAD": 75,
    AGING: 80, BURNIN: 80, AGINGCODE: 85,
    HIGHVOLTAGE: 88, PRESSURETEST: 90,
    ATE: 100,
    BARCODE: 105, DECODE: 110,
    PACKING: 120,
  },
  "04": {
    HIPOT: 10, PRESSURETEST: 10, ATE2: 20, "CODE-LINK": 30, COSMETIC: 40,
    PACKING: 50, PALLET: 60,
    "OQC-HIPOT": 110, "OQC-ATE2": 120, "OQC-COSMETIC": 130,
    "OQC-REPLACE": 140, "OQC-REPORT": 150,
  },
};
// 标准路线排除的后缀（维修站不上线；上料站只在整线过账时扫一次）
export const EXCLUDE_SUFFIX = new Set(["REPAIR", "LOADER", "PCBA-LOAD", "PDA-LOAD"]);
const UNKNOWN_RANK = 200;

export function suffixOf(code, line) {
  let s = code.startsWith(`${line}-`) ? code.slice(line.length + 1) : code;
  if (s.startsWith("L01-") && line.startsWith("DIP-")) s = s.slice(4);
  return s;
}

export function rankOf(code, line, proc = "") {
  const s = suffixOf(code, line);
  const table = RANKS[proc] ?? {};
  if (s in table) return table[s];
  for (const [k, v] of Object.entries(table)) {
    if (s.startsWith(k)) return v;
  }
  for (const tbl of Object.values(RANKS)) {
    if (s in tbl) return tbl[s];
  }
  return UNKNOWN_RANK;
}

/** 按 md_station 记录排成真实顺序；返回 (rows, dropped) */
export function buildRows(stations, line, traffic = null, mustSuffix = null, autoMust = false) {
  traffic = traffic || {};
  let rows = [];
  for (const s of stations) {
    const code = s.station_code;
    const suf = suffixOf(code, line);
    if (EXCLUDE_SUFFIX.has(suf)) continue;
    rows.push({
      code,
      name: s.short_name || s.station_name || code,
      seq: s.seq_no || 0,
      proc: s.process_code || "",
      rank: rankOf(code, line, s.process_code || ""),
      allow_retest: s.allow_retest === null || s.allow_retest === undefined ? 1 : s.allow_retest,
      max_retest: s.max_retest === null || s.max_retest === undefined ? 2 : s.max_retest,
      key: code.endsWith("PRESSURETEST") || code.endsWith("HIPOT") ? 1 : 0,
      must: 0,
    });
  }

  // 同名同 rank 合并（分板/测试/老化/SPI/AOI 双轨）
  const CANON = { SPISMT: "SPI", AOISMT: "SMT-AOI" };
  const PREFERRED = new Set(["PANELSPLIT", "ULTRASONIC", "AGING", "PRESSURETEST", "ATE",
    "PCBASSY", "AOIASSY", "ICT", "FCT", "PCMCHECK"]);
  const PREFERRED_SMT = new Set(["SPI", "SMT-AOI", "PCBA-LOAD", "LASER", "PRINT", "SMT1", "SMT2",
    "REFLOW", "AI1", "AI2", "STATIONCHECK", "CODETRANSFER", "PCBSMT"]);
  const grouped = new Map();
  const dropped = [];
  for (const r of rows) {
    let key;
    if (r.proc === "01") {
      key = `${r.rank}|${CANON[suffixOf(r.code, line)] ?? suffixOf(r.code, line)}`;
    } else {
      key = `${r.rank}|${r.name}`;
    }
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }
  rows = [];
  for (const [, cands] of [...grouped.entries()].sort((a, b) => {
    const [ra, na] = a[0].split("|");
    const [rb] = b[0].split("|");
    const minSeq = l => Math.min(...l.map(x => x.seq));
    return (Number(ra) - Number(rb)) || (minSeq(a[1]) - minSeq(b[1]));
  })) {
    if (cands.length === 1) { rows.push(cands[0]); continue; }
    const pref = line.startsWith("SMT") ? PREFERRED_SMT : PREFERRED;
    cands.sort((a, b) =>
      ((traffic[a.code] > 0 ? 1 : 0) - (traffic[b.code] > 0 ? 1 : 0))
      || ((pref.has(suffixOf(a.code, line)) ? 1 : 0) - (pref.has(suffixOf(b.code, line)) ? 1 : 0))
      || (b.seq - a.seq));
    const keep = cands[cands.length - 1];
    rows.push(keep);
    dropped.push(...cands.filter(x => x !== keep));
  }
  rows.sort((a, b) => (a.rank - b.rank) || (a.seq - b.seq) || a.code.localeCompare(b.code));

  for (const r of rows) {
    if (mustSuffix) r.must = mustSuffix.has(suffixOf(r.code, line)) ? 1 : 0;
    else if (autoMust) r.must = (traffic[r.code] ?? 0) >= 5 ? 1 : 0;
  }
  return [rows, dropped];
}

export function makeCode(line, kind = KIND_STD, model = "") {
  line = (line || "").trim().toUpperCase();
  if (!line) return "";
  if (kind === KIND_MODEL) {
    const slug = modelSlug(model);
    return slug ? `${line}-${slug}` : "";
  }
  if (kind === KIND_TMP) return `${line}-TMP`;
  return `${line}-STD`;
}

export function makeName(lineName, kind = KIND_STD, model = "") {
  const ln = (lineName || "").trim() || "产线";
  if (kind === KIND_MODEL) return `${ln} ${(model || "").trim()} 专用路线`;
  if (kind === KIND_TMP) return `${ln} 打样/临时路线`;
  return `${ln} 标准路线`;
}

/** 工位真实扫描流量（人工过站 + 设备上报）——判断哪些站"过站" */
export async function trafficMap() {
  const t = {};
  for (const r of (await query(
    `SELECT station_code, COUNT(*)::int AS n FROM prd_pass
     WHERE COALESCE(operator,'') NOT IN ('系统管理员','admin','ruijing')
     GROUP BY station_code`)).rows) {
    t[r.station_code] = (t[r.station_code] ?? 0) + r.n;
  }
  for (const r of (await query(
    "SELECT station_code, COUNT(*)::int AS n FROM prd_machine_data GROUP BY station_code")).rows) {
    t[r.station_code] = (t[r.station_code] ?? 0) + r.n;
  }
  return t;
}

// ============================================================================
// SN 生成规则渲染（源 api/cfg.py render_sn + core/util.sn_date_part/sn_seq_part）
// ============================================================================
const SN_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SN_DAY_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function snAlphaDate(fmt, dt) {
  let i;
  if (fmt === "LY") i = dt.getFullYear() - 2011;
  else if (fmt === "LM") i = dt.getMonth();
  else if (fmt === "LD") i = dt.getDate() - 1;
  else return "";
  if (i < 0 || i >= SN_ALPHA.length) return "0";
  return SN_ALPHA[i];
}

export function snDatePart(fmt = "", n = 0, dt = null) {
  dt = dt || new Date();
  fmt = (fmt || "").toUpperCase();
  const p2 = x => String(x).padStart(2, "0");
  const yy = String(dt.getFullYear()).slice(2);
  const ww = p2(Math.floor((+dt - +new Date(dt.getFullYear(), 0, 1)) / 604800000) + 1).slice(0, 2);
  if (["LY", "LM", "LD"].includes(fmt)) return snAlphaDate(fmt, dt);
  if (fmt === "YY") return yy;
  if (fmt === "WW") return ww;
  if (fmt === "MM") return p2(dt.getMonth() + 1);
  if (fmt === "DD") return p2(dt.getDate());
  if (fmt === "YYWW") return yy + ww;
  if (fmt === "YYMMDD") return yy + p2(dt.getMonth() + 1) + p2(dt.getDate());
  if (fmt === "YYYYMMDD") return `${dt.getFullYear()}${p2(dt.getMonth() + 1)}${p2(dt.getDate())}`;
  if (n === 4) return yy + ww;
  if (n === 6) return yy + p2(dt.getMonth() + 1) + p2(dt.getDate());
  if (n === 8) return `${dt.getFullYear()}${p2(dt.getMonth() + 1)}${p2(dt.getDate())}`;
  return n ? (yy + ww).slice(0, n) : yy + ww;
}

export function snSeqPart(n, seq, alpha = false) {
  seq = Number.isFinite(Number(seq)) ? Number(seq) : 0;
  if (n <= 0) return "";
  if (seq <= 0) seq = 1;
  if (!alpha) return String(seq).padStart(n, "0");
  const block = Math.floor((seq - 1) / 9999);
  if (block > 25) return ("Z" + "9".repeat(n - 1)).slice(0, n);
  const letter = SN_DAY_ALPHA[block];
  return (letter + String(((seq - 1) % 9999) + 1).padStart(Math.max(n - 1, 1), "0")).slice(0, n);
}

/** 渲染一个 SN（bump=true 时推进 SEQ 计数） */
export async function renderSn(rule, segs, bump = true) {
  const now = new Date();
  const parts = [];
  for (const s of segs) {
    const type = (s.type || "").toUpperCase();
    const ln = Number(s.len || 0);
    let v;
    if (type === "FIX") {
      v = s.value || s.val || "X".repeat(ln);
    } else if (type === "DATE") {
      v = snDatePart(s.fmt || "", ln, now);
    } else if (type === "SEQ") {
      if (bump) await query("UPDATE cfg_sn_rule SET cur_seq = cur_seq + 1 WHERE id=$1", [rule.id]);
      const cur = await query("SELECT cur_seq FROM cfg_sn_rule WHERE id=$1", [rule.id]);
      v = snSeqPart(ln, Number(cur.rows[0]?.cur_seq ?? 0), !!s.alpha);
    } else if (type === "FIXED") {
      v = String(s.value || s.val || "").padStart(ln, "0");
    } else {
      v = "?".repeat(ln);
    }
    v = String(v);
    parts.push(ln ? v.slice(0, ln) : v);
  }
  return parts.join("");
}

// ============================================================================
// 机型工艺辅助（源 api/route.py 下半部）
// ============================================================================

/** 机型已维护哪些变体工艺（''=标准工艺；开单/维护时选用） */
export async function modelVariants(model) {
  model = (model || "").trim();
  if (!model) return [];
  const rows = (await query(
    `SELECT COALESCE(variant,'') AS v, COUNT(*)::int AS n,
            SUM(CASE WHEN COALESCE(enabled,1)=1 THEN 1 ELSE 0 END)::int AS live_n
     FROM cfg_model_process WHERE model=$1 GROUP BY 1`, [model])).rows;
  rows.sort((a, b) => ((a.v === "" ? 0 : 1) - (b.v === "" ? 0 : 1)) || a.v.localeCompare(b.v));
  return rows.map(r => ({
    variant: r.v, name: r.v || "标准工艺",
    stations: r.n, live: r.live_n, is_std: r.v === "",
  }));
}

/** 开单辅助：某机型（+变体）每段默认产线/工位（源 model_defaults_data） */
export async function modelDefaultsData(model, variant = "") {
  model = (model || "").trim();
  variant = (variant || "").trim();
  if (!model) {
    return { model: "", variant: "", step_count: 0, segments: [], route_code: "", warn: "请先选择机型" };
  }
  const has = await query(
    "SELECT COUNT(*)::int AS n FROM md_product WHERE COALESCE(product_model,'')=$1", [model]);
  if (!Number(has.rows[0]?.n ?? 0)) {
    return { model, variant, step_count: 0, segments: [], route_code: "",
      warn: `产品主数据没有「${model}」这个机型（不存在）。请先在基础数据里建档` };
  }
  const [steps, src] = await modelProcessLive(model, variant);
  if (!steps.length) {
    return { model, variant, step_count: 0, segments: [], route_code: "",
      warn: `「${model}」还没有在「工艺路线」里配置启用的工位，请至少配置一次` };
  }
  const codes = steps.map(s => s.station_code).filter(Boolean);
  const lineOf = {};
  if (codes.length) {
    const ph = codes.map((_, i) => `$${i + 1}`).join(",");
    for (const r of (await query(
      `SELECT station_code, line_code FROM md_station WHERE station_code IN (${ph})`, codes)).rows) {
      lineOf[r.station_code] = (r.line_code || "").trim();
    }
  }
  const segs = [], missing = [];
  for (const [proc, pname] of PROC_SEGMENTS) {
    const sub = steps.filter(s => (s.process_code || "") === proc);
    if (!sub.length) continue;
    const cnt = {};
    for (const s of sub) {
      const lc = lineOf[s.station_code] ?? "";
      if (lc) cnt[lc] = (cnt[lc] ?? 0) + 1;   // 没有产线的工位不参与投票
    }
    const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    const mainLine = sorted[0]?.[0] ?? "";
    const noLine = sub.filter(s => !lineOf[s.station_code]).map(s => s.station_code);
    if (noLine.length) missing.push(...noLine);
    segs.push({
      process_code: proc, name: pname,
      line_code: mainLine, lines: Object.keys(cnt).sort(),
      stations: sub.length,
      must: sub.filter(s => Number(s.is_must_pass || 0) === 1).length,
      no_line: noLine,
    });
  }
  const tips = [];
  if (missing.length) {
    tips.push(`有 ${missing.length} 个工位「没有产线」（工位主数据没设产线）：${missing.slice(0, 5).join("、")}${missing.length > 5 ? "…" : ""}`);
  }
  if (src === "fallback") tips.push(`「${variant || "该变体"}」的专属工艺还没配置，用的是标准工艺`);
  if (src === "template") {
    tips.push(`该机型还没有专属工艺，用的是通用模板（${steps.length} 站）。请到「工艺路线」确认后保存，之后工单就会用自己的工艺`);
  }
  return {
    model, variant, step_count: steps.length, segments: segs,
    route_code: `MP-${modelSlug(model)}${variant ? `-${variant}` : ""}`,
    source: src, warn: tips.join("\n"),
  };
}

/** 机型在制总工单组（未完工/未关闭；源 _model_groups） */
export async function modelGroups(model) {
  const rows = (await query(
    `SELECT DISTINCT substr(mo_no,1,9) AS gk FROM ord_mo
     WHERE fg_code IN (SELECT product_code FROM md_product WHERE product_model=$1)
       AND status IN ('待排产','已排产','待下发','生产中') ORDER BY gk`, [model])).rows;
  return rows.map(r => r.gk);
}

/** 把当前机型工艺同步到该机型未锁站的总工单（源 _sync_model_groups） */
export async function syncModelGroups(model, by = "") {
  const [steps] = await modelProcessLive(model);
  if (!steps.length) return [[], [{ group: "-", reason: "该机型没有启用的工位" }]];
  const done = [], skipped = [];
  for (const gk of await modelGroups(model)) {
    const r = await lockGroup(gk, model, steps, by);
    if (r.ok) done.push({ group: gk, steps: r.steps ?? {}, total: r.total ?? 0 });
    else skipped.push({ group: gk, reason: r.msg ?? "" });
  }
  return [done, skipped];
}

// ============================================================================
// PCB 激光码解码（源 core/pcbcode.py，客户规范 v1.1：9 位码 + 现场实测 10 位码）
//   1 激光台号 / 2 年 / 3 月 / 4 日 / 5-8(9) 流水号 / 末位 PCB 板种码
// ============================================================================

// 客户规范字符集（1~9 + A~Z，去掉易混淆的 I/O）
const PCB_CS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
// 流水号判定字符集：现场实测流水是全数字（5G8F09886A 的 09886），含 0
const PCB_CS_SEQ = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PCB_YEAR_BASE = 2011;   // CS[0]='1'→2011，CS[8]='9'→2019，CS[9]='A'→2020

const pcbIdx = ch => PCB_CS.indexOf((ch || "").toUpperCase());

/** 解码一块 PCB 激光码，{ok, code, len, laser, year/month/day, date, serial, pcb_type, msg} */
export function pcbDecode(code) {
  const raw = (code || "").toString().trim().toUpperCase();
  if (!raw) return { ok: false, msg: "空码" };
  if (!/^[0-9A-Z]+$/.test(raw)) {
    return { ok: false, code: raw, msg: "含非法字符（只允许数字和大写字母）" };
  }
  if (raw.length !== 9 && raw.length !== 10) {
    return { ok: false, code: raw, len: raw.length,
      msg: `长度 ${raw.length} 位（规范 9 位 / 现场实测 10 位）都不匹配` };
  }
  const seqLen = raw.length - 5;          // 9 位→4 位流水；10 位→5 位流水
  const laser = raw[0], y = raw[1], m = raw[2], d = raw[3];
  const serial = raw.slice(4, 4 + seqLen);
  const pcbType = raw.slice(4 + seqLen);

  const bad = [];
  for (const [name, ch] of [["激光台号", laser], ["年", y], ["月", m], ["日", d], ["板种码", pcbType]]) {
    if (pcbIdx(ch) < 0) bad.push(`${name}「${ch}」不在规范字符集内（1~9、A~Z，不含 I/O）`);
  }
  for (const ch of serial) {
    if (!PCB_CS_SEQ.includes(ch)) { bad.push(`流水号「${ch}」不在规范字符集内`); break; }
  }
  const yi = pcbIdx(y), mi = pcbIdx(m), di = pcbIdx(d);
  let year = yi >= 0 ? PCB_YEAR_BASE + yi : null;
  let month = mi >= 0 ? mi + 1 : null;
  let day = di >= 0 ? di + 1 : null;
  if (month !== null && !(month >= 1 && month <= 12)) {
    bad.push(`月份「${m}」对应第 ${month} 月，超出 1~12`);
    month = null;
  }
  if (day !== null && !(day >= 1 && day <= 31)) {
    bad.push(`日「${d}」对应第 ${day} 日，超出 1~31`);
    day = null;
  }
  let date = "";
  if (year && month && day) {
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day) {
      date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    } else {
      bad.push(`日期 ${year}-${month}-${day} 不存在`);
      date = "";
    }
  }
  return {
    ok: bad.length === 0, code: raw, len: raw.length, layout: raw.length,
    laser, year, month, day, date, serial, pcb_type: pcbType,
    msg: bad.length
      ? bad.join("；")
      : `${year} 年 ${month} 月 ${day} 日 · 激光台 ${laser} · 流水 ${serial} · 板种 ${pcbType}`,
  };
}

/** 板种码是否与机型配置一致（cfg_pcb_code.pcb_code） */
export function pcbCheckType(code, expectType) {
  const d = pcbDecode(code);
  if (!d.ok) return [false, d.msg || ""];
  if (!expectType) return [true, "机型未配置板码，跳过校验"];
  if ((d.pcb_type || "").toUpperCase() !== (expectType || "").toString().trim().toUpperCase()) {
    return [false, `板种码不符：实际「${d.pcb_type}」，机型应为「${expectType}」——可能不是这个机型的板`];
  }
  return [true, "板种码一致"];
}

/** AOI 结果列表装饰：真实拼板数（源 cfg._decorate_aoi） */
export async function decorateAoi(rows) {
  rows = rows.map(r => ({ ...r }));
  const ids = rows.map(r => r.id).filter(Boolean);
  if (!ids.length) return rows;
  const ph = ids.map((_, i) => `$${i + 1}`).join(",");
  const m = {};
  for (const x of (await query(
    `SELECT aoi_id, COUNT(*)::int AS c FROM prd_aoi_board
     WHERE aoi_id IN (${ph}) AND COALESCE(board_sn,'')<>'' GROUP BY aoi_id`, ids)).rows) {
    m[x.aoi_id] = x.c;
  }
  for (const r of rows) r.sn_count = m[r.id] ?? 0;
  return rows;
}
