// ============================================================================
// 超音波扫码排队（源 D:\c\Users\tianj\ruijing-mes @ b374884 api/ultra.py）
//
// 现场问题：超声焊机不防呆，员工扫了没扫上 / 干脆没扫，MES 完全不知道，板子一路
// 流到老化才被「跳站」拦下。本模块只做两件事，不依赖焊机协议、不依赖 485：
//   ① 扫码即时报状态 —— 建档？过过 ATE1？待修？重复？扫一下立刻知道；
//   ② 排队 FIFO —— 扫过的板按顺序排队，焊机每报一次「焊完」就出队一块。
//
// ⚠ 本模块不写过站：过站仍以焊机上传的加工结果为准。队列只负责「谁在排队、
//   轮到了谁、有没有人漏扫」，避免把未焊的板记成已焊。
//
// 注册分两段（与 routes/mesrj.js 的两段式一致，见 CLAIM-mesrj-*）：
//   registerUltraDeviceRoutes  —— X-Api-Key 鉴权，必须注册在 JWT 中间件之前
//   registerUltraConsoleRoutes —— 登录态路由，注册在 JWT 中间件之后
//
// 相对源实现的差异（都是 SMT-first，不改契约）：
//   1. 不建表：runtime DDL 换成迁移 334（prd_ultra_queue / prd_ultra_weld_raw /
//      cfg_ultra_limit / cfg_ultra_user / cfg_ultra_param）
//   2. 时间列是 timestamptz，读出来用 to_char 还原源端的 'YYYY-MM-DD HH:MM:SS'
//      字面量（前端按字面量切片取小时，改格式会静默算错 UPH）
//   3. 「今天」= 进程本地日界（created_at >= 本地零点 AND < 次日零点），替代源的
//      substr(created_at,1,10)=?（源端是 TEXT 列，SMT 是 timestamptz）
//   4. 工位屏密码用 scrypt（scrypt$N$r$p$salt$hash，与 server.js 同一格式），
//      源端是明文；迁移 334 的种子账号密码是不可猜随机串，现场必须改一次
//   5. 出队用单条 UPDATE ... RETURNING 完成（源端是 select-then-update），
//      语义与返回顺序不变，避免并发下同一块板被两个「焊完」同时出队
// ============================================================================
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { keyOk, clearKeyCache } from "./device-key.js";

const STATION = "ASSY-L01-ULTRASONIC";
const ATE1 = "ASSY-L01-ATE1";
const WAIT = "等待焊";
const DONE = "已完成";
const TIMEOUT = "超时未焊";
const VOID = "已撤销";
const TIMEOUT_MIN = 30;          // 扫码后多久没焊就判超时
const SN_RE = /^[0-9A-Z]{10}$/;

/**
 * deps.query 是 mesrj 的 pg 薄封装，返回的是 pg Result（取行要 .rows）。
 * 本模块内部统一走 qrows() 拿数组，避免每个调用点都写 .rows。
 */
async function qrows(query, sql, params) {
  const r = await query(sql, params);
  return r?.rows ?? [];
}

export const LIMIT_DEFAULT = {
  time_min: 26, time_max: 200, energy_min: 20, energy_max: 1000,
  power_min: 143, power_max: 3000,
};

// 参数维护种子（源 PARAM_SEED；迁移 334 已种同样一份，这里只用于空库兜底）
export const PARAM_SEED = [
  ["weld_time", "发波时间", "s", "焊接参数", 0.55, 0.05, 5.0, "engineer"],
  ["delay_time", "延迟时间", "s", "焊接参数", 0.60, 0.0, 5.0, "engineer"],
  ["cure_time", "固化时间", "s", "焊接参数", 0.20, 0.0, 5.0, "engineer"],
  ["amplitude", "振幅", "%", "焊接参数", 75, 10, 100, "engineer"],
  ["freq", "频率", "kHz", "焊接参数", 14.85, 14.0, 16.0, "engineer"],
  ["limit_time_min", "判定-时间下限", "s", "判定阈值", 0.26, 0.0, 10.0, "engineer"],
  ["limit_time_max", "判定-时间上限", "s", "判定阈值", 2.00, 0.0, 10.0, "engineer"],
  ["limit_energy_min", "判定-能量下限", "J", "判定阈值", 20, 0, 5000, "engineer"],
  ["limit_energy_max", "判定-能量上限", "J", "判定阈值", 1000, 0, 5000, "engineer"],
  ["limit_power_min", "判定-功率下限", "W", "判定阈值", 143, 0, 5000, "engineer"],
  ["limit_power_max", "判定-功率上限", "W", "判定阈值", 3000, 0, 5000, "engineer"],
  ["queue_timeout_min", "排队超时", "分钟", "流程控制", 30, 1, 600, "operator"],
];

// ── 时间工具 ────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, "0"); }

/** 进程本地「今天」的 'YYYY-MM-DD'（源 datetime.date.today()） */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 本地 'YYYY-MM-DD HH:MM:SS'（源 _now()） */
function nowStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 'YYYY-MM-DD' → [本地零点, 次日零点)，给 timestamptz 做半开区间比较 */
function dayBounds(day) {
  const s = String(day || "").trim() || todayStr();
  const [y, m, d] = s.split("-").map(Number);
  const from = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 1);
  return { day: `${y}-${pad2(m || 1)}-${pad2(d || 1)}`, from, to };
}

function dayStart(daysAgo) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

// ── 密码（工位屏账号）──────────────────────────────────────────────────────

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KLEN = 32;

/** scrypt$N$r$p$<b64 salt>$<b64 hash> —— 与 services/api/server.js 同格式 */
export function hashStationPassword(plain) {
  const salt = randomBytes(16).toString("base64");
  const hash = scryptSync(String(plain), salt, SCRYPT_KLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash.toString("base64")}`;
}

export function verifyStationPassword(plain, stored) {
  const parts = String(stored ?? "").split("$");
  // 非 scrypt 形状（含迁移 334 种下的随机 hex）= 不可登录，必须现场改密
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, encoded] = parts;
  try {
    const expected = Buffer.from(encoded, "base64");
    if (!expected.length || !salt) return false;
    const actual = scryptSync(String(plain), salt, expected.length,
      { N: Number(N), r: Number(r), p: Number(p) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── 设备密钥（X-Api-Key）───────────────────────────────────────────────────
// 实现在 ./device-key.js（laser/… 等设备模块共用），这里只做再导出，
// 让 clearKeyCache 的既有调用点（阈值变更后立即失效缓存）不用改。

export { clearKeyCache };

// ── 判定阈值（源 _limit_of：主来源 cfg_ultra_param，兜底 cfg_ultra_limit）───

async function ensureParam(query) {
  for (const [k, label, unit, grp, val, vmin, vmax, role] of PARAM_SEED) {
    await qrows(query, 
      `INSERT INTO cfg_ultra_param (pkey,label,unit,group_name,val,vmin,vmax,editable_role,note,updated_at,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',now(),'init')
       ON CONFLICT (pkey) DO NOTHING`,
      [k, label, unit, grp, val, vmin, vmax, role]);
  }
}

async function ensureLimit(query) {
  await qrows(query, 
    `INSERT INTO cfg_ultra_limit (model,time_min,time_max,energy_min,energy_max,power_min,power_max,enabled,note,updated_at,updated_by)
     VALUES ('*',$1,$2,$3,$4,$5,$6,1,'默认（与设备面板一致）',now(),'init')
     ON CONFLICT (model) DO NOTHING`,
    [LIMIT_DEFAULT.time_min, LIMIT_DEFAULT.time_max, LIMIT_DEFAULT.energy_min,
     LIMIT_DEFAULT.energy_max, LIMIT_DEFAULT.power_min, LIMIT_DEFAULT.power_max]);
}

/** 取判定阈值。时间单位换算：参数表是「秒」，判定用 weld_ms 是 0.01 秒 → ×100 */
export async function limitOf(query) {
  try {
    await ensureParam(query);
    const rows = await qrows(query, "SELECT pkey, val FROM cfg_ultra_param");
    const kv = {};
    for (const r of rows) {
      const v = Number(r.val);
      if (Number.isFinite(v)) kv[String(r.pkey).trim()] = v;
    }
    if ("limit_time_min" in kv || "limit_energy_max" in kv) {
      const g = (k, d) => (kv[k] !== undefined ? kv[k] : d);
      return {
        time_min: g("limit_time_min", 0.26) * 100.0,
        time_max: g("limit_time_max", 2.00) * 100.0,
        energy_min: g("limit_energy_min", 20),
        energy_max: g("limit_energy_max", 1000),
        power_min: g("limit_power_min", 143),
        power_max: g("limit_power_max", 3000),
        enabled: 1,
      };
    }
  } catch { /* 落兜底 */ }
  try {
    await ensureLimit(query);
    const rows = await qrows(query, "SELECT * FROM cfg_ultra_limit WHERE model = '*'");
    if (rows[0]) return rows[0];
  } catch { /* ignore */ }
  return { ...LIMIT_DEFAULT };
}

/** 按阈值判定一次焊接。regs 是采集端原样值（时间 0.01s、功率 W、能量 J） */
export function judge(regs, lim) {
  const f = (k) => {
    const v = Number(regs?.[k]);
    return Number.isFinite(v) ? v : null;
  };
  if (["0", "False", "false"].includes(String(lim?.enabled ?? 1))) {
    return ["SKIP", "阈值未启用"];
  }
  const t = f("weld_ms"), e = f("energy"), p = f("power");
  const bad = [];
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const tmin = num(lim?.time_min), tmax = num(lim?.time_max);
  const emin = num(lim?.energy_min), emax = num(lim?.energy_max);
  const pmin = num(lim?.power_min), pmax = num(lim?.power_max);
  if (t !== null && tmin !== null && t < tmin) bad.push(`时间 ${(t / 100).toFixed(2)}s < 下限 ${(tmin / 100).toFixed(2)}s`);
  if (t !== null && tmax !== null && t > tmax) bad.push(`时间 ${(t / 100).toFixed(2)}s > 上限 ${(tmax / 100).toFixed(2)}s`);
  if (e !== null && emin !== null && e < emin) bad.push(`能量 ${e.toFixed(0)}J < 下限 ${emin.toFixed(0)}J`);
  if (e !== null && emax !== null && e > emax) bad.push(`能量 ${e.toFixed(0)}J > 上限 ${emax.toFixed(0)}J`);
  if (p !== null && pmin !== null && p < pmin) bad.push(`功率 ${p.toFixed(0)}W < 下限 ${pmin.toFixed(0)}W`);
  if (p !== null && pmax !== null && p > pmax) bad.push(`功率 ${p.toFixed(0)}W > 上限 ${pmax.toFixed(0)}W`);
  if (!bad.length) return ["OK", ""];
  return ["NG", bad.join("；")];
}

// ── 队列维护（懒执行：读接口时清一次，不常驻定时器）───────────────────────

async function sweep(query) {
  try {
    await qrows(query, 
      `UPDATE prd_ultra_queue
          SET status = $1,
              note = COALESCE(note,'') || ' 超时自动出队'
        WHERE status = $2 AND scanned_at < now() - make_interval(mins => $3)`,
      [TIMEOUT, WAIT, TIMEOUT_MIN]);
    await reconcile(query);
  } catch { /* 表不存在时静默（迁移未跑） */ }
}

/** 同一块板后来又有新记录时，把旧的挂起行（等待焊/超时未焊）作废 */
async function reconcile(query) {
  try {
    await qrows(query, 
      `UPDATE prd_ultra_queue q
          SET status = $1,
              note = COALESCE(q.note,'') || ' 后续已有熔接记录，自动作废'
        WHERE q.status IN ($2,$3)
          AND EXISTS (
            SELECT 1 FROM prd_ultra_queue d
             WHERE upper(d.sn) = upper(q.sn)
               AND d.id > q.id
               AND d.status IN ($4,$5))`,
      [VOID, WAIT, TIMEOUT, DONE, WAIT]);
  } catch { /* ignore */ }
}

async function todaySeq(query) {
  const { from, to } = dayBounds(todayStr());
  const rows = await qrows(query, 
    "SELECT COALESCE(MAX(queue_no),0) AS n FROM prd_ultra_queue WHERE created_at >= $1 AND created_at < $2",
    [from, to]);
  return Number(rows[0]?.n || 0) + 1;
}

/** 统一入队：同一块板只保留一条有效排队记录。返回 {ok, queue_no, how} */
export async function enqueue(query, sn, mo = "", pc = "", emp = "", machine = "") {
  const s = String(sn || "").trim().toUpperCase();
  if (!s) return { ok: false, queue_no: null, how: "empty" };
  try {
    const rows = await qrows(query, 
      `SELECT id, queue_no, status FROM prd_ultra_queue
        WHERE upper(sn) = $1 AND status IN ($2,$3)
        ORDER BY queue_no DESC LIMIT 1`,
      [s, WAIT, TIMEOUT]);
    const row = rows[0];
    if (row) {
      if (row.status === WAIT) {
        await qrows(query, "UPDATE prd_ultra_queue SET scanned_at = now() WHERE id = $1", [row.id]);
        return { ok: true, queue_no: row.queue_no, how: "dup" };
      }
      // 超时未焊 → 复活（不新增行，序号不变）
      await qrows(query, 
        `UPDATE prd_ultra_queue
            SET status = $1, scanned_at = now(), weld_at = NULL,
                note = replace(COALESCE(note,''), ' 超时自动出队', '')
          WHERE id = $2`,
        [WAIT, row.id]);
      return { ok: true, queue_no: row.queue_no, how: "revived" };
    }
    const qno = await todaySeq(query);
    await qrows(query, 
      `INSERT INTO prd_ultra_queue (queue_no,sn,mo_no,product_code,scanned_at,status,machine_no,emp,note,created_at)
       VALUES ($1,$2,$3,$4,now(),$5,$6,$7,'',now())`,
      [qno, s, mo || "", pc || "", WAIT, machine || "", emp || ""]);
    return { ok: true, queue_no: qno, how: "new" };
  } catch (e) {
    return { ok: false, queue_no: null, how: `err:${e?.message || e}` };
  }
}

/** 队头出队 n 块（等待焊 → 已完成）。返回 {popped: string[], empty: boolean} */
export async function popHead(query, n, machine) {
  await sweep(query);
  const want = Math.max(1, Number(n) || 1);
  // 单条 UPDATE 完成「取队头 + 改状态」，避免并发下同一块板被出队两次
  const rows = await qrows(query, 
    `UPDATE prd_ultra_queue q
        SET status = $1, weld_at = now(), machine_no = $2
       FROM (SELECT id FROM prd_ultra_queue
              WHERE status = $3 ORDER BY queue_no LIMIT $4) h
      WHERE q.id = h.id
      RETURNING q.queue_no, q.sn`,
    [DONE, String(machine || ""), WAIT, want]);
  const popped = rows.slice().sort((a, b) => Number(a.queue_no) - Number(b.queue_no))
    .map((r) => r.sn);
  return { popped, empty: popped.length === 0 };
}

// ── 参数写权限（源 _ultra_engineer：X-Token → ultra: 前缀工号）─────────────

export async function ultraEngineer(req, query, strictParam) {
  const tok = String(req.headers["x-token"] || "").trim();
  if (tok) {
    try {
      const claims = jwt.verify(tok, String(process.env.JWT_SECRET || "").trim());
      const ln = String(claims?.ln || "");
      if (ln.startsWith("ultra:")) {
        const emp = ln.slice(6);
        const rows = await qrows(query, 
          "SELECT role, enabled FROM cfg_ultra_user WHERE lower(emp_no) = lower($1)", [emp]);
        const row = rows[0];
        if (row && String(row.enabled ?? 1) === "1" && String(row.role || "") === "engineer") {
          return [true, emp, "token"];
        }
      }
    } catch { /* 过期/伪造 → 走开关判定 */ }
  }
  // 过渡期：没有 token 时看开关
  let strict = "0";
  if (strictParam !== undefined) strict = String(strictParam ?? "0").trim();
  else {
    try {
      const rows = await qrows(query, "SELECT param_val FROM sys_param WHERE param_key = 'ultra.params.require_token'");
      strict = String(rows[0]?.param_val ?? "0").trim();
    } catch { strict = "0"; }
  }
  if (strict === "1") return [false, "", "need_token"];
  return [true, "", "key_only"];
}

async function auditParamWrite(query, emp, how, n, ip) {
  try {
    await qrows(query, 
      `INSERT INTO sys_audit_log (user_name, module, action, target, detail, ip, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [emp || "(device-key)", "ultra", "param_write", "cfg_ultra_param",
       `改动 ${n} 项，鉴权方式=${how}`, String(ip || "")]);
  } catch { /* ignore */ }
}

/** 工位屏 token（login_name 加 ultra: 前缀，与 SMT 用户体系隔离） */
export function makeStationToken(empNo, hours = 12) {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) return "";
  return jwt.sign({ uid: 0, ln: `ultra:${empNo}`, typ: "ultra-station" }, secret,
    { expiresIn: `${hours}h` });
}

// ── 看板取数（源 _board_payload；看板与工位屏共用）─────────────────────────

const QUEUE_COLS = `id, queue_no, sn, mo_no, product_code,
  to_char(scanned_at,'YYYY-MM-DD HH24:MI:SS') AS scanned_at,
  to_char(weld_at,'YYYY-MM-DD HH24:MI:SS') AS weld_at,
  extract(epoch FROM scanned_at)::float8 AS scan_ep,
  extract(epoch FROM weld_at)::float8 AS weld_ep,
  status, machine_no, emp, note`;

export async function boardPayload(query, day, endDay) {
  await sweep(query);
  let start = String(day || "").trim() || todayStr();
  let end = String(endDay || start).trim() || start;
  if (end < start) { const t = start; start = end; end = t; }

  const a = dayBounds(start), b = dayBounds(end);
  const rows = await qrows(query, 
    `SELECT ${QUEUE_COLS} FROM prd_ultra_queue
      WHERE created_at >= $1 AND created_at < $2
      ORDER BY queue_no DESC`, [a.from, b.to]);

  // 焊接原始参数（同一天内每块板取最新一条）
  const params = {};
  try {
    const raw = await qrows(query, 
      `SELECT sn, registers, result, reason FROM prd_ultra_weld_raw
        WHERE created_at >= $1 AND created_at < $2 ORDER BY id DESC`, [a.from, a.to]);
    for (const r of raw) {
      const sn = String(r.sn || "").toUpperCase();
      if (!sn || sn in params) continue;
      let g = r.registers;
      if (typeof g === "string") { try { g = JSON.parse(g); } catch { g = {}; } }
      params[sn] = { ...(g && typeof g === "object" ? g : {}) };
      params[sn]._result = r.result || "";
      params[sn]._reason = r.reason || "";
    }
  } catch { /* 表空/无列 */ }

  // 料号 → 机型（队列只存 product_code，机型在产品主数据里）
  const modelOf = {};
  try {
    const prods = await qrows(query, "SELECT product_code, product_model, product_name FROM md_product");
    for (const r of prods) {
      const k = String(r.product_code || "").trim();
      if (k) modelOf[k] = [r.product_model || "", r.product_name || ""];
    }
  } catch { /* ignore */ }

  const now = new Date();
  const nowSec = now.getTime() / 1000;
  const items = [];
  const hourly = new Array(24).fill(0);
  const byMo = {};
  const cnt = { [WAIT]: 0, [DONE]: 0, [TIMEOUT]: 0, [VOID]: 0 };
  const slots = new Set();

  for (const r of rows) {
    const st = String(r.status || "").trim();
    const sn = String(r.sn || "").toUpperCase();
    cnt[st] = (cnt[st] || 0) + 1;
    const p = params[sn] || {};
    let waitMin = null;
    if (st === WAIT && r.scan_ep != null) {
      waitMin = Math.floor((nowSec - Number(r.scan_ep)) / 60);
    }
    const weldAt = r.weld_at || "";
    if (st === DONE && weldAt) {
      const hh = Number(weldAt.slice(11, 13));
      if (Number.isInteger(hh) && hh >= 0 && hh < 24) {
        hourly[hh] += 1;
        slots.add(`${weldAt.slice(0, 10)}#${hh}`);
      }
      const mo = String(r.mo_no || "").trim() || "(无工单)";
      byMo[mo] = (byMo[mo] || 0) + 1;
    }
    // 已完成：实际等待 = 焊完 - 扫码
    let waitSec = null;
    if (st === DONE && r.scan_ep != null && r.weld_ep != null) {
      const sec = Math.round(Number(r.weld_ep) - Number(r.scan_ep));
      if (sec >= 0) waitSec = sec;
    }
    const mp = modelOf[String(r.product_code || "").trim()] || ["", ""];
    items.push({
      id: r.id, queue_no: r.queue_no, sn,
      mo_no: r.mo_no || "", product_code: r.product_code || "",
      scanned_at: r.scanned_at || "", weld_at: weldAt,
      status: st, wait_min: waitMin, wait_sec: waitSec, note: r.note || "",
      energy: p.energy ?? null, power: p.power ?? null, weld_ms: p.weld_ms ?? null,
      amp: p.amp ?? null, freq: p.freq ?? null, count: p.count ?? null,
      delay_ms: p.delay_ms ?? null, cure_ms: p.cure_ms ?? null, volt: p.volt ?? null,
      result: p.result || p._result || "",
      reason: p._reason || "",
      product_model: mp[0], product_name: mp[1],
    });
  }
  const total = items.length;

  // ---- UPH / 平均等待 / 节拍（只算已完成，样本太小时不给数值）----
  const doneList = items.filter((x) => x.status === DONE && x.weld_at && x.scanned_at);
  let uph = null, cycleSec = null, avgWaitSec = null;
  if (doneList.length) {
    const waits = doneList.filter((x) => x.wait_sec != null).map((x) => x.wait_sec);
    if (waits.length) avgWaitSec = Math.trunc(waits.reduce((s, v) => s + v, 0) / waits.length);
    // UPH = 完成数 / 有产出的「日期+小时」槽位数（不含午休/停线的空窗）
    if (slots.size) uph = Math.round((doneList.length / slots.size) * 10) / 10;
    // 节拍：相邻两块焊完的间隔中位数，剔除 >15 分钟的停机间隔
    // （取 rows 而不是 items：items 是对外契约，不加 _ep 这类内部字段）
    const ts = rows
      .filter((r) => String(r.status || "").trim() === DONE && r.weld_ep != null)
      .map((r) => Number(r.weld_ep)).sort((x, y) => x - y);
    const gaps = [];
    for (let i = 1; i < ts.length; i += 1) {
      const g = ts[i] - ts[i - 1];
      if (g > 0 && g <= 900) gaps.push(g);
    }
    gaps.sort((x, y) => x - y);
    if (gaps.length) cycleSec = Math.trunc(gaps[Math.floor(gaps.length / 2)]);
    else if (avgWaitSec != null) cycleSec = avgWaitSec;
  }

  return {
    date: a.day, date_end: b.day, is_range: a.day !== b.day, items,
    stats: {
      wait: cnt[WAIT] || 0, done: cnt[DONE] || 0,
      uph, cycle_sec: cycleSec, avg_wait_sec: avgWaitSec,
      timeout: cnt[TIMEOUT] || 0, void: cnt[VOID] || 0,
      total,
      pass_rate: total ? Math.round(((cnt[DONE] || 0) * 1000) / total) / 10 : 0,
    },
    hourly,
    by_mo: Object.entries(byMo).sort((x, y) => y[1] - x[1])
      .map(([mo_no, done]) => ({ mo_no, done })),
    station: STATION,
    limit: await limitOf(query),
    server_time: nowStr(now),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 设备侧路由（X-Api-Key 鉴权）——必须在 router.use(authenticateJWT) 之前注册
// ═══════════════════════════════════════════════════════════════════════════

export function registerUltraDeviceRoutes(router, deps) {
  const { query, ok, fail } = deps;

  // 焊完一次 → 队头出队（干接点 / 485 / 手工按钮都打这里）
  router.post("/ultra/weld-done", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    const d = req.body || {};
    const machine = String(d.machine_no || "ULTRASONIC-01").trim();
    const n = Math.max(1, Number(d.count) || 1);
    const { popped, empty } = await popHead(query, n, machine);
    if (empty) {
      // 空焊：焊机报了一次但队列为空 —— 有人没扫码，必须报警
      return ok(res, {
        popped: [], alarm: true,
        msg: "焊机报了一次焊接完成，但队列里没有等待的板 —— 有人漏扫码！",
      }, "队列为空（漏扫报警）");
    }
    return ok(res, { popped, alarm: false, msg: `出队：${popped.join("、")}` },
      `出队 ${popped.length} 块`);
  });

  // 采集程序推一次焊接结果：出队 + 存原始寄存器快照（不写过站）
  router.post("/ultra/weld-data", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    const d = req.body || {};
    let sn = String(d.sn || "").trim().toUpperCase();
    const machine = String(d.machine_no || "ULTRASONIC-01").trim();
    const regs = d.registers && typeof d.registers === "object" ? d.registers : {};

    // ★ 判定放在 MES：阈值可维护（cfg_ultra_param），采集端只报原始值
    let verdict = "SKIP", why = "判定异常";
    try {
      const lim = await limitOf(query);
      [verdict, why] = judge(regs, lim);
    } catch { /* 保持 SKIP */ }

    const { popped, empty } = await popHead(query, 1, machine);
    if (!sn && popped.length) sn = popped[0];
    let qid = null;
    if (sn) {
      const rows = await qrows(query, 
        "SELECT id FROM prd_ultra_queue WHERE upper(sn) = $1 ORDER BY id DESC LIMIT 1", [sn]);
      qid = rows[0]?.id ?? null;
    }
    try {
      await qrows(query, 
        `INSERT INTO prd_ultra_weld_raw (sn,machine_no,queue_id,registers,result,reason,created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,now())`,
        [sn, machine, qid, JSON.stringify(regs), verdict, why]);
    } catch { /* 原始快照失败不影响出队结果 */ }

    // 同时写一条「设备上报数据」，让设备上报页 / 看板 / OEE 都能看到超声这一枪
    if (sn) {
      try {
        const dup = await qrows(query, 
          `SELECT 1 FROM prd_machine_data
            WHERE upper(sn) = $1 AND machine_no = $2 AND created_at >= now() - interval '60 seconds'
            LIMIT 1`, [sn, machine]);
        if (!dup.length) {
          let mo = "";
          const r0 = await qrows(query, 
            "SELECT mo_no FROM prd_ultra_queue WHERE upper(sn) = $1 ORDER BY id DESC LIMIT 1", [sn]);
          mo = r0[0]?.mo_no || "";
          if (!mo) {
            const r1 = await qrows(query, "SELECT mo_no FROM prd_sn WHERE upper(sn) = $1", [sn]);
            mo = r1[0]?.mo_no || "";
          }
          await qrows(query, 
            `INSERT INTO prd_machine_data
               (sn,machine_no,machine_type,station_code,mo_no,pass_ng,ng_info,end_time,create_by,created_at)
             VALUES ($1,$2,'ULTRASONIC',$3,$4,$5,$6,now(),'485采集',now())`,
            [sn, machine, STATION, mo, verdict, why]);
        }
      } catch { /* 设备上报数据是旁路，失败不阻断 */ }
    }

    let msg = sn ? `已记录 ${sn}（${verdict}）` : "队列为空，已存原始数据";
    if (verdict === "NG" && why) msg += ` · ${why}`;
    return ok(res, { sn, popped, alarm: empty, result: verdict, reason: why, msg });
  });

  // 工位屏取数：现场机器没有登录态，用设备密钥
  router.get("/ultra/station", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    const day = String(req.query.date || "").trim() || todayStr();
    const d = await boardPayload(query, day);
    d.waiting = d.items.filter((x) => x.status === WAIT).reverse();
    d.recent = d.items.filter((x) => x.status === DONE).slice(0, 8);
    // 工位屏脚本按字面比较「等待焊」；res.json 不转义中文，契约与源端一致
    return ok(res, d);
  });

  // 工位屏登录：账号密码 → 角色（operator / engineer）。设备密钥鉴权。
  router.post("/ultra/station/login", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    const d = req.body || {};
    const emp = String(d.emp_no || "").trim().toLowerCase();
    const pwd = String(d.password || "").trim();
    try {
      const rows = await qrows(query, 
        "SELECT emp_no, emp_name, role, enabled, password FROM cfg_ultra_user WHERE lower(emp_no) = $1",
        [emp]);
      const row = rows[0];
      if (!row) return fail(res, "账号不存在");
      if (!verifyStationPassword(pwd, row.password)) return fail(res, "密码不对");
      if (String(row.enabled ?? 1) !== "1") return fail(res, "账号已停用");
      return ok(res, {
        emp_no: row.emp_no, emp_name: row.emp_name || "",
        role: row.role || "operator",
        token: makeStationToken(row.emp_no, 12),
      }, "登录成功");
    } catch (e) {
      return fail(res, `登录异常：${e?.message || e}`);
    }
  });

  // 账号维护（工程师）：列出 / 新增 / 改密
  router.get("/ultra/station/users", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    const rows = await qrows(query, 
      "SELECT emp_no, emp_name, role, enabled FROM cfg_ultra_user ORDER BY role DESC, emp_no");
    return ok(res, { rows });
  });

  router.post("/ultra/station/users", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    const d = req.body || {};
    const emp = String(d.emp_no || "").trim().toLowerCase();
    const pwd = String(d.password || "").trim();
    let role = String(d.role || "operator").trim();
    const name = String(d.emp_name || "").trim();
    if (!emp || !pwd) return fail(res, "账号和密码都要填");
    if (role !== "operator" && role !== "engineer") role = "operator";
    const hash = hashStationPassword(pwd);
    // 源端明文比对；SMT 一律 scrypt，改密走 UPSERT，不再保留明文分支
    await qrows(query, 
      `INSERT INTO cfg_ultra_user (emp_no, emp_name, password, role, enabled, updated_at)
       VALUES ($1,$2,$3,$4,1,now())
       ON CONFLICT (emp_no) DO UPDATE
          SET password = EXCLUDED.password,
              role = EXCLUDED.role,
              emp_name = EXCLUDED.emp_name,
              updated_at = now()`,
      [emp, name, hash, role]);
    return ok(res, { emp_no: emp }, "已保存");
  });

  // 参数维护：GET 列表 / POST 保存（现场改完即刻生效）
  router.get("/ultra/params", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    await ensureParam(query);
    const rows = await qrows(query, "SELECT * FROM cfg_ultra_param ORDER BY group_name, pkey");
    return ok(res, { rows });
  });

  router.post("/ultra/params", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    await ensureParam(query);
    const d = req.body || {};
    // 写操作必须有工程师权限（设备密钥只读不写）
    const [canWrite, emp, how] = await ultraEngineer(req, query);
    if (!canWrite) return fail(res, "改参数需要工程师账号登录（设备密钥只能读取）", 403);

    const items = Array.isArray(d.items) ? d.items : [];
    if (!items.length) return fail(res, "没有要保存的参数");
    const bad = [];
    let saved = 0;
    for (const it of items) {
      const k = String(it?.pkey || "").trim();
      if (!k) continue;
      const rows = await qrows(query, "SELECT * FROM cfg_ultra_param WHERE pkey = $1", [k]);
      const row = rows[0];
      if (!row) continue;
      const v = Number(it?.val);
      if (!Number.isFinite(v)) { bad.push(`${k} 不是数字`); continue; }
      if (row.vmin != null && v < Number(row.vmin)) { bad.push(`${k} 低于下限 ${row.vmin}`); continue; }
      if (row.vmax != null && v > Number(row.vmax)) { bad.push(`${k} 高于上限 ${row.vmax}`); continue; }
      await qrows(query, 
        "UPDATE cfg_ultra_param SET val = $1, updated_at = now(), updated_by = $2 WHERE pkey = $3",
        [v, String(d.emp_no || "").trim(), k]);
      saved += 1;
    }
    if (bad.length) return fail(res, `部分未保存：${bad.slice(0, 4).join("；")}`);
    await auditParamWrite(query, emp || String(d.emp_no || "").trim(), how, saved, req.ip);
    let msg = `已保存 ${saved} 项`;
    if (how === "key_only") msg += "（当前未强制工程师登录，建议尽快启用）";
    return ok(res, { saved, auth: how }, msg);
  });

  // 参数波动曲线：按小时/天聚合 能量、功率、发波时间、频率
  router.get("/ultra/trend", async (req, res) => {
    if (!(await keyOk(req, query))) return fail(res, "鉴权失败", 401);
    let days = Number(req.query.days) || 1;
    days = Math.max(1, Math.min(30, days));
    const bucket = String(req.query.bucket || "hour").trim();
    const since = dayStart(days - 1);
    const rows = await qrows(query, 
      "SELECT registers, created_at FROM prd_ultra_weld_raw WHERE created_at >= $1 ORDER BY id",
      [since]);
    const agg = new Map();
    for (const r of rows) {
      let g = r.registers;
      if (typeof g === "string") { try { g = JSON.parse(g); } catch { continue; } }
      if (!g || typeof g !== "object") continue;
      const at = new Date(r.created_at);
      if (Number.isNaN(at.getTime())) continue;
      const key = bucket === "hour"
        ? `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:00`
        : `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
      const b = agg.get(key) || { n: 0, energy: 0, power: 0, weld_ms: 0, freq: 0 };
      b.n += 1;
      for (const k of ["energy", "power", "weld_ms", "freq"]) {
        const v = Number(g[k]);
        if (Number.isFinite(v)) b[k] += v;
      }
      agg.set(key, b);
    }
    const out = [...agg.keys()].sort().map((key) => {
      const b = agg.get(key);
      const n = b.n || 1;
      return {
        t: key, n: b.n,
        energy: Math.round((b.energy / n) * 10) / 10,
        power: Math.round((b.power / n) * 10) / 10,
        weld_ms: Math.round((b.weld_ms / n / 100) * 1000) / 1000,
        freq: Math.round((b.freq / n / 1000) * 1000) / 1000,
      };
    });
    return ok(res, { days, bucket, rows: out, total: rows.length });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 网页侧路由（登录态）——注册在 router.use(authenticateJWT) 之后
// ═══════════════════════════════════════════════════════════════════════════

/** 当前操作人名字（源 g.user['emp_name']） */
function whoami(req) {
  const u = req.mesrjUser || {};
  return String(u.emp_name || u.user_name || u.login_name || req.user?.username || "").trim();
}

export function registerUltraConsoleRoutes(router, deps) {
  const { query, ok, fail, perm } = deps;
  const needPass = perm ? perm("prod.pass") : (_req, _res, next) => next();

  // 扫码：校验 + 入队。返回立刻可知的状态。
  router.post("/ultra/scan", needPass, async (req, res) => {
    const d = req.body || {};
    const sn = String(d.sn || "").trim().toUpperCase();
    const emp = String(d.emp || "").trim() || whoami(req);
    if (!sn) return fail(res, "请扫码或输入 SN");
    await sweep(query);

    if (!SN_RE.test(sn)) {
      return ok(res, { verdict: "BAD_FORMAT", ok: false, msg: "SN 格式不对（应为 10 位字母数字）" }, "格式错误");
    }
    const snRows = await qrows(query, 
      "SELECT status, mo_no, product_code FROM prd_sn WHERE upper(sn) = $1", [sn]);
    const snRow = snRows[0];
    if (!snRow) {
      return ok(res, { verdict: "NO_SN", ok: false, msg: "系统里没有这个 SN（未建档）" }, "未建档");
    }
    if (["待修", "报废"].includes(String(snRow.status || ""))) {
      return ok(res, { verdict: "BLOCKED", ok: false, msg: `该板状态=${snRow.status}，不能焊` }, "不良品");
    }
    const ate = await qrows(query, 
      `SELECT pass_time FROM prd_pass
        WHERE upper(sn) = $1 AND station_code = $2 AND result = 'OK'
        ORDER BY id DESC LIMIT 1`, [sn, ATE1]);
    if (!ate.length) {
      return ok(res, { verdict: "NO_ATE1", ok: false, msg: "还没过 ATE1，顺序不对" }, "顺序错误");
    }
    const doneBefore = await qrows(query, 
      `SELECT 1 FROM prd_pass
        WHERE upper(sn) = $1 AND station_code = $2 AND result = 'OK' LIMIT 1`, [sn, STATION]);
    if (doneBefore.length) {
      return ok(res, { verdict: "DONE", ok: false, msg: "这块板已经有超声过站记录" }, "已做过");
    }
    const dup = await qrows(query, 
      `SELECT queue_no FROM prd_ultra_queue
        WHERE upper(sn) = $1 AND status = $2 ORDER BY id DESC LIMIT 1`, [sn, WAIT]);
    if (dup.length) {
      return ok(res, { verdict: "DUP", ok: false, msg: `这块板已经在排队（第 ${dup[0].queue_no} 号）` }, "排队中");
    }

    const r = await enqueue(query, sn, snRow.mo_no || "", snRow.product_code || "", emp);
    const qno = r.queue_no || (await todaySeq(query));
    const ahead = await qrows(query, 
      "SELECT count(*)::int AS n FROM prd_ultra_queue WHERE status = $1 AND queue_no < $2", [WAIT, qno]);
    const n = Number(ahead[0]?.n || 0);
    return ok(res, {
      verdict: "OK", ok: true, queue_no: qno, ahead: n,
      msg: `已排队 #${qno}（前面还有 ${n} 块在等焊）`,
    }, `已排队 #${qno}`);
  });

  // 手工「焊完一次」（没接干接点/485 之前的调试与兜底入口）
  router.post("/ultra/weld-done-manual", needPass, async (req, res) => {
    const d = req.body || {};
    const { popped, empty } = await popHead(query, 1, String(d.machine_no || "MANUAL").trim());
    if (empty) {
      return ok(res, { popped: [], alarm: true, msg: "队列里没有等待的板 —— 有人漏扫码！" }, "队列为空");
    }
    return ok(res, { popped, alarm: false }, `出队：${popped[0]}`);
  });

  // 今日队列明细
  router.get("/ultra/queue", async (_req, res) => {
    await sweep(query);
    const { from, to } = dayBounds(todayStr());
    const rows = await qrows(query, 
      `SELECT queue_no, sn,
              to_char(scanned_at,'YYYY-MM-DD HH24:MI:SS') AS scanned_at,
              status,
              to_char(weld_at,'YYYY-MM-DD HH24:MI:SS') AS weld_at
         FROM prd_ultra_queue
        WHERE created_at >= $1 AND created_at < $2
        ORDER BY queue_no DESC LIMIT 60`, [from, to]);
    const waiting = rows.filter((r) => r.status === WAIT);
    return ok(res, { rows, waiting, waiting_cnt: waiting.length });
  });

  // 撤销排队（等待焊 → 已撤销）
  router.post("/ultra/queue/void", needPass, async (req, res) => {
    const sn = String(req.body?.sn || "").trim().toUpperCase();
    if (!sn) return fail(res, "请提供 SN");
    const rows = await qrows(query, 
      `SELECT id FROM prd_ultra_queue
        WHERE upper(sn) = $1 AND status = $2 ORDER BY id DESC LIMIT 1`, [sn, WAIT]);
    if (!rows.length) return fail(res, "这块板不在等待队列里（可能已焊或已撤销）");
    await qrows(query, "UPDATE prd_ultra_queue SET status = $1 WHERE id = $2", [VOID, rows[0].id]);
    return ok(res, { sn }, `已撤销 ${sn}`);
  });

  router.get("/ultra/stats", async (_req, res) => {
    await sweep(query);
    const { from, to } = dayBounds(todayStr());
    const rows = await qrows(query, 
      `SELECT status, count(*)::int AS n FROM prd_ultra_queue
        WHERE created_at >= $1 AND created_at < $2 GROUP BY status`, [from, to]);
    const m = {};
    for (const r of rows) m[String(r.status || "")] = Number(r.n || 0);
    return ok(res, {
      wait: m[WAIT] || 0, done: m[DONE] || 0,
      timeout: m[TIMEOUT] || 0, void: m[VOID] || 0,
      total: Object.values(m).reduce((s, v) => s + v, 0),
    });
  });

  // 看板：队列明细 + 状态分类 + 按小时产能 + 按工单汇总
  router.get("/ultra/board", async (req, res) => {
    const day = String(req.query.date || "").trim() || todayStr();
    const end = String(req.query.date_end || day).trim();
    return ok(res, await boardPayload(query, day, end));
  });

  router.get("/ultra/limit", async (_req, res) => {
    await ensureLimit(query);
    const rows = await qrows(query, 
      "SELECT * FROM cfg_ultra_limit ORDER BY CASE WHEN model = '*' THEN 0 ELSE 1 END, model");
    return ok(res, {
      rows, default: LIMIT_DEFAULT,
      note: "阈值与设备面板「判断功能」保持一致；单位：时间 0.01s、能量 J、功率 W",
    });
  });

  router.post("/ultra/limit", needPass, async (req, res) => {
    const d = req.body || {};
    const model = String(d.model || "*").trim() || "*";
    const keys = ["time_min", "time_max", "energy_min", "energy_max", "power_min", "power_max"];
    const vals = [];
    for (const k of keys) {
      const v = Number(d[k]);
      if (!Number.isInteger(v)) return fail(res, `参数 ${k} 必须是整数`);
      vals.push(v);
    }
    const [tmin, tmax, emin, emax, pmin, pmax] = vals;
    if (tmin >= tmax || emin >= emax || pmin >= pmax) return fail(res, "下限必须小于上限");
    const enabled = [1, "1", true, "true"].includes(d.enabled === undefined ? 1 : d.enabled) ? 1 : 0;
    await ensureLimit(query);
    await qrows(query, 
      `INSERT INTO cfg_ultra_limit
         (model,time_min,time_max,energy_min,energy_max,power_min,power_max,enabled,note,updated_at,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',now(),$9)
       ON CONFLICT (model) DO UPDATE
          SET time_min = EXCLUDED.time_min, time_max = EXCLUDED.time_max,
              energy_min = EXCLUDED.energy_min, energy_max = EXCLUDED.energy_max,
              power_min = EXCLUDED.power_min, power_max = EXCLUDED.power_max,
              enabled = EXCLUDED.enabled, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [model, tmin, tmax, emin, emax, pmin, pmax, enabled, whoami(req)]);
    clearKeyCache(); // 阈值/参数变更后立刻让下一次请求重建（与缓存 60s 同源）
    return ok(res, { model }, `已保存（${model}）`);
  });
}