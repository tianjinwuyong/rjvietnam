/**
 * 镭雕发码（源 设备对接工具/镭雕机/laser_sn_server.py + api/exec.py laser 段）
 *
 * 镭雕机每雕一片就连上来要一个号，我们回一个 PCBA SN 并落库（下发即记录）。
 * SN 按 cfg_sn_rule 的 PCBA 段定义拼（FIX/DATE/SEQ），序列号游标存 sys_param laser.seq_next。
 * 版号按「当前工单已发数量」分组：换工单自动从第 1 版重新开始。
 * 上限按工单计划量 + laser.over_pct 超发余量，锁内校验，防并发超发。
 */
import { query, getParam, setParam } from "../db.js";

async function pcbaRule() {
  return (await query(
    `SELECT * FROM cfg_sn_rule WHERE sn_type='PCBA' AND enabled=1 ORDER BY id DESC LIMIT 1`)).rows[0];
}

function parseSegments(rule) {
  try {
    const arr = JSON.parse(rule?.segments || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 按 PCBA 段定义拼号（序列号外部传入） */
export function makeSn(seq, rule, machineCode) {
  const segs = parseSegments(rule);
  if (!segs.length) throw new Error("PCBA 规则的段定义是空的");
  const mc = String(machineCode || "5").trim() || "5";
  let out = "";
  for (const s of segs) {
    const t = String(s.type || "").toUpperCase();
    const n = Number(s.len || 0);
    if (!(n > 0)) continue;
    if (t === "FIX" || t === "FIXED") {
      const v = String(s.value || s.val || "").trim() || mc;
      out += v.slice(0, n).padEnd(n, "0");
    } else if (t === "DATE") {
      const fmt = String(s.fmt || "");
      const d = new Date();
      let part = "";
      if (fmt.includes("YY")) part = String(d.getFullYear()).slice(-2);
      else if (fmt.includes("Y")) part = String(d.getFullYear());
      if (fmt.includes("MM")) part += String(d.getMonth() + 1).padStart(2, "0");
      if (fmt.includes("DD")) part += String(d.getDate()).padStart(2, "0");
      out += part.slice(0, n).padEnd(n, "0");
    } else if (t === "SEQ") {
      out += String(seq).padStart(n, "0");
    } else {
      out += "0".repeat(n);
    }
  }
  return out;
}

async function maxSeqInDb() {
  let mx = 0;
  for (const sql of [
    "SELECT COALESCE(MAX(seq_no),0) AS m FROM prd_laser_sn",
    "SELECT COALESCE(MAX(cur_seq),0) AS m FROM prd_sn WHERE sn_type='PCBA'",
  ]) {
    try { mx = Math.max(mx, Number((await query(sql)).rows[0]?.m || 0)); } catch { /* 表可能还没建 */ }
  }
  // 已建档 PCBA 反解序列（5GAP14726A → 14726）
  try {
    const rows = (await query(
      `SELECT sn FROM prd_sn WHERE sn_type='PCBA' AND length(sn)=10 ORDER BY id DESC LIMIT 500`)).rows;
    for (const r of rows) {
      const s = String(r.sn || "");
      if (s.length === 10 && /^\d{5}$/.test(s.slice(4, 9))) mx = Math.max(mx, Number(s.slice(4, 9)));
    }
  } catch { /* 忽略 */ }
  return mx;
}

/** 下一个可用序列号（游标 laser.seq_next 优先；人工起点 laser.seq_start；都没有则库内最大+1） */
export async function initSeq({ force = null, dry = false } = {}) {
  if (force !== null) return Number(force);
  const cur = String(await getParam("laser.seq_next", "")).trim();
  if (cur && /^\d+$/.test(cur)) return Number(cur);
  const start = String(await getParam("laser.seq_start", "")).trim();
  const base = start && /^\d+$/.test(start) ? Number(start) : await maxSeqInDb();
  const next = base + 1;
  if (!dry) await setParam("laser.seq_next", String(next), "镭雕下一个序列号", "镭雕机");
  return next;
}

/** 取号业务上下文：当前工单 / 机型 / 拼版块数 / 机台（源 _resolve_context） */
export async function resolveContext(clientIp) {
  const moNo = String(await getParam("laser.cur_mo", "")).trim();
  if (!moNo) throw new Error("未设置当前生产工单 —— 请到「生产执行 → 镭雕发码记录」页面选择当前工单");
  const mo = (await query(
    "SELECT mo_no, product_code, fg_code, line_code, status, plan_qty FROM ord_mo WHERE mo_no=$1",
    [moNo])).rows[0];
  if (!mo) throw new Error(`当前工单 ${moNo} 不存在，请重新选择`);
  if (["已完工", "已关闭", "已取消"].includes(mo.status)) {
    throw new Error(`当前工单 ${moNo} 状态为「${mo.status}」，请选择在制工单`);
  }
  const fg = String(mo.fg_code || "").trim();
  const pc = String(mo.product_code || "").trim();
  let layout = null;
  for (const code of [fg, pc]) {
    if (!code) continue;
    layout = (await query(
      `SELECT * FROM cfg_panel_layout WHERE enabled=1 AND product_code=$1 ORDER BY id DESC LIMIT 1`,
      [code])).rows[0];
    if (layout) break;
  }
  if (!layout) {
    throw new Error(`工单 ${moNo} 的成品料号（${fg || "-"} / ${pc || "-"}）没有配拼版 —— 请到「配置中心 → 拼版布局」添加该机型`);
  }
  const panelSize = Number(layout.total || 0);
  if (!(panelSize > 0)) throw new Error(`工单 ${moNo} 对应机型的拼版块数为 0，请检查拼版配置`);
  const mac = (await query(
    `SELECT machine_no, line_code FROM cfg_laser_machine WHERE enabled=1 AND ip=$1 LIMIT 1`,
    [clientIp])).rows[0];
  return {
    mo_no: moNo,
    product_code: fg || pc,
    product_model: String(layout.model || ""),
    panel_size: panelSize,
    machine_no: mac?.machine_no || `未登记(${clientIp})`,
    line_code: mac?.line_code || mo.line_code || "",
    plan_qty: Number(mo.plan_qty || 0),
  };
}

/** 计划量 + 超发余量上限（源 _check_qty_limit） */
export async function qtyLimit(ctx) {
  const plan = Number(ctx.plan_qty || 0);
  if (!(plan > 0)) return null;
  const pct = Number(await getParam("laser.over_pct", "2")) || 2;
  const limit = Math.floor(plan * (1 + pct / 100));
  const issued = Number((await query(
    "SELECT COUNT(*)::int AS n FROM prd_laser_sn WHERE mo_no=$1", [ctx.mo_no])).rows[0]?.n || 0);
  if (issued >= limit) {
    throw new Error(`工单 ${ctx.mo_no} 已发 ${issued} 个号，达到上限 ${limit}（计划 ${plan} 台 + 超发 ${pct}%）。请换工单，或调整系统参数 laser.over_pct`);
  }
  return { issued, limit };
}

/** 取一个 SN（线程安全：单进程内用互斥；跨进程由 DB 唯一键兜底） */
export async function takeSn(clientIp, { dry = false, forceSeq = null } = {}) {
  const ctx = await resolveContext(clientIp);
  const size = ctx.panel_size;
  await qtyLimit(ctx);   // 计划量 + 超发余量，超了直接拒发
  const rule = await pcbaRule();
  const machineCode = String(await getParam("laser.machine_code", "5")).trim() || "5";
  let seq = await initSeq({ dry, force: forceSeq });
  let sn = "";
  for (let i = 0; i < 200; i++) {
    sn = makeSn(seq, rule, machineCode);
    const dup = (await query(
      "SELECT 1 FROM prd_laser_sn WHERE sn=$1 UNION ALL SELECT 1 FROM prd_sn WHERE sn=$1 LIMIT 1",
      [sn])).rows[0];
    if (!dup) break;
    seq += 1;
  }
  const dupCheck = (await query(
    "SELECT 1 FROM prd_laser_sn WHERE sn=$1 LIMIT 1", [sn])).rows[0];
  if (dupCheck) throw new Error("连续 200 次撞号，检查 SN 规则/序列起点");

  const issued = Number((await query(
    "SELECT COUNT(*)::int AS n FROM prd_laser_sn WHERE mo_no=$1", [ctx.mo_no])).rows[0]?.n || 0);
  const panelNo = Math.floor(issued / size) + 1;
  const panelPos = (issued % size) + 1;
  const brief = `${ctx.mo_no} / ${ctx.product_model || "-"} / ${size}块版 / 第${panelNo}版第${panelPos}块`;

  if (dry) return { sn, seq, ctx, brief, dry: true };
  await query(
    `INSERT INTO prd_laser_sn (sn, seq_no, machine_code, client_ip, status, panel_no, panel_pos,
       mo_no, product_code, product_model, machine_no, panel_size)
     VALUES ($1,$2,$3,$4,'issued',$5,$6,$7,$8,$9,$10,$11)`,
    [sn, seq, machineCode, clientIp, panelNo, panelPos, ctx.mo_no, ctx.product_code,
      ctx.product_model, ctx.machine_no, size]);
  await setParam("laser.seq_next", String(seq + 1), "镭雕下一个序列号", "镭雕机");
  return { sn, seq, ctx, brief, dry: false };
}

/** 按 SN 查版（源 laser_panel） */
export async function panel(sn) {
  const row = (await query("SELECT * FROM prd_laser_sn WHERE sn=$1", [sn])).rows[0];
  if (!row) return null;
  const mates = (await query(
    `SELECT sn, panel_pos FROM prd_laser_sn WHERE panel_no=$1 AND mo_no=$2
      ORDER BY panel_pos`, [row.panel_no, row.mo_no])).rows;
  return { ...row, mates };
}

/** 发码记录（源 laser_panels） */
export async function panels({ moNo = "", page = 1, size = 50 } = {}) {
  const where = ["1=1"], args = [];
  if (moNo) { args.push(moNo); where.push(`mo_no=$${args.length}`); }
  const total = (await query(
    `SELECT COUNT(*)::int AS n FROM prd_laser_sn WHERE ${where.join(" AND ")}`, args)).rows[0]?.n || 0;
  const rows = (await query(
    `SELECT * FROM prd_laser_sn WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, size, (page - 1) * size])).rows;
  return { rows, total, page, size };
}

export default { makeSn, initSeq, resolveContext, qtyLimit, takeSn, panel, panels };