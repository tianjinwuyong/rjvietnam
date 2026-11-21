// SMT core helpers — reconstructed from D:/rj/repos/MES-ruijing/core/*.py
// (util.py, feeder_slot.py, smt_baseline.py, smt.py) after the original file was
// lost during an in-flight refactor. All helpers are defensive: a missing table
// degrades to a safe default instead of taking the API down.
import { query } from "../db.js";

const p2 = n => String(n).padStart(2, "0");

export function now() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
export const fmtTs = now;
export function todayStr() { return now().slice(0, 10); }
export function addHours(ts, hours) {
  const d = ts instanceof Date ? new Date(ts) : new Date(String(ts || "").replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return now();
  d.setHours(d.getHours() + Number(hours || 0));
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

let PARAMS = {};
export async function loadParams() {
  try {
    const r = await query(`SELECT param_key,param_val FROM sys_param`);
    PARAMS = Object.fromEntries(r.rows.map(x => [x.param_key, x.param_val]));
  } catch { PARAMS = PARAMS || {}; }
  return PARAMS;
}
export function smtParam(key, dflt = "") {
  const v = PARAMS[key];
  return v == null || v === "" ? dflt : v;
}
export function feederSlotStrict() {
  const v = String(smtParam("smt.feeder_strict", "1")).trim().toLowerCase();
  return !["0", "false", "no", "off", ""].includes(v);
}

export async function paged(sqlCount, sqlRows, args = [], page = 1, size = 50) {
  const pg = Math.max(1, Number(page) || 1);
  const sz = Math.min(500, Math.max(1, Number(size) || 50));
  let total = 0;
  try { total = Number((await query(sqlCount, args)).rows[0]?.n || 0); } catch { /* ignore */ }
  let rows = [];
  try {
    const more = [...args, sz, (pg - 1) * sz];
    rows = (await query(`${sqlRows} LIMIT $${more.length - 1} OFFSET $${more.length}`, more)).rows;
  } catch { /* ignore */ }
  return { total, page: pg, size: sz, rows };
}

export async function audit(operator, module, action, target, detail, ip) {
  try {
    await query(
      `INSERT INTO sys_audit_log (operator,module,action,target,detail,ip,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [String(operator || "").slice(0, 120), String(module || "").slice(0, 60),
       String(action || "").slice(0, 120), String(target || "").slice(0, 200),
       String(detail || ""), String(ip || "").slice(0, 60)]
    );
  } catch { /* audit must never break the request */ }
  return true;
}

export async function ensureSchema() {
  // The runtime DDL applied by server.js / prior migrations owns these tables.
  // Keep a best-effort bootstrap for standalone deployments.
  try {
    await query(`CREATE TABLE IF NOT EXISTS prd_smt_baseline (
      id BIGSERIAL PRIMARY KEY, line_code VARCHAR(64), model VARCHAR(80), material VARCHAR(120),
      slot_no VARCHAR(40), machine_no VARCHAR(64), locked INTEGER DEFAULT 0,
      hits INTEGER DEFAULT 0, by_user VARCHAR(120), created_at TIMESTAMPTZ DEFAULT now())`);
  } catch { /* ignore */ }
  await loadParams();
  return true;
}

/** Parse a reel label: 6 `*`-separated segments, find the material code in the first 3. */
export function parseReel(code) {
  const out = { materialCode: "", lotNo: "", dc: "", qty: 0, reelSn: "", rj: "", raw: String(code || "") };
  const text = String(code || "").trim();
  if (!text) return out;
  const sep = text.includes("*") ? "*" : text.includes("|") ? "|" : null;
  if (!sep) { out.materialCode = text; out.rj = text; return out; }
  const parts = text.split(sep).map(x => x.trim());
  const candidate = parts.slice(0, 3).find(x => /-HF$/i.test(x) || (x.match(/\./g) || []).length >= 2);
  out.materialCode = candidate || parts[0] || "";
  out.lotNo = parts[1] || "";
  out.dc = parts[2] || "";
  out.qty = Number(parts[3]) || 0;
  out.reelSn = parts[4] || "";
  out.rj = candidate || parts[5] || out.materialCode;
  return out;
}

function norm(s) { return String(s || "").trim().toUpperCase().replace(/[\s\-_]/g, ""); }

export async function feederSlotMatch(machine, slot, model, scanned, strictMode = feederSlotStrict()) {
  const result = { ok: false, level: "block", kind: "none", cfg: null, expect: "", alts: [], why: "", models: [], devCh: `${machine || ""} ${slot || ""}` };
  if (!machine || !slot) return { ...result, ok: true, level: "warn", why: "未填设备/通道，跳过站位校验" };
  let rows = [];
  try {
    rows = (await query(
      `SELECT * FROM md_feeder_slot WHERE UPPER(machine_no)=UPPER($1) AND UPPER(slot_no)=UPPER($2)`,
      [machine, slot]
    )).rows;
  } catch { /* ignore */ }
  if (!rows.length) {
    return { ...result, ok: !strictMode, level: strictMode ? "block" : "warn", why: `站位未维护：${machine} ${slot}` };
  }
  const models = [...new Set(rows.map(r => String(r.model || "").trim()).filter(Boolean))];
  result.models = models;
  const scan = norm(scanned);
  for (const r of rows) {
    if (model && String(r.model || "").trim() && norm(model) !== norm(r.model)) continue;
    const expect = String(r.material_code || "").trim();
    const altRows = (await query(`SELECT material_code FROM md_feeder_slot_alt WHERE slot_id=$1`, [r.id])).rows.map(x => x.material_code);
    const codes = [expect, ...altRows].filter(Boolean);
    result.expect = expect;
    result.alts = codes;
    result.cfg = r;
    if (codes.some(c => norm(c) === scan)) {
      return { ...result, ok: true, level: "ok", kind: norm(expect) === scan ? "main" : "alt" };
    }
  }
  return { ...result, why: `物料 ${scanned} 与站位配置不符` };
}

export async function moModelSoft(mo) {
  if (!mo) return "";
  if (typeof mo === "string") return mo;
  return mo.model || mo.model_code || mo.product_code || "";
}

export async function modelMatch(a, b) {
  if (!a || !b) return false;
  return norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

// ── Baseline (smt_baseline.py) ────────────────────────────────────────────
export async function baselineConfig({ enabled, lockHits } = {}) {
  // 源 core/smt_baseline.py 用 util.set_param 落 sys_param（全厂生效）；
  // 早期版本只改内存 PARAMS，重启就丢，现已补上持久化。
  const put = async (key, val, name) => {
    PARAMS[key] = String(val);
    await query(
      `INSERT INTO sys_param (param_key, param_val, param_name, group_name, updated_at)
       VALUES ($1,$2,$3,'SMT',now())
       ON CONFLICT (param_key) DO UPDATE
          SET param_val=EXCLUDED.param_val, param_name=EXCLUDED.param_name, updated_at=now()`,
      [key, String(val), name]);
  };
  if (enabled !== undefined) await put("smt.baseline_enabled", enabled ? "1" : "0", "上料基准学习开关（1=学习并自动带出）");
  if (lockHits !== undefined) await put("smt.baseline_lock_hits", String(lockHits), "同一位置累计几次后自动固化（转强制校验）");
  return { enabled: String(PARAMS["smt.baseline_enabled"] ?? "1") !== "0", lockHits: Number(PARAMS["smt.baseline_lock_hits"] || 3) };
}
export async function baselineList(params = {}) {
  try {
    const r = await query(`SELECT * FROM prd_smt_baseline ORDER BY id DESC LIMIT 200`);
    return r.rows;
  } catch { return []; }
}
export async function baselineStats() {
  try {
    const r = await query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE locked=1)::int AS locked FROM prd_smt_baseline`);
    return r.rows[0] || { total: 0, locked: 0 };
  } catch { return { total: 0, locked: 0 }; }
}
export async function baselineLock(id, locked, by) {
  try { await query(`UPDATE prd_smt_baseline SET locked=$2,by_user=$3 WHERE id=$1`, [id, locked, by]); } catch { /* ignore */ }
  return { id, locked };
}
export async function baselineClear(id, by) {
  try { await query(`DELETE FROM prd_smt_baseline WHERE id=$1`, [id]); } catch { /* ignore */ }
  return { id, cleared: true, by };
}
export async function baselineVerify(line, model, material, slot) {
  const rows = await baselineList({});
  const hit = rows.find(r => (!line || r.line_code === line) && (!model || r.model === model) && (!material || r.material === material));
  return { ok: Boolean(hit), hit: hit || null };
}
export async function baselineLearn(line, model, material, slot, machine) {
  try {
    const r = await query(
      `INSERT INTO prd_smt_baseline (line_code,model,material,slot_no,machine_no,hits,created_at)
       VALUES ($1,$2,$3,$4,$5,1,now()) RETURNING id`,
      [line || "", model || "", material || "", slot || "", machine || ""]
    );
    return { id: r.rows[0]?.id, learned: true };
  } catch { return { learned: false }; }
}

// ── Paste / stencil / PCB state helpers (smt.py) ──────────────────────────
export function pasteStateText(s) {
  // legacy _paste_state_text(row, now=None) -> [txt, state]
  const row = (s && typeof s === "object") ? s : {};
  const st = row.status ?? String(s || "");
  const now = new Date();
  const fmtLeft = (target) => {
    const t = new Date(String(target || "").replace(" ", "T"));
    if (isNaN(t.getTime())) return null;
    return Math.round((t.getTime() - now.getTime()) / 60000);
  };
  if (st === "回温中") {
    const left = fmtLeft(row.plan_ready_time);
    if (left == null) return ["回温中", "ing"];
    if (left > 0) return [`回温中（还需 ${left} 分钟）`, "ing"];
    return ["回温已完成，可开封", "ready"];
  }
  if (st === "已回温") return ["回温完成，未开封", "ready"];
  if (st === "使用中") {
    const left = fmtLeft(row.expire_time);
    if (left == null) return ["使用中", "using"];
    if (left > 0) return [`使用中（剩 ${left} 分钟）`, "using"];
    return ["已过期！禁止使用", "expired"];
  }
  if (st === "已退回") return [`已退回冷藏（${row.recover_count || 0} 次回温）`, "returned"];
  if (st === "已用完") return ["已用完", "done"];
  if (st === "已报废") return ["已报废", "scrap"];
  return [String(st || "-") || "-", ""];
}
export function pasteLimits(ptype = "锡膏") {
  if ((ptype || "").trim() == "红胶") {
    return [Number(smtParam("smt.glue_min_hours", "2") || 2), Number(smtParam("smt.glue_max_hours", "4") || 4), Number(smtParam("smt.glue_open_hours", "12") || 12)];
  }
  return [Number(smtParam("smt.solder_min_hours", "4") || 4), Number(smtParam("smt.solder_max_hours", "6") || 6), Number(smtParam("smt.solder_open_hours", "8") || 8)];
}
export function pasteCheckDyn(ctx = {}) {
  // compatible with legacy _paste_check_dyn(row, now=None) -> [txt, state]
  // NOTE: legacy is synchronous — callers destructure the return value directly.
  const { paste_type: ptype = "锡膏", status, plan_ready_time, release_time, recover_count, expire_time } = ctx;
  const now = new Date();
  const [mn, mx, _opn] = pasteLimits(ptype);
  if (status == "回温中" || status == "已回温") {
    const t = String(plan_ready_time || "").trim();
    if (t) {
      try {
        const t0 = new Date(t.replace(" ", "T"));
        if (!isNaN(t0.getTime())) {
          const el = (now.getTime() - t0.getTime()) / 3600000;
          const left = Math.max(0, Math.round(mn * 60 - el * 60));
          if (el < 0) return [`待回温中（还需 ${left} 分钟，最小回温${mn}H）`, "ing"];
          if (el > mx) {
            if (release_time) return [`回温超时但已品质放行（${release_time}），可继续使用`, "released"];
            return [`回温已超最大时限（${mx}H），需品质放行`, "overtime"];
          }
          return [`回温完成（${mn}H），请搅拌后使用`, "ready"];
        }
      } catch { /* fall through */ }
    }
  }
  if (status == "已搅拌") return ["已搅拌，可开封使用", "ready"];
  if (status == "使用中") {
    const ex = String(expire_time || "").trim();
    if (ex) {
      try {
        const t = new Date(ex.replace(" ", "T"));
        if (!isNaN(t.getTime())) {
          const left = Math.round((t.getTime() - now.getTime()) / 60000);
          if (left > 0) return [`使用中（剩${left}分钟）`, "using"];
          return ["开封超时！禁止继续使用", "expired"];
        }
      } catch { /* fall through */ }
    }
    return ["使用中", "using"];
  }
  if (status == "已退回") return [`已退回冷藏（${recover_count || 0} 次回温）`, "returned"];
  if (status == "已用完") return ["已用完", "done"];
  if (status == "已报废") return ["已报废", "scrap"];
  return [String(status || "-") || "-", ""];
}
export async function pasteMaterial(code) {
  // legacy _paste_material(code) -> [row, ptype]
  try {
    const row = (await query(`SELECT * FROM md_material WHERE material_code=$1 OR vn_code=$1 LIMIT 1`, [code])).rows[0]
      || (await query(`SELECT * FROM materials WHERE code=$1 LIMIT 1`, [code])).rows[0]
      || null;
    if (!row) return [null, "锡膏"];
    const name = String(row.material_name || "").toUpperCase();
    const ptype = (name.includes("红胶") || name.includes("GLUE")) ? "红胶" : "锡膏";
    return [row, ptype];
  } catch { return [null, "锡膏"]; }
}
export async function pasteRow(d) {
  // legacy _paste_row(d) -> row | None (id, or material_code+batch_no)
  try {
    const o = (d && typeof d === "object") ? d : { id: d };
    if (o.id) return (await query(`SELECT * FROM prd_paste_recover WHERE id=$1`, [o.id])).rows[0] || null;
    const code = String(o.material_code || "").trim();
    const batch = String(o.batch_no || "").trim();
    if (code && batch) {
      const r = (await query(`SELECT * FROM prd_paste_recover WHERE material_code=$1 AND batch_no=$2 ORDER BY id DESC LIMIT 1`, [code, batch])).rows[0];
      if (r) return r;
    }
    return null;
  } catch { return null; }
}
function minutesLeft(target, now = new Date()) {
  const t = new Date(String(target || "").replace(" ", "T"));
  if (isNaN(t.getTime())) return null;
  return Math.round((t.getTime() - now.getTime()) / 60000);
}
export function stencilState(st) {
  // legacy _stencil_state(st, now=None) -> [txt, state]
  const o = (st && typeof st === "object") ? st : {};
  const now = new Date();
  if (o.status === "已报废") return [`已报废（${o.scrap_reason || ""}）`, "scrap"];
  if (o.status === "待报废") return [`待报废：寿命用尽（${o.used_print_times}/${o.max_print_times} 次）`, "expired"];
  const used = Number(o.used_print_times || 0);
  const mx = Number(o.max_print_times || 0);
  if (used >= mx) return [`待报废：寿命用尽（${used}/${mx} 次）`, "expired"];
  const deep = Number(o.deep_clean_times || 0);
  const warn = Number(o.clean_warn_times || 0);
  if (deep && used >= deep) return [`需深度清洗（累计 ${used} 次，阈值 ${deep}）`, "warn_deep"];
  if (warn && used >= warn) return [`需简易清洗（累计 ${used} 次，阈值 ${warn}）`, "warn_clean"];
  return [`正常（累计 ${used}/${mx} 次）`, "ok"];
}
export async function stencilConsume(id, qty) {
  try { await query(`UPDATE prd_stencil SET used_count=COALESCE(used_count,0)+$2 WHERE id=$1`, [id, Number(qty) || 1]); } catch { /* ignore */ }
  return { id, consumed: Number(qty) || 1 };
}
export function pcbState(r) {
  // legacy _pcb_state(r, now=None) -> [txt, state]
  const o = (r && typeof r === "object") ? r : {};
  const now = new Date();
  const fmt = (target) => {
    const t = new Date(String(target || "").replace(" ", "T"));
    if (isNaN(t.getTime())) return "--";
    const p = n => String(n).padStart(2, "0");
    return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
  };
  if (o.status === "已报废") return ["已报废", "scrap"];
  if (o.status === "待拆封") return ["待拆封", "idle"];
  if (o.status === "已拆封") {
    const t = new Date(String(o.unseal_time || "").replace(" ", "T"));
    if (!isNaN(t.getTime())) {
      const hours = Number(smtParam("smt.pcb_unseal_hours", "168") || 168);
      const lim = new Date(t.getTime() + hours * 3600000);
      const left = Math.round((lim.getTime() - now.getTime()) / 60000);
      if (left > 0) return [`已拆封（剩 ${left} 分钟，超时需烘烤）`, "ok"];
      return [`✕ 拆封超时（${fmt(lim)}），必须烘烤后才能上线`, "expired"];
    }
    return ["已拆封", "ok"];
  }
  if (o.status === "已烘烤") {
    const left = minutesLeft(o.last_valid_until, now);
    if (left != null) {
      if (left > 0) return [`已烘烤（剩 ${left} 分钟）`, "ok"];
      return [`✕ 烘烤时效已过（${fmt(o.last_valid_until)}），禁止上线`, "expired"];
    }
    return ["已烘烤", "ok"];
  }
  return [String(o.status || "-") || "-", ""];
}
