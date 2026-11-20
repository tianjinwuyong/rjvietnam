/**
 * 时效（Dwell Time）管控 —— 逐字移植自源 core/dwell.py（MES-ruijing）
 *
 * 工厂口径：产品从 A 站过完站，到 B 站过站之间允许停留多少小时，超过就叫呆滞 / WIP 超期。
 * 两个生效点：
 *   1) 过站实时校验 checkOnPass()：doPassInner 写 prd_pass 前调用；action=拦截 直接拦，
 *      action=预警 放行但落 prd_alert 并在回执里带文案。
 *   2) 定时扫描 scan()：扫「最后一次过站后就没动静」的在制 SN（卡在原地不动的那批），
 *      定时器由外部调度（本仓暂无内建 scheduler，页面/运维脚本调 POST /dwell/scan）。
 *
 * 匹配粒度（cfg_dwell_rule.from_key / to_key，越靠前越精确）：
 *   工位编码 → 「工序:工位类型」 → 工位类型 → 工序代码
 *
 * 比较口径：上一站「最后一次」过站 → 本次过站时间；只取**别的工位**的过站，
 * 返修重测回原站不会误判。扫描只算 prd_sn.status='在制' 且工单在制。
 */
import { query } from "../db.js";

export const ACTION_WARN = "预警";
export const ACTION_BLOCK = "拦截";

export const DEFAULT_RULES = [
  ["SMT → DIP", "01", "02", 168, ACTION_WARN,
    "SMT 下线到 DIP 投产，超过 7 天必须烘烤/复检（用户 2026-10-22 定）"],
  ["DIP → 组装", "02", "03", 12, ACTION_WARN, "DIP 完成到组装投产，超过 12H 预警（可调）"],
  ["组装 → 包装", "03", "04", 12, ACTION_WARN, "组装完成到包装投产，超过 12H 预警（可调）"],
  ["ICT → FCT", "ICT", "FCT", 2, ACTION_WARN, "ICT 下线 2H 内必须进 FCT"],
  ["分板 → PCBA Link", "分板", "PCBA Link", 2, ACTION_WARN, "分板完成 2H 内必须绑码"],
  ["绑码 → ATE1", "转码1", "ATE1", 2, ACTION_WARN, "绑码（转码）完成 2H 内必须进 ATE1"],
];

const LIVE_MO = ["待排产", "已排产", "已下达", "生产中"];
const MAX_ALERTS = 300;
const PROC_NAME = { "01": "SMT", "02": "DIP", "03": "组装", "04": "包装" };

let _ensured = false;

/** 建表 + 首次灌默认规则（幂等；迁移 309 已建表时这里只补种） */
export async function ensureSchema() {
  if (_ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS cfg_dwell_rule (
    id         BIGSERIAL PRIMARY KEY,
    rule_name  TEXT    NOT NULL DEFAULT '',
    from_key   TEXT    NOT NULL DEFAULT '',
    to_key     TEXT    NOT NULL DEFAULT '',
    max_hours  NUMERIC(10,2) NOT NULL DEFAULT 0,
    action     TEXT    NOT NULL DEFAULT '预警',
    enabled    INTEGER NOT NULL DEFAULT 1,
    remark     TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const n = (await query("SELECT COUNT(*)::int AS n FROM cfg_dwell_rule")).rows[0]?.n || 0;
  if (!n) {
    for (const [name, fk, tk, h, act, rm] of DEFAULT_RULES) {
      await query(
        `INSERT INTO cfg_dwell_rule (rule_name, from_key, to_key, max_hours, action, enabled, remark)
         VALUES ($1,$2,$3,$4,$5,1,$6)`, [name, fk, tk, h, act, rm]);
    }
  }
  _ensured = true;
}

/** 工位 → 候选匹配键，从最精确到最宽泛：编码 → 工序:类型 → 类型 → 工序 */
export async function stationKeys(stationCode) {
  const code = String(stationCode || "").trim();
  if (!code) return [""];
  const st = (await query(
    "SELECT type_code, process_code FROM md_station WHERE station_code=$1", [code])).rows[0];
  const keys = [code];
  const pc = String(st?.process_code || "").trim();
  const tc = String(st?.type_code || "").trim();
  if (pc && tc) keys.push(`${pc}:${tc}`);
  if (tc) keys.push(tc);
  if (pc) keys.push(pc);
  return keys;
}

async function rules() {
  await ensureSchema();
  return (await query("SELECT * FROM cfg_dwell_rule WHERE enabled=1 ORDER BY id")).rows;
}

/** 找 (上一站 → 本站) 命中的规则，多命中取最精确的一条 */
export async function findRule(prevStation, curStation) {
  const pk = await stationKeys(prevStation);
  const ck = await stationKeys(curStation);
  const all = await rules();
  let best = null, bestScore = -1;
  for (const r of all) {
    const fk = String(r.from_key || "").trim();
    const tk = String(r.to_key || "").trim();
    if (!pk.includes(fk) || !ck.includes(tk)) continue;
    const score = (4 - pk.indexOf(fk)) + (4 - ck.indexOf(tk));
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/** 这个工位作为**起点**能触发哪些规则（定时扫描用） */
export async function rulesFrom(stationCode) {
  const keys = await stationKeys(stationCode);
  return (await rules()).filter(r => keys.includes(String(r.from_key || "").trim()));
}

/** SN 在**别的工位**上的最近一次 OK 过站（返修重测回原站不会把自己当上一站） */
async function prevPass(sn, curStation) {
  return (await query(
    `SELECT station_code, pass_time, mo_no FROM prd_pass
      WHERE sn=$1 AND station_code<>$2 AND result='OK'
      ORDER BY id DESC LIMIT 1`, [sn, curStation])).rows[0];
}

function hoursSince(ts) {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3600000;
}

async function stationShort(code) {
  const st = (await query(
    "SELECT short_name, station_name FROM md_station WHERE station_code=$1", [code])).rows[0];
  return st?.short_name || st?.station_name || code;
}

/** 过站前调用。返回 null（没规则/没超时）或命中详情 */
export async function checkOnPass(sn, curStation, moNo = "") {
  await ensureSchema();
  const p = await prevPass(sn, curStation);
  if (!p) return null;
  const r = await findRule(p.station_code, curStation);
  if (!r) return null;
  const h = hoursSince(p.pass_time);
  if (h === null) return null;
  const limit = Number(r.max_hours || 0);
  if (limit <= 0 || h <= limit) return null;
  const over = h - limit;
  return {
    rule_id: r.id,
    rule_name: r.rule_name,
    action: r.action || ACTION_WARN,
    hours: Number(h.toFixed(2)),
    max_hours: limit,
    from: p.station_code,
    from_time: p.pass_time,
    to: curStation,
    over: Number(over.toFixed(2)),
    mo_no: moNo || p.mo_no || "",
    msg: `${r.rule_name}：${await stationShort(p.station_code)} 停留 ${h.toFixed(1)}H`
      + `（限 ${limit.toFixed(1)}H，超 ${over.toFixed(1)}H）`,
  };
}

/** 预警落库（去重：同 SN + 同工位 + 同规则，未处理的不重复生成） */
export async function raiseAlert(sn, stationCode, info, moNo = "", source = "过站") {
  await ensureSchema();
  const key = `DWELL:${info?.rule_id || ""}`;
  const dup = (await query(
    `SELECT id FROM prd_alert WHERE rule_key=$1 AND ref_sn=$2
      AND station_code=$3 AND status='待处理' LIMIT 1`, [key, sn, stationCode])).rows[0];
  if (dup) return false;
  await query(
    `INSERT INTO prd_alert (rule_key, rule_name, level, title, detail, ref_sn, station_code, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'待处理',now())`,
    [key, `时效超期 · ${info?.rule_name || ""}`,
      info?.action === ACTION_BLOCK ? "严重" : "警告",
      `${sn} 在 ${await stationShort(stationCode)} 停留超时`,
      `${info?.msg || ""}（${source}触发）`, sn, stationCode]);
  return true;
}

/**
 * 扫出「最后一次过站后就没动静」且超过规则时限的在制工单 SN。
 * days 只扫最近 N 天内有过过站的（老库存不反复报）。
 */
export async function scan(days = 7, autoAlert = true, maxItems = 5000) {
  await ensureSchema();
  const d = Math.max(1, Number(days) || 7);
  const rows = (await query(
    `SELECT p.sn, p.station_code, p.pass_time, p.mo_no, s.product_code
       FROM prd_pass p
       JOIN (SELECT sn, MAX(id) AS mid FROM prd_pass GROUP BY sn) t ON t.mid = p.id
       JOIN prd_sn s ON s.sn = p.sn
       JOIN ord_mo m ON m.mo_no = p.mo_no AND m.status = ANY($1)
      WHERE s.status = '在制'
        AND p.pass_time >= now() - ($2 || ' days')::interval`, [LIVE_MO, String(d)])).rows;
  const out = [];
  for (const r of rows) {
    if (out.length >= maxItems) break;
    const h = hoursSince(r.pass_time);
    if (h === null) continue;
    for (const rule of await rulesFrom(r.station_code)) {
      const lim = Number(rule.max_hours || 0);
      if (lim <= 0 || h <= lim) continue;
      out.push({
        sn: r.sn, mo_no: r.mo_no || "", product_code: r.product_code || "",
        station_code: r.station_code, station_name: await stationShort(r.station_code),
        pass_time: r.pass_time,
        hours: Number(h.toFixed(2)), max_hours: lim, over: Number((h - lim).toFixed(2)),
        rule_id: rule.id, rule_name: rule.rule_name, action: rule.action || ACTION_WARN,
        msg: `卡在 ${await stationShort(r.station_code)} ${h.toFixed(1)}H（限 ${lim.toFixed(1)}H）`,
      });
    }
  }
  out.sort((a, b) => b.over - a.over);
  if (autoAlert) {
    // 只给超得最狠的写预警，避免一次刷几千条（其余在清单里能看）
    for (const it of out.slice(0, MAX_ALERTS)) {
      await raiseAlert(it.sn, it.station_code, it, it.mo_no, "定时扫描");
    }
  }
  return out;
}

/** 页面汇总：总数 / 严重（超 1 倍）/ 各工位分布 */
export async function summary(days = 7) {
  const items = await scan(days, false);
  const by = {};
  for (const it of items) by[it.station_name] = (by[it.station_name] || 0) + 1;
  return {
    total: items.length,
    serious: items.filter(x => x.hours >= x.max_hours * 2).length,
    items: items.slice(0, 500),
    truncated: items.length > 500,
    by_station: Object.entries(by)
      .map(([station, qty]) => ({ station, qty }))
      .sort((a, b) => b.qty - a.qty),
  };
}

/** 把 01 / ICT / 03:FCT / 工位编码 翻成人话（页面直接显示） */
export async function keyName(key) {
  const k = String(key || "").trim();
  if (k.includes(":")) {
    const i = k.indexOf(":");
    return `${PROC_NAME[k.slice(0, i)] || k.slice(0, i)} 段 · ${k.slice(i + 1)}`;
  }
  if (/^\d{2}$/.test(k)) return `${PROC_NAME[k] || k}（整段）`;
  const st = (await query(
    "SELECT short_name, station_name FROM md_station WHERE station_code=$1", [k])).rows[0];
  return st?.short_name || st?.station_name || k;
}

export default {
  ensureSchema, stationKeys, findRule, rulesFrom, checkOnPass, raiseAlert, scan, summary, keyName,
  ACTION_WARN, ACTION_BLOCK, DEFAULT_RULES,
};
