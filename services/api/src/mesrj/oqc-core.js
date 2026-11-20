/**
 * W14 OQC 出货抽检核心 —— 源 core/oqc.py + core/oqc_check.py + core/aql.py + core/oqc_aql.py + api/oqc.py
 * 关键转换：SQLite -> PG（参数 $1，timestamptz，IFNULL -> COALESCE，substr -> to_char）。
 * 注：本文件因一次 git 误删后由源码重建（2026-11-20）。
 */
import { query } from "../db.js";

// ── 状态常量（与 core/oqc.py 一致）──
export const ST_PENDING = "待检";
export const ST_CHECKING = "检验中";
export const ST_PASS = "合格";
export const ST_FAIL = "不合格";
export const ST_STOCKED = "已入库";
export const PO_PENDING = "待检";
export const PO_PARTIAL = "部分合格";
export const PO_ALL = "全部合格";
export const PO_FAIL = "不合格";
export const DEC_REWORK = "返工";
export const DEC_WAIVER = "特采";
export const DEC_SCRAP = "报废";
export const DEC_PENDING = "待评审";
const DEFAULT_SAMPLE_N = 2;

// ── 逐项检验配置（源 core/oqc_check.py DEFAULTS / CATS）──
export const OQC_CHECK_DEFAULTS = [
  [8, "电气性能", "空载电压 / 满载电压 / OCP / 短路", "DC 102V / 120V / 138V", 384, "ATE 测试机"],
  [13, "耐压测试", "耐电压 / 绝缘阻抗", "3600V(AC)/2s/≤5mA；500V(DC)/2s/>10MΩ", 384, "耐压测试机"],
  [16, "外观", "纸箱 Carton box", "Follow product specification", 6, "目视"],
  [17, "外观", "纸箱标签（VI / 扫描 SN）", "Follow product specification", 6, "目视"],
  [18, "外观", "铭牌标签 Nameplate", "Follow product specification", 6, "目视"],
  [19, "外观", "外壳 VI 检查", "Follow product specification", 384, "目视"],
  [20, "外观", "外壳色差 ΔE", "ΔE ≤ 1.5", 6, "色差仪"],
  [21, "外观", "铭牌色差", "ΔE ≤ 1.5", 6, "色差仪"],
  [22, "外观", "DC 线 / 连接器", "Follow product specification", 384, "目视"],
  [23, "外观", "PE 袋", "Follow product specification", 384, "目视"],
  [24, "可靠性", "跌落试验（跌落后复测 ATE / Hi-pot）", "按客户跌落规范", 6, "跌落机"],
  [25, "外观", "超声线", "超声焊接完整、无裂纹", 6, "目视"],
  [26, "尺寸", "外壳 Casing", "按图纸上下限", 13, "卡尺"],
  [27, "尺寸", "DC 线 DC Wire", "按图纸上下限", 13, "卡尺"],
];
export const OQC_CHECK_CATS = ["电气性能", "耐压测试", "外观", "可靠性", "尺寸", "包装", "其它"];

// ── AQL 标准参数键（源 oqc_aql.STD_KEYS）──
export const STD_KEYS = [
  ["oqc.aql_level", "II", "OQC 默认检验水平（I/II/III）", "OQC"],
  ["oqc.aql_ma", "1.0", "OQC 默认 AQL（严重 MA）", "OQC"],
  ["oqc.aql_mi", "2.5", "OQC 默认 AQL（轻微 MI）", "OQC"],
  ["oqc.aql_severity", "normal", "OQC 默认检验严格度（normal/tightened/reduced）", "OQC"],
  ["oqc.aql_lot_basis", "pallet", "OQC 批量口径（pallet=按栈板 / po=按整批 PO）", "OQC"],
];
const STD_PREVIEW_LOTS = [50, 100, 300, 500, 1200, 1728, 3000, 10000, 33984];

// ── 小工具 ──
function _pad(n) { return String(n).padStart(2, "0"); }
export function _now() {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())} ${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;
}
function rowObj(r) { return r; }
function _split(s) { return String(s || "").split(",").filter(x => x.trim()); }
function _join(l) { return (l || []).join(","); }
function _num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function rowToArr(r) { return Object.values(r); }
function placeholders(n, start = 1) { return Array.from({ length: n }, (_, i) => `$${i + start}`).join(","); }

/** 小时差（保留 1 位）。任一为空返回 null。 */
export function hoursBetween(t0, t1) {
  try {
    const a = new Date(String(t0 || "").slice(0, 19).replace(" ", "T"));
    const b = new Date(String(t1 || "").slice(0, 19).replace(" ", "T"));
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    return Math.round((b - a) / 3600000 * 10) / 10;
  } catch { return null; }
}

async function getOqcParam(key, dflt = "") {
  const r = (await query("SELECT param_val FROM sys_param WHERE param_key=$1", [key])).rows[0];
  return (r && r.param_val != null && r.param_val !== "") ? r.param_val : dflt;
}
async function setOqcParam(key, val, name = "", group = "") {
  const r = await query("SELECT param_key FROM sys_param WHERE param_key=$1", [key]);
  if (r.rows[0]) {
    await query("UPDATE sys_param SET param_val=$1, param_name=COALESCE(NULLIF($2,''),param_name), group_name=COALESCE(NULLIF($3,''),group_name), updated_at=now() WHERE param_key=$4",
      [String(val), name, group, key]);
  } else {
    await query("INSERT INTO sys_param (param_key, param_val, param_name, group_name, updated_at) VALUES($1,$2,$3,$4,now())",
      [key, String(val), name || key, group || ""]);
  }
}

/** 建表 + 补列（幂等）。源 core/oqc.ensure_schema + oqc_aql.ensure 合并。 */
export async function ensureSchema() {
  await query(`CREATE TABLE IF NOT EXISTS qlt_oqc_order (
    id bigserial PRIMARY KEY, oqc_no varchar UNIQUE NOT NULL, pallet_no varchar NOT NULL,
    po_no varchar, mo_no varchar, product_code varchar, cust_code varchar,
    pallet_qty integer DEFAULT 0, box_total integer DEFAULT 0, sample_n integer DEFAULT 2,
    sample_boxes text, ok_boxes text, ng_boxes text, result varchar DEFAULT '待检',
    status varchar DEFAULT '待检', round_no integer DEFAULT 1, inspector varchar,
    inspect_time varchar, remark text, created_by varchar, created_at varchar, updated_at varchar,
    lot_qty integer DEFAULT 0, aql_level varchar DEFAULT 'II', aql_severity varchar DEFAULT 'normal',
    aql_ma real DEFAULT 1.0, aql_mi real DEFAULT 2.5, code_letter varchar DEFAULT '',
    sample_n_aql integer DEFAULT 0, ac_ma integer DEFAULT 0, re_ma integer DEFAULT 1,
    ac_mi integer DEFAULT 0, re_mi integer DEFAULT 1, defect_cr integer DEFAULT 0,
    defect_ma integer DEFAULT 0, defect_mi integer DEFAULT 0, aql_result text DEFAULT '',
    aql_note text DEFAULT '', review_decision varchar DEFAULT '', review_by varchar DEFAULT '',
    review_time varchar DEFAULT '', review_reason text DEFAULT '', rework_start_time varchar DEFAULT '',
    rework_start_by varchar DEFAULT '', notify_state varchar DEFAULT '')`);
  await query(`CREATE TABLE IF NOT EXISTS qlt_oqc_item (
    id bigserial PRIMARY KEY, oqc_no varchar NOT NULL, box_no varchar NOT NULL,
    box_qty integer DEFAULT 0, sample_qty integer DEFAULT 0, result varchar DEFAULT '待检',
    defect_code varchar, defect_desc text, inspector varchar, checked_at varchar, remark text)`);
  await query(`CREATE TABLE IF NOT EXISTS qlt_oqc_rework (
    id bigserial PRIMARY KEY, oqc_no varchar, pallet_no varchar, box_no varchar,
    ng_qty integer DEFAULT 0, reason text, action varchar, operator varchar,
    result varchar DEFAULT '进行中', created_at varchar, completed_at varchar, remark text)`);
  await query(`CREATE TABLE IF NOT EXISTS qlt_oqc_review (
    id bigserial PRIMARY KEY, oqc_no varchar NOT NULL, po_no varchar DEFAULT '', pallet_no varchar DEFAULT '',
    decision varchar DEFAULT '', reason text DEFAULT '', defect_json text DEFAULT '', by_user varchar DEFAULT '',
    at_time varchar DEFAULT '', remark text DEFAULT '')`);
  await query(`CREATE TABLE IF NOT EXISTS qlt_oqc_rework_scan (
    id bigserial PRIMARY KEY, oqc_no varchar NOT NULL, pallet_no varchar DEFAULT '', sn varchar DEFAULT '',
    belong integer DEFAULT 0, result varchar DEFAULT '', reason text DEFAULT '', operator varchar DEFAULT '',
    at_time varchar DEFAULT '')`);
  await query(`CREATE INDEX IF NOT EXISTS ix_oqc_order_pallet ON qlt_oqc_order(pallet_no)`);
  await query(`CREATE INDEX IF NOT EXISTS ix_oqc_order_po ON qlt_oqc_order(po_no)`);
  await query(`CREATE INDEX IF NOT EXISTS ix_oqc_item_no ON qlt_oqc_item(oqc_no)`);
  await query(`CREATE INDEX IF NOT EXISTS ix_oqc_review_no ON qlt_oqc_review(oqc_no)`);
  await query(`CREATE INDEX IF NOT EXISTS ix_oqc_scan_no ON qlt_oqc_rework_scan(oqc_no)`);
  // qlt_oqc_order 可能被更早版本建表（缺 AQL/评审列）→ 幂等补列
  for (const [name, ddl] of [
    ["lot_qty", "integer DEFAULT 0"], ["aql_level", "varchar DEFAULT 'II'"], ["aql_severity", "varchar DEFAULT 'normal'"],
    ["aql_ma", "real DEFAULT 1.0"], ["aql_mi", "real DEFAULT 2.5"], ["code_letter", "varchar DEFAULT ''"],
    ["sample_n_aql", "integer DEFAULT 0"], ["ac_ma", "integer DEFAULT 0"], ["re_ma", "integer DEFAULT 1"],
    ["ac_mi", "integer DEFAULT 0"], ["re_mi", "integer DEFAULT 1"], ["defect_cr", "integer DEFAULT 0"],
    ["defect_ma", "integer DEFAULT 0"], ["defect_mi", "integer DEFAULT 0"], ["aql_result", "text DEFAULT ''"],
    ["aql_note", "text DEFAULT ''"], ["review_decision", "varchar DEFAULT ''"], ["review_by", "varchar DEFAULT ''"],
    ["review_time", "varchar DEFAULT ''"], ["review_reason", "text DEFAULT ''"], ["rework_start_time", "varchar DEFAULT ''"],
    ["rework_start_by", "varchar DEFAULT ''"], ["notify_state", "varchar DEFAULT ''"],
  ]) { try { await query(`ALTER TABLE qlt_oqc_order ADD COLUMN IF NOT EXISTS ${name} ${ddl}`); } catch { /* race */ } }
  // 被 OQC 接管的字段（首次运行补列）
  for (const [t, cols] of [
    ["prd_pallet", [["oqc_status", "varchar DEFAULT '待检'"], ["oqc_time", "varchar"], ["release_locked", "integer DEFAULT 1"], ["stock_in_status", "varchar DEFAULT '未入库'"], ["stock_in_time", "varchar"], ["oqc_waiver", "integer DEFAULT 0"]]],
    ["ord_po", [["oqc_status", "varchar DEFAULT '待检'"], ["release_locked", "integer DEFAULT 1"]]],
  ]) {
    const have = new Set((await query(
      "SELECT column_name FROM information_schema.columns WHERE table_name=$1", [t])).rows.map(r => r.column_name));
    for (const [name, ddl] of cols) {
      if (!have.has(name)) { try { await query(`ALTER TABLE ${t} ADD COLUMN ${name} ${ddl}`); } catch { /* race */ } }
    }
  }
  for (const [k, v, name, grp] of STD_KEYS) {
    await query(`INSERT INTO sys_param (param_key, param_val, param_name, group_name) VALUES($1,$2,$3,$4) ON CONFLICT (param_key) DO NOTHING`, [k, v, name, grp]);
  }
}

/** 逐项检验建表（源 oqc_check.ensure_schema）。 */
export async function ensureCheckSchema() {
  await query(`CREATE TABLE IF NOT EXISTS cfg_oqc_item (
    id bigserial PRIMARY KEY, model varchar DEFAULT '', seq integer NOT NULL, cat varchar,
    item_name text, spec text, insp_default integer DEFAULT 0, equip varchar, enabled integer DEFAULT 1,
    remark text, updated_at varchar)`);
  await query(`CREATE TABLE IF NOT EXISTS qlt_oqc_check (
    id bigserial PRIMARY KEY, po_no varchar NOT NULL, model varchar, seq integer NOT NULL, cat varchar,
    item_name text, spec text, insp_qty integer DEFAULT 0, ng_qty integer DEFAULT 0, equip varchar,
    remark text, inspector varchar, check_time varchar, created_at varchar, updated_at varchar)`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_oqc_item_m_s ON cfg_oqc_item(model, seq)`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_oqc_check_po_s ON qlt_oqc_check(po_no, seq)`);
  await query(`CREATE INDEX IF NOT EXISTS ix_oqc_check_po ON qlt_oqc_check(po_no)`);
  const cnt = Number((await query("SELECT COUNT(*)::int AS n FROM cfg_oqc_item")).rows[0]?.n || 0);
  if (!cnt) {
    for (const [seq, cat, name, spec, n, eq] of OQC_CHECK_DEFAULTS) {
      await query(`INSERT INTO cfg_oqc_item (model, seq, cat, item_name, spec, insp_default, equip, enabled, updated_at) VALUES('', $1,$2,$3,$4,$5,$6,1,$7) ON CONFLICT DO NOTHING`,
        [seq, cat, name, spec, n, eq, _now()]);
    }
  }
}

function sampleNOf(palletNo = null) {
  const v = parseInt(String(_sampleBoxesCache ?? ""), 10);
  return (Number.isFinite(v) && v > 0) ? v : DEFAULT_SAMPLE_N;
}
let _sampleBoxesCache = null;
async function loadSampleBoxes() { _sampleBoxesCache = await getOqcParam("oqc.sample_boxes", ""); }

async function oqcNo() {
  const day = _now().slice(0, 10).replace(/-/g, "");
  const seg = "OQC" + day;
  const n = Number((await query("SELECT COUNT(*)::int AS n FROM qlt_oqc_order WHERE oqc_no LIKE $1", [seg + "%"])).rows[0]?.n || 0);
  for (let i = n + 1; i < n + 99; i++) {
    const cand = `${seg}${String(i).padStart(3, "0")}`;
    if (!(await query("SELECT id FROM qlt_oqc_order WHERE oqc_no=$1", [cand])).rows[0]) return cand;
  }
  return `${seg}${String(n + 1).padStart(3, "0")}`;
}
async function boxesOfPallet(palletNo) {
  return (await query("SELECT box_no, qty FROM prd_box WHERE pallet_no=$1 ORDER BY box_no", [palletNo])).rows;
}
export async function oqcAudit(userName, module, action, target, detail = "", ip = "") {
  await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, ip) VALUES($1,$2,$3,$4,$5,$6)",
    [userName || "", module || "", action || "", target || "", String(detail || ""), ip || ""]);
}
async function orderJson(o) {
  if (!o) return null;
  const items = (await query("SELECT * FROM qlt_oqc_item WHERE oqc_no=$1 ORDER BY box_no", [o.oqc_no])).rows;
  const d = { ...o };
  d.items = items;
  d.sample_list = _split(o.sample_boxes);
  d.checked = items.filter(i => String(i.result || "") !== ST_PENDING).length;
  d.pending = items.length - d.checked;
  return d;
}

// ═════════════════════════ 核心流程（源 core/oqc.py）═════════════════════════

/** 开抽检单：随机抽 N 箱并登记。返回 [orderJson, err]。 */
export async function openOrder(palletNo, user = "", forceNew = false) {
  await ensureSchema();
  const p = (await query("SELECT * FROM prd_pallet WHERE pallet_no=$1", [palletNo])).rows[0];
  if (!p) return [null, `栈板不存在：${palletNo}`];
  if (String(p.status || "") !== "已封板") return [null, `栈板【${palletNo}】还没封板（当前 ${p.status}），不能做 OQC`];
  const live = (await query(
    "SELECT * FROM qlt_oqc_order WHERE pallet_no=$1 AND status IN ($2,$3) ORDER BY id DESC LIMIT 1",
    [palletNo, ST_PENDING, ST_CHECKING])).rows[0];
  if (live && !forceNew) return [await orderJson(live), null];
  const boxes = await boxesOfPallet(palletNo);
  if (!boxes.length) return [null, `栈板【${palletNo}】下没有箱，检查箱是否已绑到该栈板`];
  await loadSampleBoxes();
  const n = Math.min(sampleNOf(palletNo), boxes.length);
  const allBoxNos = boxes.map(b => b.box_no);
  for (let i = allBoxNos.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [allBoxNos[i], allBoxNos[j]] = [allBoxNos[j], allBoxNos[i]]; }
  const picked = allBoxNos.slice(0, n).sort();
  const maxRound = Number((await query("SELECT COALESCE(MAX(round_no),0) AS r FROM qlt_oqc_order WHERE pallet_no=$1", [palletNo])).rows[0]?.r || 0);
  const roundNo = maxRound + 1;
  const no = await oqcNo();
  const ts = _now();
  await query(
    `INSERT INTO qlt_oqc_order (oqc_no,pallet_no,po_no,mo_no,product_code,cust_code,pallet_qty,box_total,sample_n,sample_boxes,result,status,round_no,created_by,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [no, palletNo, p.po_no || "", p.mo_no || "", p.product_code || "", p.cust_code || "",
     _num(p.total_qty), boxes.length, n, _join(picked), ST_PENDING, ST_PENDING, roundNo, user, ts, ts]);
  const qtyMap = {}; for (const b of boxes) qtyMap[b.box_no] = _num(b.qty);
  for (const bno of picked) {
    await query("INSERT INTO qlt_oqc_item (oqc_no, box_no, box_qty, sample_qty, result) VALUES($1,$2,$3,$4,$5)",
      [no, bno, qtyMap[bno] || 0, 0, ST_PENDING]);
  }
  await query("UPDATE prd_pallet SET oqc_status=$1, release_locked=1, updated_at=now() WHERE pallet_no=$2", [ST_CHECKING, palletNo]);
  await oqcAudit(user || "system", "OQC", "开抽检单", no, `栈板 ${palletNo} 抽 ${n}/${boxes.length} 箱：${_join(picked)}`, "");
  return [await orderJson((await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [no])).rows[0]), null];
}

/** 录一箱结果，全部有结论后自动判定。返回 [orderJson, err]。 */
export async function checkBox(oqcNo_, boxNo, result, defectCode = "", defectDesc = "", sampleQty = 0, inspector = "", remark = "") {
  await ensureSchema();
  const o = (await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0];
  if (!o) return [null, `抽检单不存在：${oqcNo_}`];
  if (![ST_PENDING, ST_CHECKING].includes(o.status)) return [null, `抽检单【${oqcNo_}】已判定（${o.result}），不能改结果`];
  if (!_split(o.sample_boxes).includes(boxNo)) return [null, `箱【${boxNo}】不是本次抽检箱（本次抽：${o.sample_boxes}）`];
  const r = ["OK", "PASS", "合格", "1"].includes(String(result).trim().toUpperCase()) ? "OK" : "NG";
  await query(
    "UPDATE qlt_oqc_item SET result=$1, defect_code=$2, defect_desc=$3, sample_qty=$4, inspector=$5, checked_at=$6, remark=$7 WHERE oqc_no=$8 AND box_no=$9",
    [r, defectCode || "", defectDesc || "", _num(sampleQty), inspector || "", _now(), remark || "", oqcNo_, boxNo]);
  await query("UPDATE qlt_oqc_order SET status=$1, updated_at=$2 WHERE oqc_no=$3", [ST_CHECKING, _now(), oqcNo_]);
  return judge(oqcNo_, inspector);
}

/** 结算：抽检箱全有结论才判，任一 NG 整板 NG。返回 [orderJson, err]。 */
export async function judge(oqcNo_, inspector = "") {
  await ensureSchema();
  const o = (await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0];
  if (!o) return [null, `抽检单不存在：${oqcNo_}`];
  const items = (await query("SELECT * FROM qlt_oqc_item WHERE oqc_no=$1 ORDER BY box_no", [oqcNo_])).rows;
  const todo = items.filter(i => String(i.result || ST_PENDING) === ST_PENDING);
  if (todo.length) return [await orderJson(o), null];   // 还没检完
  const ok = items.filter(i => i.result === "OK").map(i => i.box_no);
  const ng = items.filter(i => i.result === "NG").map(i => i.box_no);
  const passed = !ng.length;
  const result = passed ? ST_PASS : ST_FAIL;
  const ts = _now();
  await query(
    `UPDATE qlt_oqc_order SET result=$1, status=$2, ok_boxes=$3, ng_boxes=$4, inspector=$5, inspect_time=$6, updated_at=$7 WHERE oqc_no=$8`,
    [result, result, _join(ok), _join(ng), inspector || o.inspector || "", ts, ts, oqcNo_]);
  if (passed) {
    await query("UPDATE prd_pallet SET oqc_status=$1, oqc_time=$2, release_locked=0, updated_at=now() WHERE pallet_no=$3", [ST_PASS, ts, o.pallet_no]);
  } else {
    await query("UPDATE prd_pallet SET oqc_status=$1, oqc_time=$2, release_locked=1, updated_at=now() WHERE pallet_no=$3", [ST_FAIL, ts, o.pallet_no]);
    for (const i of items) {
      if (i.result === "NG") {
        await query(
          `INSERT INTO qlt_oqc_rework (oqc_no,pallet_no,box_no,ng_qty,reason,action,operator,result,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,'进行中',$8)`,
          [oqcNo_, o.pallet_no, i.box_no, _num(i.box_qty), i.defect_desc || i.defect_code || "OQC 抽检不合格", "整箱返工复检", inspector || "", ts]);
      }
    }
  }
  if (o.po_no) await refreshPo(o.po_no);
  await oqcAudit(inspector || "system", "OQC", "判定", oqcNo_, `${result}：合格 ${ok.length} 箱 / NG ${ng.length} 箱`, "");
  return [await orderJson((await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0]), null];
}

/** 返工完成 → 栈板回待检。返回 [result, err]。 */
export async function reworkDone(oqcNo_, operator = "", remark = "") {
  await ensureSchema();
  const o = (await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0];
  if (!o) return [null, `抽检单不存在：${oqcNo_}`];
  if (o.result !== ST_FAIL) return [null, `抽检单【${oqcNo_}】不是不合格状态，无需返工`];
  const ts = _now();
  await query("UPDATE qlt_oqc_rework SET result='已完成', operator=$1, completed_at=$2, remark=$3 WHERE oqc_no=$4 AND result='进行中'",
    [operator || "", ts, remark || "", oqcNo_]);
  await query("UPDATE qlt_oqc_order SET status='已返工', updated_at=$1 WHERE oqc_no=$2", [ts, oqcNo_]);
  await query("UPDATE prd_pallet SET oqc_status=$1, release_locked=1, updated_at=now() WHERE pallet_no=$2", [ST_PENDING, o.pallet_no]);
  if (o.po_no) await refreshPo(o.po_no);
  await oqcAudit(operator || "system", "OQC", "返工完成", oqcNo_, `栈板 ${o.pallet_no} 回到待检`, "");
  return [{ oqc_no: oqcNo_, pallet_no: o.pallet_no, next: "重新抽检" }, null];
}

/** 按栈板结果刷新 PO 放行状态。空集复位（源 refresh_po 的修）。返回 obj。 */
export async function refreshPo(poNo) {
  await ensureSchema();
  if (!poNo) return null;
  const rows = (await query("SELECT pallet_no, oqc_status, release_locked FROM prd_pallet WHERE po_no=$1 AND status='已封板'", [poNo])).rows;
  if (!rows.length) {
    await query("UPDATE ord_po SET oqc_status=$1, release_locked=1 WHERE po_no=$2", [PO_PENDING, poNo]);
    return { po_no: poNo, pallets: 0, passed: 0, failed: 0, oqc_status: PO_PENDING, release_locked: 1, reset: true };
  }
  const total = rows.length;
  const passed = rows.filter(r => String(r.oqc_status || "") === ST_PASS).length;
  const failed = rows.filter(r => String(r.oqc_status || "") === ST_FAIL).length;
  let st, lock;
  if (passed === total) { st = PO_ALL; lock = 0; }
  else if (failed) { st = PO_FAIL; lock = 1; }
  else if (passed) { st = PO_PARTIAL; lock = 1; }
  else { st = PO_PENDING; lock = 1; }
  await query("UPDATE ord_po SET oqc_status=$1, release_locked=$2 WHERE po_no=$3", [st, lock, poNo]);
  return { po_no: poNo, pallets: total, passed, failed, oqc_status: st, release_locked: lock };
}

/** 入库前置条件。返回 [bool, reason]。 */
export async function canStockIn(palletNo) {
  await ensureSchema();
  const p = (await query(
    "SELECT pallet_no, status, oqc_status, release_locked, stock_in_status, stock_in_time FROM prd_pallet WHERE pallet_no=$1", [palletNo])).rows[0];
  if (!p) return [false, `栈板不存在：${palletNo}`];
  if (String(p.status || "") !== "已封板") return [false, `栈板还没封板（${p.status}）`];
  if (String(p.stock_in_status || "") === ST_STOCKED) return [false, `栈板【${palletNo}】已经入库（${p.stock_in_time || ""}）`];
  if (String(p.oqc_status || ST_PENDING) !== ST_PASS) return [false, `栈板【${palletNo}】OQC 未通过（当前 ${p.oqc_status || ST_PENDING}），不能入库`];
  if (_num(p.release_locked) !== 0) return [false, `栈板【${palletNo}】仍处于锁定状态，不能入库`];
  return [true, ""];
}

/** 成品入库（唯一合法入口，必过 canStockIn）。返回 [result, err]。 */
export async function stockIn(palletNo, operator = "") {
  const [can, why] = await canStockIn(palletNo);
  if (!can) return [null, why];
  const ts = _now();
  await query("UPDATE prd_pallet SET stock_in_status=$1, stock_in_time=$2, updated_at=now() WHERE pallet_no=$3", [ST_STOCKED, ts, palletNo]);
  const p = (await query("SELECT po_no FROM prd_pallet WHERE pallet_no=$1", [palletNo])).rows[0];
  if (p && p.po_no) await refreshPo(p.po_no);
  await oqcAudit(operator || "system", "OQC", "成品入库", palletNo, "OQC 合格放行", "");
  return [{ pallet_no: palletNo, stock_in_time: ts }, null];
}

// ═════════════════════════ PO 级（源 po_gap/can_ship/po_summary）═════════════════════════

/** PO 欠数账（made/ready/wip/gap；按 ready 算对外欠数）。返回 obj。 */
export async function poGap(poNo, withPallets = false) {
  await ensureSchema();
  const po = (await query("SELECT * FROM ord_po WHERE po_no=$1 ORDER BY id LIMIT 1", [poNo])).rows[0];
  const orderQty = _num(po ? po.order_qty : 0);
  const rows = (await query(
    `SELECT pallet_no, mo_no, box_count, total_qty, oqc_status, release_locked, stock_in_status, line_code
     FROM prd_pallet WHERE po_no=$1 AND status='已封板' ORDER BY pallet_no`, [poNo])).rows;
  const made = rows.reduce((s, r) => s + _num(r.total_qty), 0);
  const passedRows = rows.filter(r => String(r.oqc_status || "") === ST_PASS);
  const ready = passedRows.reduce((s, r) => s + _num(r.total_qty), 0);
  const pending = rows.filter(r => [ST_PENDING, ST_CHECKING].includes(String(r.oqc_status || ST_PENDING))).reduce((s, r) => s + _num(r.total_qty), 0);
  const failed = rows.filter(r => String(r.oqc_status || "") === ST_FAIL).reduce((s, r) => s + _num(r.total_qty), 0);
  const stocked = rows.filter(r => String(r.stock_in_status || "") === ST_STOCKED).reduce((s, r) => s + _num(r.total_qty), 0);
  const wipPallet = _num((await query("SELECT COALESCE(SUM(total_qty),0) AS s FROM prd_pallet WHERE po_no=$1 AND status<>'已封板'", [poNo])).rows[0]?.s);
  const wipBox = _num((await query("SELECT COALESCE(SUM(qty),0) AS s FROM prd_box WHERE po_no=$1 AND status='已封箱' AND COALESCE(pallet_no,'')=''", [poNo])).rows[0]?.s);
  const wip = wipPallet + wipBox;
  const mos = (await query(
    `SELECT m.mo_no, m.plan_qty, m.status, m.line_code,
       COALESCE((SELECT SUM(p.total_qty) FROM prd_pallet p WHERE p.mo_no=m.mo_no AND p.po_no=$1 AND p.status='已封板'),0) AS made,
       COALESCE((SELECT SUM(p.total_qty) FROM prd_pallet p WHERE p.mo_no=m.mo_no AND p.po_no=$1 AND p.status='已封板' AND COALESCE(p.oqc_status,'')=$2),0) AS ready
     FROM ord_mo m WHERE m.po_no=$1 AND COALESCE(m.status,'')<>'作废' ORDER BY m.mo_no`, [poNo, ST_PASS])).rows;
  const moRows = mos.map(m => ({
    mo_no: m.mo_no, plan_qty: _num(m.plan_qty), status: m.status || "", line_code: m.line_code || "",
    made: _num(m.made), ready: _num(m.ready), gap: Math.max(_num(m.plan_qty) - _num(m.made), 0),
  }));
  const gap = Math.max(orderQty - ready, 0);
  const gapAfterWip = Math.max(orderQty - ready - wip, 0);
  return {
    po_no: poNo, po_exists: Boolean(po),
    product_code: (po?.product_code || ""), cust_code: (po?.cust_code || ""),
    delivery_date: (po?.delivery_date || ""), po_status: (po?.status || ""),
    order_qty: orderQty, made, ready, pending, failed, stocked, shipped: 0, ship_source: "none",
    wip_on_pallet: wipPallet, wip_boxed: wipBox, wip, gap, gap_after_wip: gapAfterWip,
    gap_pct: orderQty ? Math.round(gap * 100.0 / orderQty * 10) / 10 : null,
    complete: orderQty > 0 && gap === 0, pallets: rows.length, passed_pallets: passedRows.length,
    mos: moRows, rows: withPallets ? rows : [],
  };
}

/** 所有 PO 欠数一览（按交期，空排后）。返回数组。 */
export async function poGapList(limit = 200) {
  await ensureSchema();
  const rows = (await query(
    `SELECT po_no FROM ord_po ORDER BY (COALESCE(delivery_date,'')=''), delivery_date, po_no LIMIT $1`,
    [Math.min(Math.max(_num(limit, 200), 1), 2000)])).rows;
  const out = [];
  for (const r of rows) {
    const g = await poGap(r.po_no);
    out.push({ po_no: g.po_no, product_code: g.product_code, cust_code: g.cust_code, delivery_date: g.delivery_date,
      po_status: g.po_status, order_qty: g.order_qty, made: g.made, ready: g.ready, wip: g.wip,
      gap: g.gap, gap_after_wip: g.gap_after_wip, gap_pct: g.gap_pct, complete: g.complete, mos: g.mos.length });
  }
  return out;
}

/** PO 出货前置：所有已封栈板都 OQC 合格。返回 [bool, reason]。 */
export async function canShip(poNo) {
  await ensureSchema();
  const po = (await query("SELECT po_no FROM ord_po WHERE po_no=$1", [poNo])).rows[0];
  const rows = (await query("SELECT pallet_no, oqc_status FROM prd_pallet WHERE po_no=$1 AND status='已封板'", [poNo])).rows;
  if (!rows.length) {
    return [false, po ? `PO【${poNo}】下还没有已封板的栈板` : `PO【${poNo}】未建档，且没有已封板的栈板`];
  }
  const bad = rows.filter(r => String(r.oqc_status || "") !== ST_PASS).map(r => r.pallet_no);
  if (bad.length) {
    const tail = po ? "" : "（该 PO 未在「订单管理」建档，出货判定按栈板执行）";
    return [false, `PO【${poNo}】还有 ${bad.length} 个栈板未通过 OQC：${bad.slice(0, 5).join("、")}${bad.length > 5 ? "…" : ""}${tail}`];
  }
  return [true, ""];
}

/** PO 级看板数据。返回 obj。 */
export async function poSummary(poNo) {
  await ensureSchema();
  const po = (await query("SELECT * FROM ord_po WHERE po_no=$1 ORDER BY id LIMIT 1", [poNo])).rows[0];
  const rows = (await query(
    `SELECT pallet_no, box_count, total_qty, oqc_status, release_locked, stock_in_status, oqc_time
     FROM prd_pallet WHERE po_no=$1 AND status='已封板' ORDER BY pallet_no`, [poNo])).rows;
  const total = rows.length;
  const passed = rows.filter(r => String(r.oqc_status || "") === ST_PASS).length;
  const failed = rows.filter(r => String(r.oqc_status || "") === ST_FAIL).length;
  const stocked = rows.filter(r => String(r.stock_in_status || "") === ST_STOCKED).length;
  const qty = rows.reduce((s, r) => s + _num(r.total_qty), 0);
  return {
    po_no: poNo, cust_code: (po?.cust_code || ""), order_qty: _num(po ? po.order_qty : 0),
    pallets: total, passed, failed, stocked, qty, can_ship: (total > 0 && passed === total),
    oqc_status: (po?.oqc_status || PO_PENDING), rows,
  };
}

// ═════════════════════════ 待检池 / 看板（源 pending_queue/board/...）═════════════════════════

/** 待检栈板队列。status 传入则按 oqc_status 过滤，否则取待检+检验中。返回数组。 */
export async function pendingQueue(status = "") {
  await ensureSchema();
  const w = ["p.status='已封板'"];
  const args = [];
  if (status) { args.push(status); w.push(`COALESCE(p.oqc_status,'待检') = $${args.length}`); }
  else { args.push(ST_PENDING, ST_CHECKING); w.push(`COALESCE(p.oqc_status,'待检') IN ($${args.length-1},$${args.length})`); }
  args.push(30);
  const rows = (await query(
    `SELECT p.pallet_no, p.po_no, p.product_code, p.box_count, p.total_qty,
       COALESCE(p.oqc_status,'待检') AS oqc_status, p.created_at, p.updated_at, p.stock_in_status
     FROM prd_pallet p WHERE ${w.join(" AND ")}
     ORDER BY COALESCE(p.updated_at, p.created_at) ASC LIMIT $${args.length}`, args)).rows;
  const now = _now();
  return rows.map(r => ({ ...r, wait_hours: hoursBetween(r.updated_at || r.created_at, now) }));
}

/** 不合格 / 返工中栈板。返回数组。 */
export async function ngInProgress(limit = 30) {
  await ensureSchema();
  const rows = (await query(
    `SELECT o.oqc_no, o.pallet_no, o.po_no, o.product_code, o.result, o.status, o.round_no,
       o.ng_boxes, o.sample_n, o.inspector, o.inspect_time, o.created_at
     FROM qlt_oqc_order o WHERE o.status IN ('返工中','待返工') OR o.result=$1 ORDER BY o.id DESC LIMIT $2`,
    [ST_FAIL, Math.min(Math.max(_num(limit, 30), 1), 200)])).rows;
  return rows;
}

/** 近 N 天抽检/不合格趋势。返回数组。 */
export async function trend(days = 14) {
  await ensureSchema();
  let d = Math.max(1, Math.min(90, _num(days, 14)));
  const rows = (await query(
    `SELECT to_char(created_at::timestamptz,'YYYY-MM-DD') AS d, COUNT(*)::int AS pallets,
       SUM(CASE WHEN result=$1 THEN 1 ELSE 0 END)::int AS ng
     FROM qlt_oqc_order GROUP BY d ORDER BY d DESC LIMIT $2`, [ST_FAIL, d])).rows;
  const out = rows.reverse();
  for (const r of out) {
    const n = _num(r.pallets);
    r.rate = n ? Math.round(_num(r.ng) * 100.0 / n * 10) / 10 : null;
  }
  return out;
}

/** 有栈板的 PO 逐个给出能否出货。返回数组。 */
export async function poReadyList(limit = 10) {
  await ensureSchema();
  const rows = (await query(
    `SELECT po_no, COUNT(*)::int AS pallets,
       SUM(CASE WHEN COALESCE(oqc_status,'')=$1 THEN 1 ELSE 0 END)::int AS pass_n,
       SUM(CASE WHEN COALESCE(oqc_status,'')=$2 THEN 1 ELSE 0 END)::int AS ng_n,
       SUM(CASE WHEN COALESCE(oqc_status,'待检') IN ($3,$4) THEN 1 ELSE 0 END)::int AS pending_n,
       SUM(COALESCE(total_qty,0))::int AS qty
     FROM prd_pallet WHERE COALESCE(po_no,'')<>'' GROUP BY po_no ORDER BY pallets DESC LIMIT $5`,
    [ST_PASS, ST_FAIL, ST_PENDING, ST_CHECKING, Math.min(Math.max(_num(limit, 10), 1), 200)])).rows;
  const out = [];
  for (const r of rows) {
    const [ok, why] = await canShip(r.po_no);
    out.push({ ...r, can_ship: ok, reason: ok ? "" : (why || "") });
  }
  return out;
}

/** 按 OQC 工位统计直通率。返回数组。 */
export async function stationStats(dateFrom, dateTo) {
  await ensureSchema();
  let defs = [];
  try {
    defs = (await query(
      `SELECT station_code, station_name, seq_no, line_code FROM md_station
       WHERE (station_code LIKE '%OQC%' OR COALESCE(is_sampling,0)=1) AND COALESCE(status,1)=1
       ORDER BY COALESCE(seq_no,999), station_code`)).rows;
  } catch { return []; }
  if (!defs.length) return [];
  const codes = defs.map(d => d.station_code);
  const passRows = (await query(
    `SELECT station_code, COUNT(*)::int AS n,
       SUM(CASE WHEN result='OK' THEN 1 ELSE 0 END)::int AS ok_n,
       SUM(CASE WHEN result='NG' THEN 1 ELSE 0 END)::int AS ng_n
     FROM prd_pass WHERE station_code = ANY($1) AND pass_time >= $2 AND pass_time < $3 GROUP BY station_code`,
    [codes, dateFrom, dateTo])).rows;
  const pm = {}; for (const r of passRows) pm[r.station_code] = r;
  let top = {};
  try {
    const ngRows = (await query(
      `SELECT station_code, defect_code, COUNT(*)::int AS n FROM prd_defect_rec
       WHERE station_code = ANY($1) AND defect_time >= $2 AND defect_time < $3
       GROUP BY station_code, defect_code ORDER BY n DESC`, [codes, dateFrom, dateTo])).rows;
    for (const r of ngRows) if (!(r.station_code in top)) top[r.station_code] = [r.defect_code || "", _num(r.n)];
  } catch { /* table may vary */ }
  return defs.map(d => {
    const p = pm[d.station_code] || {};
    const total = _num(p.n), okn = _num(p.ok_n), ngn = _num(p.ng_n);
    const [tc, tn] = top[d.station_code] || ["", 0];
    return { code: d.station_code, name: d.station_name || d.station_code, seq: d.seq_no || 0,
      line: d.line_code || "", total, ok: okn, ng: ngn, fpy: total ? Math.round(okn * 100.0 / total * 10) / 10 : null,
      top_defect: tc, top_defect_n: tn };
  });
}

/** 看板总取数。返回 {range,kpi,stations,queue,ng_list,trend,pos,has_data}。 */
export async function board(days = 14) {
  await ensureSchema();
  let d = Math.max(1, Math.min(90, _num(days, 14)));
  const today = _now().slice(0, 10);
  const d0 = today + " 00:00:00", d1 = today + " 23:59:59";
  const g = async (sql, args = []) => _num((await query(sql, args)).rows[0]?.n || 0);
  const ordersToday = await g("SELECT COUNT(*)::int AS n FROM qlt_oqc_order WHERE created_at>=$1 AND created_at<$2", [d0, d1]);
  const passToday = await g("SELECT COUNT(*)::int AS n FROM qlt_oqc_order WHERE created_at>=$1 AND created_at<$2 AND result=$3", [d0, d1, ST_PASS]);
  const failToday = await g("SELECT COUNT(*)::int AS n FROM qlt_oqc_order WHERE created_at>=$1 AND created_at<$2 AND result=$3", [d0, d1, ST_FAIL]);
  const judgedToday = passToday + failToday;
  const pendingPallets = await g("SELECT COUNT(*)::int AS n FROM prd_pallet WHERE status='已封板' AND COALESCE(oqc_status,'待检') IN ($1,$2)", [ST_PENDING, ST_CHECKING]);
  const reworkN = await g("SELECT COUNT(*)::int AS n FROM qlt_oqc_order WHERE status IN ('返工中','待返工')");
  const pos = await poReadyList(50);
  const poReady = pos.filter(x => x.can_ship).length;
  const stationRows = await stationStats(d0, d1);
  const queue = await pendingQueue();
  const ngList = await ngInProgress();
  const tr = await trend(d);
  const totalOrders = await g("SELECT COUNT(*)::int AS n FROM qlt_oqc_order");
  const hasData = Boolean(ordersToday || pendingPallets || reworkN || totalOrders || stationRows.some(s => s.total));
  return {
    range: { days: d, date: today },
    kpi: { pending: pendingPallets, today_orders: ordersToday, today_judged: judgedToday,
      today_pass: passToday, today_fail: failToday,
      pass_rate: judgedToday ? Math.round(passToday * 100.0 / judgedToday * 10) / 10 : null,
      rework: reworkN, po_ready: poReady },
    stations: stationRows, queue, ng_list: ngList, trend: tr, pos: pos.slice(0, 10), has_data: hasData,
  };
}

// ═════════════════════════ AQL（源 core/aql.py，ANSI/ASQC Z1.4 单次计数型）═════════════════════════

const SAMPLE_SIZE = { A:2,B:3,C:5,D:8,E:13,F:20,G:32,H:50,J:80,K:125,L:200,M:315,N:500,P:800,Q:1250,R:2000 };
const LOT_RANGES = [[1,8,"A"],[9,15,"B"],[16,25,"C"],[26,50,"D"],[51,90,"E"],[91,150,"F"],[151,280,"G"],[281,500,"H"],[501,1200,"J"],[1201,3200,"K"],[3201,10000,"L"],[10001,35000,"M"],[35001,150000,"N"],[150001,500000,"P"],[500001,1e12,"Q"]];
const CODE_ORDER = ["A","B","C","D","E","F","G","H","J","K","L","M","N","P","Q","R"];
const LEVEL_SHIFT = { I:-1, II:0, III:1 };
const PLANS_NORMAL = {
  A:{"6.5":[0,1],"25":[1,2],"40":[2,3],"65":[3,4],"100":[5,6],"150":[7,8],"250":[10,11],"400":[14,15],"650":[21,22],"1000":[30,31]},
  B:{"4":[0,1],"15":[1,2],"25":[2,3],"40":[3,4],"65":[5,6],"100":[7,8],"150":[10,11],"250":[14,15],"400":[21,22],"650":[30,31],"1000":[44,45]},
  C:{"2.5":[0,1],"10":[1,2],"15":[2,3],"25":[3,4],"40":[5,6],"65":[7,8],"100":[10,11],"150":[14,15],"250":[21,22],"400":[30,31],"650":[44,45]},
  D:{"1.5":[0,1],"6.5":[1,2],"10":[2,3],"15":[3,4],"25":[5,6],"40":[7,8],"65":[10,11],"100":[14,15],"150":[21,22],"250":[30,31],"400":[44,45]},
  E:{"1":[0,1],"4":[1,2],"6.5":[2,3],"10":[3,4],"15":[5,6],"25":[7,8],"40":[10,11],"65":[14,15],"100":[21,22],"150":[30,31],"250":[44,45]},
  F:{"0.65":[0,1],"2.5":[1,2],"4":[2,3],"6.5":[3,4],"10":[5,6],"15":[7,8],"25":[10,11],"40":[14,15],"65":[21,22]},
  G:{"0.4":[0,1],"1.5":[1,2],"2.5":[2,3],"4":[3,4],"6.5":[5,6],"10":[7,8],"15":[10,11],"25":[14,15],"40":[21,22]},
  H:{"0.25":[0,1],"1":[1,2],"1.5":[2,3],"2.5":[3,4],"4":[5,6],"6.5":[7,8],"10":[10,11],"15":[14,15],"25":[21,22]},
  J:{"0.15":[0,1],"0.65":[1,2],"1":[2,3],"1.5":[3,4],"2.5":[5,6],"4":[7,8],"6.5":[10,11],"10":[14,15],"15":[21,22]},
  K:{"0.1":[0,1],"0.4":[1,2],"0.65":[2,3],"1":[3,4],"1.5":[5,6],"2.5":[7,8],"4":[10,11],"6.5":[14,15],"10":[21,22]},
  L:{"0.065":[0,1],"0.25":[1,2],"0.4":[2,3],"0.65":[3,4],"1":[5,6],"1.5":[7,8],"2.5":[10,11],"4":[14,15],"6.5":[21,22]},
  M:{"0.04":[0,1],"0.15":[1,2],"0.25":[2,3],"0.4":[3,4],"0.65":[5,6],"1":[7,8],"1.5":[10,11],"2.5":[14,15],"4":[21,22]},
  N:{"0.025":[0,1],"0.1":[1,2],"0.15":[2,3],"0.25":[3,4],"0.4":[5,6],"0.65":[7,8],"1":[10,11],"1.5":[14,15],"2.5":[21,22]},
  P:{"0.015":[0,1],"0.065":[1,2],"0.1":[2,3],"0.15":[3,4],"0.25":[5,6],"0.4":[7,8],"0.65":[10,11],"1":[14,15],"1.5":[21,22]},
  Q:{"0.01":[0,1],"0.04":[1,2],"0.065":[2,3],"0.1":[3,4],"0.15":[5,6],"0.25":[7,8],"0.4":[10,11],"0.65":[14,15],"1":[21,22]},
  R:{"0.025":[1,2],"0.04":[2,3],"0.065":[3,4],"0.1":[5,6],"0.15":[7,8],"0.25":[10,11],"0.4":[14,15],"0.65":[21,22]},
};
const PLANS_TIGHTENED = {
  A:{"40":[1,2],"65":[2,3],"100":[3,4],"150":[5,6],"250":[8,9],"400":[12,13],"650":[18,19],"1000":[27,28]},
  B:{"6.5":[0,1],"25":[1,2],"40":[2,3],"65":[3,4],"100":[5,6],"150":[8,9],"250":[12,13],"400":[18,19],"650":[27,28],"1000":[41,42]},
  C:{"4":[0,1],"15":[1,2],"25":[2,3],"40":[3,4],"65":[5,6],"100":[8,9],"150":[12,13],"250":[18,19],"400":[27,28],"650":[41,42]},
  D:{"2.5":[0,1],"10":[1,2],"15":[2,3],"25":[3,4],"40":[5,6],"65":[8,9],"100":[12,13],"150":[18,19],"250":[27,28],"400":[41,42]},
  E:{"1.5":[0,1],"6.5":[1,2],"10":[2,3],"15":[3,4],"25":[5,6],"40":[8,9],"65":[12,13],"100":[18,19],"150":[27,28],"250":[41,42]},
  F:{"1":[0,1],"4":[1,2],"6.5":[2,3],"10":[3,4],"15":[5,6],"25":[8,9],"40":[12,13],"65":[18,19]},
  G:{"0.65":[0,1],"2.5":[1,2],"4":[2,3],"6.5":[3,4],"10":[5,6],"15":[8,9],"25":[12,13],"40":[18,19]},
  H:{"0.4":[0,1],"1.5":[1,2],"2.5":[2,3],"4":[3,4],"6.5":[5,6],"10":[8,9],"15":[12,13],"25":[18,19]},
  J:{"0.25":[0,1],"1":[1,2],"1.5":[2,3],"2.5":[3,4],"4":[5,6],"6.5":[8,9],"10":[12,13],"15":[18,19]},
  K:{"0.15":[0,1],"0.65":[1,2],"1":[2,3],"1.5":[3,4],"2.5":[5,6],"4":[8,9],"6.5":[12,13],"10":[18,19]},
  L:{"0.1":[0,1],"0.4":[1,2],"0.65":[2,3],"1":[3,4],"1.5":[5,6],"2.5":[8,9],"4":[12,13],"6.5":[18,19]},
  M:{"0.065":[0,1],"0.25":[1,2],"0.4":[2,3],"0.65":[3,4],"1":[5,6],"1.5":[8,9],"2.5":[12,13],"4":[18,19]},
  N:{"0.04":[0,1],"0.15":[1,2],"0.25":[2,3],"0.4":[3,4],"0.65":[5,6],"1":[8,9],"1.5":[12,13],"2.5":[18,19]},
  P:{"0.025":[0,1],"0.1":[1,2],"0.15":[2,3],"0.25":[3,4],"0.4":[5,6],"0.65":[8,9],"1":[12,13],"1.5":[18,19]},
  Q:{"0.015":[0,1],"0.065":[1,2],"0.1":[2,3],"0.15":[3,4],"0.25":[5,6],"0.4":[8,9],"0.65":[12,13],"1":[18,19]},
  R:{"0.01":[0,1],"0.04":[1,2],"0.065":[2,3],"0.1":[3,4],"0.15":[5,6],"0.25":[8,9],"0.4":[12,13],"0.65":[18,19]},
};
const PLANS_REDUCED = {
  A:{"6.5":[0,1],"25":[1,2],"40":[2,3],"65":[3,4],"100":[5,6],"150":[7,8],"250":[10,11],"400":[14,15],"650":[21,22],"1000":[30,31]},
  B:{"4":[0,1],"15":[0,2],"25":[1,3],"40":[2,4],"65":[3,5],"100":[5,6],"150":[7,8],"250":[10,11],"400":[14,15],"650":[21,22],"1000":[30,31]},
  C:{"2.5":[0,1],"10":[0,2],"15":[1,3],"25":[1,4],"40":[2,5],"65":[3,6],"100":[5,8],"150":[7,10],"250":[10,13],"400":[14,17],"650":[21,24]},
  D:{"1.5":[0,1],"6.5":[0,2],"10":[1,3],"15":[1,4],"25":[2,5],"40":[3,6],"65":[5,8],"100":[7,10],"150":[10,13],"250":[14,17],"400":[21,24]},
  E:{"1":[0,1],"4":[0,2],"6.5":[1,3],"10":[1,4],"15":[2,5],"25":[3,6],"40":[5,8],"65":[7,10],"100":[10,13],"150":[14,17],"250":[21,24]},
  F:{"0.65":[0,1],"2.5":[0,2],"4":[1,3],"6.5":[1,4],"10":[2,5],"15":[3,6],"25":[5,8],"40":[7,10],"65":[10,13]},
  G:{"0.4":[0,1],"1.5":[0,2],"2.5":[1,3],"4":[1,4],"6.5":[2,5],"10":[3,6],"15":[5,8],"25":[7,10],"40":[10,13]},
  H:{"0.25":[0,1],"1":[0,2],"1.5":[1,3],"2.5":[1,4],"4":[2,5],"6.5":[3,6],"10":[5,8],"15":[7,10],"25":[10,13]},
  J:{"0.15":[0,1],"0.65":[0,2],"1":[1,3],"1.5":[1,4],"2.5":[2,5],"4":[3,6],"6.5":[5,8],"10":[7,10],"15":[10,13]},
  K:{"0.1":[0,1],"0.4":[0,2],"0.65":[1,3],"1":[1,4],"1.5":[2,5],"2.5":[3,6],"4":[5,8],"6.5":[7,10],"10":[10,13]},
  L:{"0.065":[0,1],"0.25":[0,2],"0.4":[1,3],"0.65":[1,4],"1":[2,5],"1.5":[3,6],"2.5":[5,8],"4":[7,10],"6.5":[10,13]},
  M:{"0.04":[0,1],"0.15":[0,2],"0.25":[1,3],"0.4":[1,4],"0.65":[2,5],"1":[3,6],"1.5":[5,8],"2.5":[7,10],"4":[10,13]},
  N:{"0.025":[0,1],"0.1":[0,2],"0.15":[1,3],"0.25":[1,4],"0.4":[2,5],"0.65":[3,6],"1":[5,8],"1.5":[7,10],"2.5":[10,13]},
  P:{"0.015":[0,1],"0.065":[0,2],"0.1":[1,3],"0.15":[1,4],"0.25":[2,5],"0.4":[3,6],"0.65":[5,8],"1":[7,10],"1.5":[10,13]},
  Q:{"0.01":[0,1],"0.04":[0,2],"0.065":[1,3],"0.1":[1,4],"0.15":[2,5],"0.25":[3,6],"0.4":[5,8],"0.65":[7,10],"1":[10,13]},
  R:{"0.025":[0,2],"0.04":[1,3],"0.065":[1,4],"0.1":[2,5],"0.15":[3,6],"0.25":[5,8],"0.4":[7,10],"0.65":[10,13]},
};
const AQL_PLANS = { normal: PLANS_NORMAL, tightened: PLANS_TIGHTENED, reduced: PLANS_REDUCED };

function aqlCodeFor(lotQty, level = "II") {
  const n = _num(lotQty);
  if (n <= 0) return [null, "批量必须大于 0"];
  const shift = LEVEL_SHIFT[String(level || "II").trim().toUpperCase()];
  if (shift == null) return [null, `检验水平只支持 I / II / III（收到 ${level}）`];
  let code = "A";
  for (const [lo, hi, c] of LOT_RANGES) { if (lo <= n && n <= hi) { code = c; break; } }
  const i = CODE_ORDER.indexOf(code);
  const j = Math.min(Math.max(i + shift, 0), CODE_ORDER.length - 1);
  return [CODE_ORDER[j], ""];
}
function aqlResolve(plans, code, aql) {
  const key = String(aql);
  const row = plans[code] || {};
  if (key in row) return [code, row[key][0], row[key][1], ""];
  const i = CODE_ORDER.includes(code) ? CODE_ORDER.indexOf(code) : -1;
  for (const c of CODE_ORDER.slice(i + 1)) { const r = plans[c] || {}; if (key in r) return [c, r[key][0], r[key][1], `按 Z1.4 箭头↓改用样本代字 ${c}（样本量 ${SAMPLE_SIZE[c]}）`]; }
  for (const c of CODE_ORDER.slice(0, Math.max(i, 0)).reverse()) { const r = plans[c] || {}; if (key in r) return [c, r[key][0], r[key][1], `按 Z1.4 箭头↑改用样本代字 ${c}（样本量 ${SAMPLE_SIZE[c]}）`]; }
  return [null, null, null, "该 AQL 在本表中没有可用方案"];
}
function aqlPlan(lotQty, aql, level = "II", severity = "normal") {
  const sev = String(severity || "normal").toLowerCase();
  const plans = AQL_PLANS[sev] || PLANS_NORMAL;
  const [code, err] = aqlCodeFor(lotQty, level);
  if (err) return { ok: false, note: err };
  const a = Number(aql);
  if (!Number.isFinite(a)) return { ok: false, note: `AQL 不是数字：${aql}` };
  if (a <= 0) return { ok: false, note: "AQL 必须大于 0（致命缺陷按 Ac=0 规则判，不查表）" };
  const [c2, ac, re, note] = aqlResolve(plans, code, a);
  if (c2 == null) return { ok: false, note };
  const n = SAMPLE_SIZE[c2];
  if (ac != null && ac > n) return { ok: false, note: `该组合 Ac=${ac} 大于样本量 ${n}，表数据可疑` };
  return { ok: true, code: c2, lot_code: code, n, ac, re, aql: a, note, severity: sev };
}
function aqlPlansFor(lotQty, aqlMa = 1.0, aqlMi = 2.5, level = "II", severity = "normal") {
  const ma = aqlPlan(lotQty, aqlMa, level, severity);
  const mi = aqlPlan(lotQty, aqlMi, level, severity);
  if (!ma.ok) return { ok: false, note: ma.note };
  if (!mi.ok) return { ok: false, note: mi.note };
  return {
    ok: true, n: Math.max(ma.n, mi.n), level: String(level).toUpperCase(),
    code: ma.n >= mi.n ? ma.code : mi.code,
    cr: { ac: 0, re: 1, aql: 0 },
    ma: { ac: ma.ac, re: ma.re, aql: ma.aql, n: ma.n, note: ma.note || "" },
    mi: { ac: mi.ac, re: mi.re, aql: mi.aql, n: mi.n, note: mi.note || "" },
    severity: String(severity || "normal").toLowerCase(), lot_code: ma.lot_code,
  };
}
function aqlVerdict(defects, p) {
  const d = defects || {};
  if (!p || !p.ok) return [null, [`抽样方案不可用：${p?.note || "未知原因"}`]];
  const cr = _num(d.cr), ma = _num(d.ma), mi = _num(d.mi);
  const why = [];
  if (cr > 0) why.push(`致命缺陷 ${cr} 件（Ac=0，出现即判不合格）`);
  if (ma > p.ma.ac) why.push(`严重缺陷 ${ma} 件 > Ac ${p.ma.ac}`);
  if (mi > p.mi.ac) why.push(`轻微缺陷 ${mi} 件 > Ac ${p.mi.ac}`);
  if (why.length) return [false, why];
  return [true, [`致命 0 件；严重 ${ma} ≤ Ac ${p.ma.ac}；轻微 ${mi} ≤ Ac ${p.mi.ac}`]];
}

function _f(v, d = 0.0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
const SEV_CN = { normal: "正常检验", tightened: "加严检验", reduced: "减量检验" };
const LOT_BASIS_CN = { pallet: "按栈板台数", po: "按整批 PO 台数" };

/** 读全局 AQL 标准。返回扁平 param map（route 直接 ok(res, getStd())）。 */
export async function getStd() {
  await ensureSchema();
  const out = {};
  for (const [k, v] of STD_KEYS) out[k] = await getOqcParam(k, v);
  return out;
}
/** 保存全局 AQL 标准（先试算）。返回更新后的 map。 */
export async function setStd(d = {}, by = "") {
  await ensureSchema();
  const cur = await getStd();
  const level = String(d.level || cur["oqc.aql_level"] || "II").trim().toUpperCase();
  const sev = String(d.severity || cur["oqc.aql_severity"] || "normal").trim().toLowerCase();
  const ma = _f(d.aql_ma != null && d.aql_ma !== "" ? d.aql_ma : cur["oqc.aql_ma"], 0);
  const mi = _f(d.aql_mi != null && d.aql_mi !== "" ? d.aql_mi : cur["oqc.aql_mi"], 0);
  const probe = aqlPlansFor(1728, ma, mi, level, sev);
  if (!probe.ok) return { error: `这组参数查不到抽样方案：${probe.note || "未知原因"}` };
  await setOqcParam("oqc.aql_level", level);
  await setOqcParam("oqc.aql_ma", String(ma));
  await setOqcParam("oqc.aql_mi", String(mi));
  await setOqcParam("oqc.aql_severity", sev);
  if (d.lot_basis != null) await setOqcParam("oqc.aql_lot_basis", String(d.lot_basis).trim().toLowerCase());
  await oqcAudit(by || "system", "OQC", "AQL标准设置", "oqc.aql", `水平 ${level} / MA ${ma} / MI ${mi} / ${SEV_CN[sev] || sev}`, "");
  return getStd();
}

/** 批量→代字→抽样数→Ac/Re 速查。返回数组（route 传单个 lot 也兼容）。 */
export async function aqlPreview(lot = 0, level = "II", severity = "normal") {
  await ensureSchema();
  const std = await getStd();
  const lv = String(level || std["oqc.aql_level"] || "II").trim().toUpperCase();
  const sev = String(severity || std["oqc.aql_severity"] || "normal").trim().toLowerCase();
  const ma = _f(std["oqc.aql_ma"], 1.0), mi = _f(std["oqc.aql_mi"], 2.5);
  const lots = _num(lot) > 0 ? [_num(lot)] : STD_PREVIEW_LOTS;
  return lots.map(n => {
    const p = aqlPlansFor(n, ma, mi, lv, sev);
    if (!p.ok) return { lot: n, error: p.note };
    return { lot: n, code: p.code, n: p.n, ac_ma: p.ma.ac, re_ma: p.ma.re, ac_mi: p.mi.ac, re_mi: p.mi.re };
  });
}

/** 给抽检单套用 AQL 方案并写回。返回 [plan, err]。 */
export async function applyPlan(oqcNo_, by = "") {
  await ensureSchema();
  const o = (await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0];
  if (!o) return [null, `抽检单不存在：${oqcNo_}`];
  const std = await getStd();
  const level = String(o.aql_level || std["oqc.aql_level"] || "II").trim().toUpperCase();
  const severity = String(o.aql_severity || std["oqc.aql_severity"] || "normal").trim().toLowerCase();
  const ma = _f(o.aql_ma || std["oqc.aql_ma"], 1.0), mi = _f(o.aql_mi || std["oqc.aql_mi"], 2.5);
  let lot = _num(o.lot_qty) || _num(o.pallet_qty);
  if (lot <= 0) {
    lot = _num((await query("SELECT COALESCE(SUM(box_qty),0) AS s FROM qlt_oqc_item WHERE oqc_no=$1", [oqcNo_])).rows[0]?.s);
  }
  if (lot <= 0) return [null, "批量必须大于 0"];
  const p = aqlPlansFor(lot, ma, mi, level, severity);
  if (!p.ok) return [null, p.note || "抽样方案算不出来"];
  const ts = _now();
  await query(
    `UPDATE qlt_oqc_order SET lot_qty=$1, aql_level=$2, aql_severity=$3, aql_ma=$4, aql_mi=$5,
     code_letter=$6, sample_n_aql=$7, ac_ma=$8, re_ma=$9, ac_mi=$10, re_mi=$11, aql_note=$12, updated_at=$13 WHERE oqc_no=$14`,
    [lot, level, severity, p.ma.aql, p.mi.aql, p.code, p.n, p.ma.ac, p.ma.re, p.mi.ac, p.mi.re,
     [p.ma.note, p.mi.note].filter(Boolean).join("；"), ts, oqcNo_]);
  await oqcAudit(by || "system", "OQC", "定抽样方案", oqcNo_, `批量 ${lot} / 水平 ${p.level} → 代字 ${p.code}，抽 ${p.n} 台`, "");
  return [{ lot_qty: lot, level: p.level, code: p.code, n: p.n, ac_ma: p.ma.ac, re_ma: p.ma.re,
    ac_mi: p.mi.ac, re_mi: p.mi.re, aql_ma: p.ma.aql, aql_mi: p.mi.aql, severity: p.severity }, null];
}

/** AQL 判定（缺陷数来自单上）。返回 [order, err]。 */
export async function aqlJudge(oqcNo_, inspector = "") {
  await ensureSchema();
  let o = (await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0];
  if (!o) return [null, `抽检单不存在：${oqcNo_}`];
  if (!_num(o.sample_n_aql)) { const [, err] = await applyPlan(oqcNo_, inspector); if (err) return [null, err]; o = (await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0]; }
  const p = { ok: true, n: _num(o.sample_n_aql), cr: { ac: 0, re: 1 },
    ma: { ac: _num(o.ac_ma), re: _num(o.re_ma) }, mi: { ac: _num(o.ac_mi), re: _num(o.re_mi) } };
  const [passed, why] = aqlVerdict({ cr: _num(o.defect_cr), ma: _num(o.defect_ma), mi: _num(o.defect_mi) }, p);
  if (passed == null) return [null, why.join("；")];
  const result = passed ? ST_PASS : ST_FAIL;
  const ts = _now();
  const boxes = (await query("SELECT * FROM qlt_oqc_item WHERE oqc_no=$1 ORDER BY box_no", [oqcNo_])).rows;
  const okBoxes = boxes.filter(b => b.result === "OK").map(b => b.box_no);
  const ngBoxes = boxes.filter(b => b.result === "NG").map(b => b.box_no);
  await query(
    `UPDATE qlt_oqc_order SET aql_result=$1, result=$2, status=$3, ok_boxes=$4, ng_boxes=$5,
     inspector=$6, inspect_time=$7, review_decision=$8, updated_at=$9 WHERE oqc_no=$10`,
    [why.join("；"), result, result, _join(okBoxes), _join(ngBoxes), inspector || o.inspector || "", ts,
     passed ? "" : DEC_PENDING, ts, oqcNo_]);
  if (passed) {
    await query("UPDATE prd_pallet SET oqc_status='合格', oqc_time=$1, release_locked=0, oqc_waiver=0, updated_at=now() WHERE pallet_no=$2", [ts, o.pallet_no]);
  } else {
    await query("UPDATE prd_pallet SET oqc_status='不合格', oqc_time=$1, release_locked=1, oqc_waiver=0, updated_at=now() WHERE pallet_no=$2", [ts, o.pallet_no]);
    for (const bno of (ngBoxes.length ? ngBoxes : boxes.map(b => b.box_no))) {
      const b = boxes.find(x => x.box_no === bno);
      await query(
        `INSERT INTO qlt_oqc_rework (oqc_no,pallet_no,box_no,ng_qty,reason,action,operator,result,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,'进行中',$8)`,
        [oqcNo_, o.pallet_no, bno, _num(b?.box_qty), `AQL 不合格：${why.join("；")}`, "整箱返工复检", inspector || "", ts]);
    }
  }
  if (o.po_no) await refreshPo(o.po_no);
  await oqcAudit(inspector || "system", "OQC", "AQL 判定", oqcNo_, `${result}：${why.join("；")}`, "");
  return [await orderJson((await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0]), null];
}

/** 评审：返工 / 特采 / 报废。返回 [result, err]。 */
export async function oqcReview(oqcNo_, decision, reason = "", by = "", defectJson = "", remark = "") {
  await ensureSchema();
  const o = (await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0];
  if (!o) return [null, `抽检单不存在：${oqcNo_}`];
  if (String(o.result || "") !== "不合格") return [null, `只有判不合格的单才需要评审（当前 ${o.result || "未判定"}）`];
  if (![DEC_REWORK, DEC_WAIVER, DEC_SCRAP].includes(decision)) return [null, "评审结论只能是 返工 / 特采 / 报废"];
  if (decision === DEC_WAIVER && !String(reason || "").trim()) return [null, "特采必须写理由（让步接收的依据）"];
  const ts = _now();
  await query("UPDATE qlt_oqc_order SET review_decision=$1, review_by=$2, review_time=$3, review_reason=$4, updated_at=$5 WHERE oqc_no=$6",
    [decision, by || "", ts, reason || "", ts, oqcNo_]);
  const pass = decision === DEC_WAIVER;
  await query("UPDATE prd_pallet SET oqc_status=$1, release_locked=$2, oqc_waiver=$3, updated_at=now() WHERE pallet_no=$4",
    [pass ? "合格" : "不合格", pass ? 0 : 1, pass ? 1 : 0, o.pallet_no]);
  await query(
    `INSERT INTO qlt_oqc_review (oqc_no,po_no,pallet_no,decision,reason,defect_json,by_user,at_time,remark)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [oqcNo_, o.po_no || "", o.pallet_no, decision, reason || "",
     defectJson || `{"cr":${_num(o.defect_cr)},"ma":${_num(o.defect_ma)},"mi":${_num(o.defect_mi)}}`, by || "", ts, remark || ""]);
  if (o.po_no) await refreshPo(o.po_no);
  await oqcAudit(by || "system", "OQC", "验货失败评审", oqcNo_, `${decision}：${reason || ""}`, "");
  return [{ oqc_no: oqcNo_, decision, pallet_no: o.pallet_no }, null];
}

/** 返工扫码登记（含拒绝留痕）。返回 [result, err]。 */
export async function oqcScan(oqcNo_, sn, belong = 0, result = "", reason = "", operator = "") {
  await ensureSchema();
  const o = (await query("SELECT * FROM qlt_oqc_order WHERE oqc_no=$1", [oqcNo_])).rows[0];
  if (!o) return [null, `抽检单不存在：${oqcNo_}`];
  const ts = _now();
  await query(
    `INSERT INTO qlt_oqc_rework_scan (oqc_no,pallet_no,sn,belong,result,reason,operator,at_time)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [oqcNo_, o.pallet_no, String(sn || "").trim(), _num(belong) ? 1 : 0, result || "OK", reason || "", operator || "", ts]);
  await oqcAudit(operator || "system", "OQC", "返工扫码", oqcNo_, `SN ${sn || ""} 结果 ${result || "OK"}`, "");
  return [{ oqc_no: oqcNo_, sn, result: result || "OK" }, null];
}

export async function scansOf(oqcNo_) {
  await ensureSchema();
  return (await query("SELECT * FROM qlt_oqc_rework_scan WHERE oqc_no=$1 ORDER BY id DESC LIMIT 200", [oqcNo_])).rows;
}

export async function reviewList(limit = 50) {
  await ensureSchema();
  return (await query(
    `SELECT o.oqc_no, o.po_no, o.pallet_no, o.result, o.lot_qty, o.sample_n_aql, o.defect_cr,
       o.defect_ma, o.defect_mi, o.ac_ma, o.ac_mi, o.review_decision, o.review_by, o.review_time,
       o.review_reason, o.notify_state, o.rework_start_time, o.inspect_time
     FROM qlt_oqc_order o ORDER BY o.id DESC LIMIT $1`,
    [Math.min(Math.max(_num(limit, 50), 1), 200)])).rows;
}

// ═════════════════════════ 逐项检验（源 core/oqc_check.py）═════════════════════════

async function _sampleQty(poNo) {
  const o = (await query("SELECT oqc_no, sample_boxes FROM qlt_oqc_order WHERE po_no=$1 ORDER BY id DESC LIMIT 1", [poNo])).rows[0];
  if (!o) return [0, 0];
  const n = _num((await query("SELECT COALESCE(SUM(box_qty),0) AS s FROM qlt_oqc_item WHERE oqc_no=$1", [o.oqc_no])).rows[0]?.s);
  return [n, _split(o.sample_boxes).length];
}
function _verdict(rows) {
  if (!rows.length) return "";
  return rows.some(r => _num(r.ng_qty) > 0) ? "不合格" : "合格";
}

/** 该 PO 逐项检验清单（配置 + 已录合并）。返回数组。 */
export async function listItems(poNo, model = "") {
  await ensureCheckSchema();
  poNo = String(poNo || "").trim();
  if (!poNo) return [];
  if (!model) {
    const po = (await query("SELECT product_code FROM ord_po WHERE po_no=$1", [poNo])).rows[0] || {};
    const p = (await query("SELECT product_model FROM md_product WHERE product_code=$1", [po.product_code || ""])).rows[0] || {};
    model = p.product_model || "";
  }
  const cfg = (await query(
    "SELECT * FROM cfg_oqc_item WHERE enabled=1 AND (model=$1 OR model='') ORDER BY seq, CASE WHEN model='' THEN 1 ELSE 0 END", [model])).rows;
  const saved = {};
  for (const r of (await query("SELECT * FROM qlt_oqc_check WHERE po_no=$1", [poNo])).rows) saved[_num(r.seq)] = r;
  return cfg.map(c => {
    const seq = _num(c.seq);
    const s = saved[seq];
    const insp = s ? _num(s.insp_qty) : _num(c.insp_default);
    const ng = s ? _num(s.ng_qty) : 0;
    return {
      seq, cat: (s && s.cat) || c.cat || "", item_name: (s && s.item_name) || c.item_name || "",
      spec: (s && s.spec) || c.spec || "", insp_qty: insp, ng_qty: ng, ok_qty: Math.max(insp - ng, 0),
      equip: (s && s.equip) || c.equip || "", remark: (s && s.remark) || "",
      inspector: (s && s.inspector) || "", check_time: (s && s.check_time) || "", saved: Boolean(s),
    };
  });
}

/** 整批覆盖保存逐项检验。返回 {poNo, saved}。 */
export async function saveCheckItems(poNo, items = [], user = "") {
  await ensureCheckSchema();
  poNo = String(poNo || "").trim();
  if (!poNo) return { poNo, error: "请先选 PO" };
  if (!(await query("SELECT po_no FROM ord_po WHERE po_no=$1", [poNo])).rows[0]) return { poNo, error: `PO ${poNo} 不在订单主档里` };
  const po = (await query("SELECT product_code FROM ord_po WHERE po_no=$1", [poNo])).rows[0] || {};
  const p = (await query("SELECT product_model FROM md_product WHERE product_code=$1", [po.product_code || ""])).rows[0] || {};
  const model = p.product_model || "";
  const ts = _now();
  let n = 0, err = "";
  for (const r of items) {
    const seq = _num(r.seq, NaN);
    if (!Number.isFinite(seq)) continue;
    const insp = Math.max(_num(r.insp_qty), 0), ng = Math.max(_num(r.ng_qty), 0);
    if (ng > insp) { err = `第 ${seq} 项不良数(${ng}) 大于检验数量(${insp})`; break; }
    const old = (await query("SELECT id FROM qlt_oqc_check WHERE po_no=$1 AND seq=$2", [poNo, seq])).rows[0];
    if (old) {
      await query("UPDATE qlt_oqc_check SET insp_qty=$1, ng_qty=$2, equip=$3, remark=$4, inspector=$5, check_time=$6, updated_at=$7 WHERE id=$8",
        [insp, ng, r.equip || "", r.remark || "", user || "", ts, ts, old.id]);
    } else {
      await query(
        `INSERT INTO qlt_oqc_check (po_no,model,seq,cat,item_name,spec,insp_qty,ng_qty,equip,remark,inspector,check_time,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [poNo, model, seq, r.cat || "", r.item_name || "", r.spec || "", insp, ng, r.equip || "", r.remark || "", user || "", ts, ts, ts]);
    }
    n++;
  }
  if (err) return { poNo, error: err };
  await oqcAudit(user || "system", "OQC", "录逐项检验", poNo, `共 ${n} 项`, "");
  return { poNo, saved: n };
}

/** 检验上下文（默认项 + 已录）。返回 {poNo, model, items}。 */
export async function checkCtx(poNo, model = "") {
  await ensureCheckSchema();
  const items = await listItems(poNo, model);
  return { poNo, model, items };
}

/** 检验汇总。返回 {poNo, insp_qty, ng_qty, ok_qty, pass_rate, items}。 */
export async function checkSummary(poNo) {
  await ensureCheckSchema();
  const items = await listItems(poNo);
  const insp = items.reduce((s, r) => s + _num(r.insp_qty), 0);
  const ng = items.reduce((s, r) => s + _num(r.ng_qty), 0);
  const ok = insp - ng;
  return { poNo, insp_qty: insp, ng_qty: ng, ok_qty: ok,
    pass_rate: insp ? Math.round(ok * 100.0 / insp * 10) / 10 : null, items };
}
