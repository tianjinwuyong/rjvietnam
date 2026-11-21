// MES-ruijing 装箱/栈板编码引擎（源 core/packcode.py 逐语义移植）
//
// 规则来源：AT&T QP 200-00029《EPS Serial Number Format》
//
// 外箱码（Case ID，20 位）：
//   CS0 + OEM(1) + 机型码(2) + 工厂(1) + 年份末位(1) + 日期码(2) + "C" + 当日流水(6) + 供应商码(3)
//   例：CS0 N 18 V 3 BK C000001 NBT → CS0N18V3BKC000001NBT
//
// 栈板码（Pallet ID，14 位）：
//   供应商码(3) + OEM(1) + 机型码(2) + 工厂(1) + 年份末位(1) + 日期码(2) + 当日流水(4)
//   例：NBT N 18 V 3 BK 0001 → NBTN18V3BK0001
//
// 日期码：AT&T 附录 A 字母表（22 个字母大写，剔除 I/O/S/Z），全年 366 天，跨年自动归零：
//   AA=1月1日，BK=2月1日（第 32 天），NB=10月1日（第 288 天），平年。
import { query } from "../db.js";

// AT&T 附录 A 字母表：22 个字母（大写），剔除 I、O、S、Z
const DAY_ALPHA = "ABCDEFGHJKLMNPQRTUVWXY";

/** 年内第几天（1~366，闰年自动） */
function dayOfYear(dt) {
  const start = new Date(dt.getFullYear(), 0, 1);
  const cur = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  return Math.round((cur - start) / 86400000) + 1;
}

/** 源 day_code：按 AT&T 附录 A 把日期换成 2 位日期码（如 10-15 → PB） */
export function dayCode(dt = new Date()) {
  const idx = dayOfYear(dt) - 1;
  return DAY_ALPHA[Math.floor(idx / 22)] + DAY_ALPHA[idx % 22];
}

/** 源 day_code_explain：给界面看的说明（日期码 + 第几天） */
export function dayCodeExplain(dt = new Date()) {
  return `${dayCode(dt)}（第 ${dayOfYear(dt)} 天）`;
}

/** 取某机型的装箱编码规则（cfg_pack_rule） */
export async function getRule(productCode) {
  if (!productCode) return null;
  const r = await query(
    "SELECT * FROM cfg_pack_rule WHERE product_code=$1 AND enabled=1", [productCode]);
  return r.rows[0] || null;
}

/** 从工单反查机型编码规则 */
export async function ruleOfMo(moNo) {
  const mo = (await query("SELECT product_code FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
  if (!mo) return [null, null];
  return [await getRule(mo.product_code), mo.product_code];
}

/** 源 gen_carton_no：按规则拼外箱码（不查重） */
export function genCartonNo(rule, dt, seq) {
  return `CS0${rule.oem_code}${rule.model_code}${rule.factory_code}${dt.getFullYear() % 10}` +
    `${dayCode(dt)}C${String(seq).padStart(6, "0")}${rule.supplier_code}`;
}

/** 源 gen_pallet_no：按规则拼栈板码（不查重） */
export function genPalletNo(rule, dt, seq) {
  return `${rule.supplier_code}${rule.oem_code}${rule.model_code}${rule.factory_code}` +
    `${dt.getFullYear() % 10}${dayCode(dt)}${String(seq).padStart(4, "0")}`;
}

function cartonPrefix(rule, dt) {
  return `CS0${rule.oem_code}${rule.model_code}${rule.factory_code}` +
    `${dt.getFullYear() % 10}${dayCode(dt)}C`;
}

function palletPrefix(rule, dt) {
  return `${rule.supplier_code}${rule.oem_code}${rule.model_code}${rule.factory_code}` +
    `${dt.getFullYear() % 10}${dayCode(dt)}`;
}

/**
 * 源 next_carton_no：生成下一个外箱码（当日同机型计数 + 跳过已占用）。
 * table 参数保留：栈板也用同一套前缀时换表即可。
 */
export async function nextCartonNo(rule, dt = new Date(), table = "prd_box") {
  const seg = cartonPrefix(rule, dt);
  let n = Number((await query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE box_no LIKE $1`, [`${seg}%`])).rows[0].n || 0);
  for (let i = 0; i < 10000; i++) {
    n += 1;
    const cand = seg + String(n).padStart(6, "0") + rule.supplier_code;
    const hit = await query(`SELECT id FROM ${table} WHERE box_no=$1`, [cand]);
    if (!hit.rows[0]) return cand;
  }
  throw new Error("当日流水已满（999999），请联系管理员");
}

/** 源 next_pallet_no：生成下一个栈板码 */
export async function nextPalletNo(rule, dt = new Date()) {
  const seg = palletPrefix(rule, dt);
  let n = Number((await query(
    "SELECT COUNT(*)::int AS n FROM prd_pallet WHERE pallet_no LIKE $1", [`${seg}%`])).rows[0].n || 0);
  for (let i = 0; i < 10000; i++) {
    n += 1;
    const cand = seg + String(n).padStart(4, "0");
    const hit = await query("SELECT id FROM prd_pallet WHERE pallet_no=$1", [cand]);
    if (!hit.rows[0]) return cand;
  }
  throw new Error("当日流水已满（999），请联系管理员");
}

/** 源 wip_no：装箱/栈板的内部临时号（封箱时替换为正式编码） */
export async function wipNo(kind = "BOX") {
  const table = kind === "BOX" ? "prd_box" : "prd_pallet";
  const field = kind === "BOX" ? "box_no" : "pallet_no";
  const stamp = new Date();
  const p = n => String(n).padStart(2, "0");
  const ts = `${String(stamp.getFullYear()).slice(2)}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}` +
    `${p(stamp.getHours())}${p(stamp.getMinutes())}${p(stamp.getSeconds())}`;
  for (let i = 0; i < 20; i++) {
    const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    const cand = `${kind.slice(0, 3)}-WIP-${ts}${rand}`;
    const hit = await query(`SELECT id FROM ${table} WHERE ${field}=$1`, [cand]);
    if (!hit.rows[0]) return cand;
  }
  throw new Error("临时号生成失败");
}

/** 源 preview：给界面的「下一个编码」预览（只算不占号） */
export async function preview(productCode, dt = new Date()) {
  if (!productCode) return null;
  const rule = await getRule(productCode);
  if (!rule) return null;
  const segC = cartonPrefix(rule, dt);
  const segP = palletPrefix(rule, dt);
  return {
    rule,
    day_code: dayCode(dt),
    date: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
    next_carton_no: await nextCartonNo(rule, dt),
    next_pallet_no: await nextPalletNo(rule, dt),
    today_cartons: Number((await query(
      "SELECT COUNT(*)::int AS n FROM prd_box WHERE box_no LIKE $1", [`${segC}%`])).rows[0].n || 0),
    today_pallets: Number((await query(
      "SELECT COUNT(*)::int AS n FROM prd_pallet WHERE pallet_no LIKE $1", [`${segP}%`])).rows[0].n || 0),
  };
}

/**
 * 源 make_print_job：写入打印任务队列（外箱/栈板通用）；返回 job_no。
 * 打印桥接程序轮询 /api/pack/jobs 取走执行 BarTender。
 */
export async function makePrintJob(refType, refNo, tpl, payload, createdBy, boxNo = "") {
  const stamp = new Date();
  const p = n => String(n).padStart(2, "0");
  const ts = `${String(stamp.getFullYear()).slice(2)}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}` +
    `${p(stamp.getHours())}${p(stamp.getMinutes())}${p(stamp.getSeconds())}`;
  let jobNo = `PRT${ts}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
  while ((await query("SELECT id FROM prd_print_job WHERE job_no=$1", [jobNo])).rows[0]) {
    jobNo = `PRT${ts}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
  }
  await query(
    `INSERT INTO prd_print_job (job_no, box_no, ref_type, ref_no, tpl_code, payload, status, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'待打印',$7,now())`,
    [jobNo, boxNo || (refType === "box" ? refNo : ""), refType, refNo,
      (tpl || {}).tpl_code || "", JSON.stringify(payload), createdBy || ""]);
  return jobNo;
}

/**
 * PG timestamptz → 本地时间字符串 "YYYY-MM-DD HH:MM:SS"。
 * 源系统时间列是 TEXT（本地时区字符串），PG 是 timestamptz；
 * 界面按字符切片取日期/小时的地方必须先转成本地字符串，否则会差 7 小时。
 */
export function tsLocal(v) {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 19).replace("T", " ");
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
