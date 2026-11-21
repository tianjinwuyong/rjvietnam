// ============================================================================
// MES-ruijing W8 AOI 看板域助手（逐字移植自源 api/aoi.py）
// 口径说明写在这里，避免以后又跑偏：
//   PCBA 片数   = Σ board_number（设备 header 给的「这块拼板里有几片 PCBA」）
//   检测点数     = Σ(board_number × 单板点数)，点数取 cfg_aoi_points（按机型 + 工位）
//   首判 DPPM    = Σ board_ng_number（首判 NG 的 PCBA 片数）÷ PCBA 总数 × 100万
//   DPMO         = 器件级 NG 数（Σ comp_ng_number）÷ 检测点数 × 100万
//   True Fail    = 复判后仍 NG：整板 final_result='NG'；器件 user_code<>'0'
//   NDF / 误判   = 首判 NG 但复判判良：整板 final_result='REPASS'；器件 user_code='0'
// ============================================================================
import { query } from "../db.js";
import { aoiSqueeze, aoiSeries, aoiSeriesLike } from "./aoi-model.js";

/** 设备 → 工位（源 _station_of） */
export function aoiStationOf(device) {
  const u = (device || "").toUpperCase();
  if (u.includes("WS-AOI") || u.includes("WS_AOI")) return "WS-AOI";
  if (u.includes("631") || u.includes("SPI")) return "SPI";
  if (u.includes("AIS") || u.includes("AOI")) return "SMT-AOI";
  return "";
}

export const AOI_STATION_ALL = ["SMT-AOI", "SPI", "WS-AOI"];

/** 机型名归一：设备把 R1G 写成 RIG，还有 -/空格 差异（源 _norm_model） */
function _normModel(s) {
  return aoiSqueeze(s);
}

/** 点数表：{station_name: {归一机型: point_qty}}（源 _points_table） */
export async function aoiPointsTable() {
  const t = {};
  for (const r of (await query("SELECT model, station_name, point_qty FROM cfg_aoi_points")).rows) {
    const st = r.station_name || "";
    if (!t[st]) t[st] = {};
    t[st][_normModel(r.model)] = Number(r.point_qty || 0);
  }
  return t;
}

/** 按工位 + 机型找单板点数；支持前缀匹配（源 _pick_points） */
export function aoiPickPoints(table, station, model) {
  const tb = table[station] || {};
  const n = _normModel(model);
  if (!n) return 0;
  if (tb[n] !== undefined) return tb[n];
  let best = 0, bestLen = -1;
  for (const [k, v] of Object.entries(tb)) {
    if (k && (n.startsWith(k) || k.startsWith(n)) && k.length > bestLen) {
      best = v; bestLen = k.length;
    }
  }
  return best;
}

/** 不良代码字典（源 _defect_map） */
export async function aoiDefectMap() {
  const out = {};
  for (const r of (await query(
    "SELECT code, name_en, name_zh, category FROM cfg_aoi_defect")).rows) {
    out[String(r.code)] = r;
  }
  return out;
}

/** 位号映射 {comp_id: designator}（源 _comp_map） */
export async function aoiCompMap(model) {
  if (!model) return {};
  const out = {};
  for (const r of (await query(
    "SELECT comp_id, designator FROM cfg_aoi_comp_map WHERE model=$1", [model])).rows) {
    out[r.comp_id] = r.designator;
  }
  return out;
}

/** 图片接入配置（源 _img_cfg）：proxy=本地挂载目录，base=AOI 自带 HTTP 前缀 */
export async function aoiImgCfg() {
  const get = async (k) => {
    const r = await query("SELECT param_val FROM sys_param WHERE param_key=$1", [k]);
    return (r.rows[0]?.param_val || "").toString().trim();
  };
  const root = await get("aoi.image_root");
  const base = (await get("aoi.image_base")).replace(/\/+$/, "");
  return { root, base, mode: root ? "proxy" : (base ? "base" : "") };
}

const AOI_RESULTS_PREFIX = "/home/aoi/aoi/run/results";

/** 图片相对路径（源 _rel_img_path） */
export function aoiRelImgPath(p) {
  p = (p || "").replace(/\\/g, "/").trim();
  for (const pre of [AOI_RESULTS_PREFIX, "/home/aoi/aoi/run/results", "results/"]) {
    if (p.startsWith(pre)) { p = p.slice(pre.length); break; }
  }
  return p.replace(/^\/+/, "");
}

/** 解析几种时间写法（源 _parse_ts） */
export function aoiParseTs(s) {
  s = (s || "").trim().replace("T", " ");
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mi = "00", ss = "00"] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss));
  return isNaN(dt.getTime()) ? null : dt;
}

const pad2 = n => String(n).padStart(2, "0");
const fmtTs = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
  + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

/**
 * 时间范围（源 _range）。返回 {from, to, label}
 * 优先级：显式起止时间 > 指定某天 > 最近 N 天
 * 显式区间按「含当刻」处理：上界排他到 +1 秒。
 */
export function aoiRange(days, day = null, tsFrom = null, tsTo = null) {
  const d1 = aoiParseTs(tsFrom), d2 = aoiParseTs(tsTo);
  if (d1 || d2) {
    let a = d1, b = d2;
    if (!a) { a = new Date(); a.setHours(0, 0, 0, 0); }
    if (!b) b = new Date();
    if (b < a) { const t = a; a = b; b = t; }
    const toEx = new Date(b.getTime() + 1000);
    return {
      from: fmtTs(a), to: fmtTs(toEx),
      label: `${fmtTs(a)} ~ ${fmtTs(b)}`,
    };
  }
  if (day) {
    const d0 = aoiParseTs(day);
    if (d0) {
      const d1x = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
      const d2x = new Date(d1x.getTime() + 86400000);
      return { from: fmtTs(d1x), to: fmtTs(d2x), label: day };
    }
  }
  const n = Math.max(1, Math.min(90, Number(days || 7)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d0 = new Date(today.getTime() - (n - 1) * 86400000);
  const dEnd = new Date(today.getTime() + 86400000);
  return {
    from: fmtTs(d0), to: fmtTs(dEnd),
    label: `${pad2(d0.getMonth() + 1)}-${pad2(d0.getDate())} ~ ${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`,
  };
}

/** 百分比（源 _rate） */
const _rate = (a, b, base = 100.0) => (b ? Math.round(base * a / b * 100) / 100 : 0);

export { _rate as aoiRate };

/**
 * AOI 看板数据（源 api/aoi.py dash）
 * 参数：days / day / device / model / station / by(model|program) / from / to
 */
export async function aoiDash(opts = {}) {
  const {
    days = "7", day = "", device = "", model = "", station = "",
    by = "model", tsFrom = "", tsTo = "",
  } = opts;

  const { from: ts_from, to: ts_to, label } = aoiRange(days, day, tsFrom, tsTo);

  // 程序名 → 标准机型
  const progs = (await query(
    "SELECT DISTINCT project_name FROM prd_aoi_result WHERE COALESCE(project_name,'')<>''")).rows
    .map(r => r.project_name);
  const { aoiBuildMap, aoiVariants } = await import("./aoi-model.js");
  const pmap = await aoiBuildMap(progs);
  const vmap = await aoiVariants(progs);

  // test_time 是 timestamptz；源系统用本地时间字符串，这里按本地时区显式转换，
  // 避免服务器时区与越南现场时区（+07:00）不一致导致区间偏移。
  const where = [
    "r.test_time >= ($1::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
    "r.test_time <  ($2::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
  ];
  const args = [ts_from, ts_to];
  if (device) { args.push(device); where.push(`r.device_name = $${args.length}`); }
  if (model) {
    if (by === "program") {
      args.push(model); where.push(`r.project_name = $${args.length}`);
    } else {
      const vs = vmap[model] || [model];
      if (vs.length) {
        const ph = vs.map((_, i) => `$${args.length + 1 + i}`).join(",");
        args.push(...vs);
        where.push(`r.project_name IN (${ph})`);
      }
    }
  }
  const w = where.join(" AND ");

  const ptab = await aoiPointsTable();

  // ---- 日 + 机型 + 设备 聚合（整板表全量都有，不依赖拼板器件明细）----
  const per = (await query(
    `SELECT to_char(r.test_time AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS d,
       r.project_name AS model, r.device_name AS dev,
       COUNT(*)::int AS panels,
       SUM(COALESCE(r.board_number,0))::int AS boards,
       SUM(COALESCE(r.board_ng_number,0))::int AS ng_boards,
       SUM(CASE WHEN r.robot_result<>'PASS' THEN 1 ELSE 0 END)::int AS ng_panels,
       SUM(CASE WHEN r.final_result='NG' THEN 1 ELSE 0 END)::int AS final_ng_panels,
       SUM(CASE WHEN r.final_result='REPASS' THEN 1 ELSE 0 END)::int AS ndf_panels,
       SUM(COALESCE(r.comp_number,0))::int AS comps,
       SUM(COALESCE(r.comp_ng_number,0))::int AS ng_comps,
       SUM(CASE WHEN r.cycle_time>0 THEN r.cycle_time ELSE 0 END)::float AS ct_sum,
       SUM(CASE WHEN r.cycle_time>0 THEN 1 ELSE 0 END)::int AS ct_n,
       SUM(CASE WHEN r.comp_user_ng_number>0 THEN r.comp_user_ng_number ELSE 0 END)::int AS ng_comps_user,
       SUM(CASE WHEN r.comp_user_ng_number IS NULL OR r.comp_user_ng_number<0 THEN 1 ELSE 0 END)::int AS tf_unknown,
       SUM(CASE WHEN r.board_user_ng_number>0 THEN r.board_user_ng_number ELSE 0 END)::int AS tf_boards
     FROM prd_aoi_result r WHERE ${w}
     GROUP BY d, model, dev`, args)).rows;

  if (by !== "program") {
    for (const r of per) {
      const raw = r.model || "";
      r.model = pmap[raw]?.model ?? raw;
    }
  }

  const tot = {
    panels: 0, boards: 0, boards_pt: 0, ng_boards: 0, ng_panels: 0,
    final_ng_panels: 0, ndf_panels: 0, comps: 0, ng_comps: 0, ng_comps_pt: 0,
    points: 0, ng_comps_user: 0, ng_comps_user_pt: 0, tf_unknown: 0, tf_unknown_pt: 0,
    tf_boards: 0, ct_sum: 0, ct_n: 0,
  };
  const daily = {}, mmap = {}, noPoints = {};
  const stArg = (station || "SMT-AOI").trim();
  const allSt = ["ALL", "*", "全部"].includes(stArg.toUpperCase());
  const bstat = {}, borrowed = new Set(), usedDevs = new Set();

  for (const r of per) {
    const rowSt = aoiStationOf(r.dev) || stArg;
    if (!allSt && rowSt !== stArg) continue;   // 工位隔离：SPI 的板数不许进 SMT-AOI 的分母
    const st = rowSt;
    usedDevs.add(r.dev || "");
    let qty = aoiPickPoints(ptab, st, r.model);
    if (st === "SPI" && !qty) {
      qty = aoiPickPoints(ptab, "WS-AOI", r.model);
      if (qty) borrowed.add("SPI→WS-AOI");
    }
    const boards = Number(r.boards || 0);
    const vals = {
      panels: Number(r.panels || 0), boards,
      ng_boards: Number(r.ng_boards || 0), ng_panels: Number(r.ng_panels || 0),
      final_ng_panels: Number(r.final_ng_panels || 0), ndf_panels: Number(r.ndf_panels || 0),
      comps: Number(r.comps || 0), ng_comps: Number(r.ng_comps || 0),
      ng_comps_user: Number(r.ng_comps_user || 0),
      tf_unknown: Number(r.tf_unknown || 0), tf_boards: Number(r.tf_boards || 0),
      ct_sum: Number(r.ct_sum || 0), ct_n: Number(r.ct_n || 0),
    };
    for (const [k, v] of Object.entries(vals)) tot[k] += v;
    if (qty > 0) {
      tot.points += boards * qty;
      tot.boards_pt += boards;
      tot.ng_comps_pt += vals.ng_comps;
      tot.ng_comps_user_pt += vals.ng_comps_user;
      tot.tf_unknown_pt += vals.tf_unknown;
    } else {
      const k = r.model || "(?)";
      noPoints[k] = (noPoints[k] || 0) + boards;
    }
    const dd = daily[r.d] || (daily[r.d] = {
      d: r.d, panels: 0, boards: 0, ng_boards: 0, ng_panels: 0,
      ndf_panels: 0, ng_comps: 0, points: 0, boards_pt: 0, ng_comps_pt: 0,
    });
    for (const k of ["panels", "boards", "ng_boards", "ng_panels", "ndf_panels", "ng_comps"]) {
      dd[k] += vals[k];
    }
    if (qty > 0) {
      dd.points += boards * qty;
      dd.boards_pt += boards;
      dd.ng_comps_pt += vals.ng_comps;
    }
    const b0 = bstat[st] || (bstat[st] = {
      station: st, panels: 0, boards: 0, ng_boards: 0, ng_comps: 0,
      points: 0, ng_comps_pt: 0,
    });
    for (const k of ["panels", "boards", "ng_boards", "ng_comps"]) b0[k] += vals[k];
    if (qty > 0) {
      b0.points += boards * qty;
      b0.ng_comps_pt += vals.ng_comps;
    }
    const m0 = mmap[r.model || "(?)"] || (mmap[r.model || "(?)"] = {
      model: r.model || "(?)", panels: 0, boards: 0, ng_boards: 0, ng_panels: 0,
      points: 0, boards_pt: 0, ng_comps: 0, ng_comps_pt: 0,
    });
    for (const k of ["panels", "boards", "ng_boards", "ng_panels", "ng_comps"]) m0[k] += vals[k];
    if (qty > 0) {
      m0.points += boards * qty;
      m0.boards_pt += boards;
      m0.ng_comps_pt += vals.ng_comps;
    }
  }

  // 同一拼板被反复回检会算成多个「版」和「片」，必须披露出来
  let recheck = 0;
  try {
    const devs = [...usedDevs].filter(Boolean).sort();
    if (devs.length) {
      const ph = devs.map((_, i) => `$${args.length + 1 + i}`).join(",");
      const dsn = (await query(
        `SELECT COUNT(DISTINCT r.pcb_sn)::int AS n FROM prd_aoi_result r
         WHERE ${w} AND r.device_name IN (${ph}) AND COALESCE(r.pcb_sn,'')<>''`,
        [...args, ...devs])).rows[0];
      recheck = Math.max(tot.panels - Number(dsn?.n || 0), 0);
    }
  } catch { recheck = 0; }

  // ---- UPH ----
  const ctH = tot.ct_sum ? tot.ct_sum / 3600.0 : 0;
  const uphEff = ctH ? Math.round(tot.boards / ctH) : null;
  const uphPanel = ctH ? Math.round(tot.panels / ctH) : null;
  const ctAvg = tot.ct_n ? Math.round(tot.ct_sum / tot.ct_n * 10) / 10 : null;
  let uphRange = null;
  try {
    const a = aoiParseTs(ts_from), b = aoiParseTs(ts_to);
    const hrs = (b - a) / 3600000;
    if (hrs > 0 && tot.boards) uphRange = Math.round(tot.boards / hrs);
  } catch { uphRange = null; }

  // 每小时产能
  let hourly = [];
  try {
    const devs = [...usedDevs].filter(Boolean).sort();
    if (devs.length) {
      const ph = devs.map((_, i) => `$${args.length + 1 + i}`).join(",");
      hourly = (await query(
        `SELECT to_char(r.test_time AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD HH24') AS h,
           COUNT(*)::int AS panels,
           SUM(COALESCE(r.board_number,0))::int AS boards
         FROM prd_aoi_result r WHERE ${w} AND r.device_name IN (${ph})
         GROUP BY h ORDER BY h`, [...args, ...devs])).rows;
    }
  } catch { hourly = []; }

  const summary = {
    panels: tot.panels, boards: tot.boards, points: tot.points,
    points_src: "cfg_aoi_points",
    points_cov: _rate(tot.boards_pt, tot.boards),
    ng_boards: tot.ng_boards, ng_panels: tot.ng_panels,
    ndf_panels: tot.ndf_panels, final_ng_panels: tot.final_ng_panels,
    ng_comps: tot.ng_comps, comps: tot.comps, ng_comps_pt: tot.ng_comps_pt,
    recheck_panels: recheck,
    ok_boards: Math.max(tot.boards - tot.ng_boards, 0),
    ndf_boards: Math.max(tot.ng_boards - tot.tf_boards, 0),
    tf_boards: tot.tf_boards,
    uph: uphEff, uph_panel: uphPanel, uph_range: uphRange,
    hourly, ct_avg: ctAvg, ct_hours: Math.round(ctH * 100) / 100,
    first_dppm: tot.boards ? Math.round(1e6 * tot.ng_boards / tot.boards) : 0,
    dpmo: tot.points ? Math.round(1e6 * tot.ng_comps_user_pt / tot.points) : null,
    dpmo_tf: tot.points ? Math.round(1e6 * tot.ng_comps_user_pt / tot.points) : null,
    dpmo_first: tot.points ? Math.round(1e6 * tot.ng_comps_pt / tot.points) : null,
    dpmo_false: tot.points
      ? Math.round(1e6 * Math.max(tot.ng_comps_pt - tot.ng_comps_user_pt, 0) / tot.points) : null,
    ng_comps_tf: tot.ng_comps_user_pt,
    ng_comps_false: Math.max(tot.ng_comps_pt - tot.ng_comps_user_pt, 0),
    tf_cov: _rate(tot.boards_pt - tot.tf_unknown_pt, tot.boards_pt),
    dpmo_basis: "user_confirmed",
    ndf_rate: _rate(tot.ndf_panels, tot.ng_panels),
    ng_rate: _rate(tot.ng_panels, tot.panels),
    final_ng_rate: _rate(tot.final_ng_panels, tot.panels),
    first_yield: Math.round((100 - _rate(tot.ng_panels, tot.panels)) * 100) / 100,
    repass_panels: tot.ndf_panels,
    station: allSt ? "ALL" : stArg,
    station_all: allSt ? 1 : 0,
    points_borrow: [...borrowed].sort().join(","),
    ok_panels: Math.max(tot.panels - tot.ng_panels, 0),
    ng_only_upload: (tot.panels && tot.ng_panels >= tot.panels) ? 1 : 0,
  };

  const byStation = [];
  for (const b0 of Object.values(bstat)) {
    b0.first_dppm = b0.boards ? Math.round(1e6 * b0.ng_boards / b0.boards) : 0;
    b0.dpmo = b0.points ? Math.round(1e6 * b0.ng_comps_pt / b0.points) : null;
    byStation.push(b0);
  }
  byStation.sort((x, y) => {
    const ix = AOI_STATION_ALL.indexOf(x.station), iy = AOI_STATION_ALL.indexOf(y.station);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });
  summary.by_station = byStation;

  summary.sn_boards = Number((await query(
    `SELECT COUNT(*)::int AS n FROM prd_aoi_board b
     JOIN prd_aoi_result r ON r.file_name=b.file_name
     WHERE ${w} AND b.board_sn<>''`, args)).rows[0]?.n || 0);
  summary.repass_rate = summary.ndf_rate;

  const dailyArr = Object.values(daily).map(dd => ({
    ...dd,
    dppm: dd.boards ? Math.round(1e6 * dd.ng_boards / dd.boards) : 0,
    ndf_rate: _rate(dd.ndf_panels, dd.ng_panels),
    dpmo: dd.points ? Math.round(1e6 * (dd.ng_comps_pt || 0) / dd.points) : null,
  })).sort((a, b) => a.d.localeCompare(b.d));

  const models = Object.values(mmap).map(m0 => ({
    ...m0,
    dppm: m0.boards ? Math.round(1e6 * m0.ng_boards / m0.boards) : 0,
    dpmo: m0.points ? Math.round(1e6 * (m0.ng_comps_pt || 0) / m0.points) : null,
    pt_ok: m0.points ? 1 : 0,
  })).sort((a, b) => b.boards - a.boards).slice(0, 10);

  // ---- 不良类型 TOP10（器件级）----
  // 注：PG 不允许在 GROUP BY / ORDER BY 里引用同层 SELECT 的别名，
  //     源 SQLite 可以 —— 这里把表达式原样重复一遍（口径不变）。
  const dmap = await aoiDefectMap();
  const ngTypes = (await query(
    `SELECT COALESCE(NULLIF(c.robot_code,''),'(未分类)') AS code,
       COALESCE(MAX(c.robot_result),'') AS name_en, COUNT(*)::int AS n,
       SUM(CASE WHEN COALESCE(c.user_code,'0')<>'0' THEN 1 ELSE 0 END)::int AS tf,
       SUM(CASE WHEN COALESCE(c.user_code,'0')='0' THEN 1 ELSE 0 END)::int AS ndf
     FROM prd_aoi_comp c JOIN prd_aoi_result r ON r.file_name=c.file_name
     WHERE ${w} AND COALESCE(c.robot_code,'0')<>'0'
     GROUP BY COALESCE(NULLIF(c.robot_code,''),'(未分类)')
     ORDER BY COUNT(*)::int DESC LIMIT 10`, args)).rows;
  for (const t of ngTypes) {
    const d0 = dmap[String(t.code)] || {};
    t.name_zh = d0.name_zh || "";
    t.category = d0.category || "";
    t.name_en = t.name_en || (d0.name_en || "");
    t.label = t.name_zh || t.name_en || (`代码 ${t.code}`);
    t.title = `${t.label}（设备代码 ${t.code}）`;
  }

  // ---- 位号 TOP10 + 误判 TOP10 ----
  const cmap = await aoiCompMap(model);
  const DESIGNATOR = "COALESCE(NULLIF(c.comp_designator,''),'(?)')";
  const CTYPE = "COALESCE(NULLIF(c.comp_type,''),'-')";
  const baseSql =
    `SELECT ${DESIGNATOR} AS designator, ${CTYPE} AS type, COUNT(*)::int AS n, `
    + "SUM(CASE WHEN COALESCE(c.user_code,'0')<>'0' THEN 1 ELSE 0 END)::int AS tf, "
    + "SUM(CASE WHEN COALESCE(c.user_code,'0')='0' THEN 1 ELSE 0 END)::int AS ndf "
    + "FROM prd_aoi_comp c JOIN prd_aoi_result r ON r.file_name=c.file_name "
    + `WHERE ${w} AND COALESCE(c.robot_code,'0')<>'0' `;
  const ngComps = (await query(
    baseSql
    + `GROUP BY ${DESIGNATOR}, ${CTYPE} `
    + "ORDER BY SUM(CASE WHEN COALESCE(c.user_code,'0')<>'0' THEN 1 ELSE 0 END)::int DESC, "
    + "COUNT(*)::int DESC LIMIT 30", args)).rows;
  for (const c0 of ngComps) {
    const ref = cmap[c0.designator];
    c0.ref = ref || "";
    c0.label = ref || c0.designator;
    if (ref) c0.sub = c0.designator;
  }
  const mappedN = ngComps.filter(c0 => c0.ref).length;
  const ngCompsTop = ngComps.slice(0, 10);
  const ndfComps = (await query(
    baseSql
    + `GROUP BY ${DESIGNATOR}, ${CTYPE} `
    + "HAVING SUM(CASE WHEN COALESCE(c.user_code,'0')='0' THEN 1 ELSE 0 END)::int > 0 "
    + "ORDER BY SUM(CASE WHEN COALESCE(c.user_code,'0')='0' THEN 1 ELSE 0 END)::int DESC LIMIT 10",
    args)).rows;
  for (const c0 of ndfComps) c0.label = cmap[c0.designator] || c0.designator;

  // 器件明细覆盖率 = 有器件明细的整版数 ÷ 整版总数
  const devScope = [...usedDevs].filter(Boolean).sort();
  let detPanels = 0;
  if (devScope.length) {
    const ph = devScope.map((_, i) => `$${args.length + 1 + i}`).join(",");
    detPanels = Number((await query(
      `SELECT COUNT(DISTINCT r.id)::int AS n FROM prd_aoi_comp c
       JOIN prd_aoi_result r ON r.file_name=c.file_name
       WHERE ${w} AND r.device_name IN (${ph})`, [...args, ...devScope])).rows[0]?.n || 0);
  }
  const compCov = Math.min(tot.panels ? _rate(detPanels, tot.panels) : 0, 100.0);

  // ---- 最近 NG ----
  const recent = (await query(
    `SELECT r.id, r.test_time, r.pcb_sn, r.project_name, r.board_side, r.track_line,
       r.board_number, r.board_ng_number, r.robot_result, r.final_result,
       r.file_name, r.image_path
     FROM prd_aoi_result r WHERE ${w} AND r.robot_result<>'PASS'
     ORDER BY r.test_time DESC, r.id DESC LIMIT 30`, args)).rows;

  // 下拉选项
  let devices = (await query(
    "SELECT DISTINCT device_name FROM prd_aoi_result WHERE device_name<>'' ORDER BY device_name"))
    .rows.map(r => r.device_name);
  if (!allSt) {
    const sub = devices.filter(d => aoiStationOf(d) === stArg);
    if (sub.length) devices = sub;
  }
  const cnt = {};
  for (const p of progs) {
    const m = pmap[p]?.model ?? p;
    if (!cnt[m]) cnt[m] = 0;
  }
  for (const r of (await query(
    "SELECT project_name, COUNT(*)::int AS n FROM prd_aoi_result "
    + "WHERE COALESCE(project_name,'')<>'' GROUP BY project_name")).rows) {
    const m = pmap[r.project_name]?.model ?? r.project_name;
    cnt[m] = (cnt[m] || 0) + Number(r.n || 0);
  }
  const modelOpts = Object.keys(cnt).filter(Boolean).sort((a, b) => cnt[b] - cnt[a]);
  const programOpts = (await query(
    "SELECT project_name, COUNT(*)::int AS n FROM prd_aoi_result WHERE project_name<>'' "
    + "GROUP BY project_name ORDER BY n DESC")).rows.map(r => r.project_name);
  const unmapped = progs.filter(p => !pmap[p]?.hit).sort();

  const img = await aoiImgCfg();
  return {
    by,
    unmapped,
    model_map: programOpts.map(p => ({
      program: p, model: pmap[p]?.model ?? p, mapped: pmap[p]?.hit ?? false,
    })),
    range: { from: ts_from, to: ts_to, label, days, day },
    summary, daily: dailyArr, models,
    ng_types: ngTypes, ng_comps: ngCompsTop, ndf_comps: ndfComps,
    comp_cov: compCov,
    comp_map: { model, rows: Object.keys(cmap).length, mapped_in_top: mappedN },
    dict_rows: Object.keys(dmap).length,
    no_points: Object.entries(noPoints).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([m, boards]) => ({ model: m, boards })),
    recent, devices, model_opts: modelOpts, program_opts: programOpts,
    image_mode: img.mode, image_base: img.base,
  };
}

export { aoiSeries, aoiSeriesLike, aoiSqueeze };
