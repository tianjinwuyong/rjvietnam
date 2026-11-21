/**
 * W12 维修明细核心 —— 源 core/repair_detail.py + core/scrap_release.py + core/designator.py
 * 关键转换：SQLite -> PG (ILIKE, timestamptz, bigserial)
 * 依赖：panel.js (codesOf/parseSn/joinSn), db.js (query)
 */
import { query } from "../db.js";
import { parseSn, joinSn } from "./panel.js";

export const VS_ATE = "ATE复测";
export const VS_MANUAL = "人工判定";
export const V_WAIT_ATE = "待复测";
export const V_WAIT_CHECK = "待复核";
export const V_WAIT_SCRAP = "待判废";
export const V_PASS = "已通过";
export const V_NG = "判NG";
export const DEAD_STATUS = ["报废", "已作废"];
export const PENDING_HANDLE = "待处理";

export const DEFAULT_DISPOSITIONS = [
  { code: "SOLDER", name_cn: "补锡", name_en: "Touch-up solder", name_vi: "Hàn bổ sung", need_part: 0, sort_no: 10 },
  { code: "REPLACE", name_cn: "换件", name_en: "Replace part", name_vi: "Thay linh kiện", need_part: 1, sort_no: 20 },
  { code: "CLEAN", name_cn: "清洗", name_en: "Clean", name_vi: "Vệ sinh", need_part: 0, sort_no: 30 },
  { code: "ADJUST", name_cn: "调整/校正", name_en: "Adjust", name_vi: "Điều chỉnh", need_part: 0, sort_no: 40 },
  { code: "GLUE", name_cn: "加胶固定", name_en: "Add glue", name_vi: "Keo cố định", need_part: 0, sort_no: 50 },
  { code: "REWORK", name_cn: "重工", name_en: "Rework", name_vi: "Làm lại", need_part: 0, sort_no: 60 },
  { code: "REWRITE", name_cn: "软件重刷", name_en: "Re-flash", name_vi: "Nạp lại phần mềm", need_part: 0, sort_no: 70 },
  { code: "SCRAP", name_cn: "报废", name_en: "Scrap", name_vi: "Phế phẩm", need_part: 0, sort_no: 90 },
];

export async function ensureSchema() {
  await query(`CREATE TABLE IF NOT EXISTS qlt_repair_detail (
    id bigserial PRIMARY KEY,
    repair_no text NOT NULL UNIQUE,
    sn text NOT NULL,
    mo_no text NOT NULL DEFAULT '',
    handover_no text NOT NULL DEFAULT '',
    defect_station text NOT NULL DEFAULT '',
    defect_code text NOT NULL DEFAULT '',
    defect_name text NOT NULL DEFAULT '',
    designator text NOT NULL DEFAULT '',
    defect_phenomenon text NOT NULL DEFAULT '',
    defect_qty integer NOT NULL DEFAULT 1,
    disposition text NOT NULL DEFAULT '',
    root_cause text NOT NULL DEFAULT '',
    photos text NOT NULL DEFAULT '',
    verify_source text NOT NULL DEFAULT '',
    verify_status text NOT NULL DEFAULT '',
    verify_ref text NOT NULL DEFAULT '',
    verify_by text NOT NULL DEFAULT '',
    verify_time text NOT NULL DEFAULT '',
    verify_reason text NOT NULL DEFAULT '',
    result text NOT NULL DEFAULT '',
    repair_by text NOT NULL DEFAULT '',
    repair_time text NOT NULL DEFAULT '',
    remark text NOT NULL DEFAULT '',
    created_at text NOT NULL DEFAULT '',
    updated_at text NOT NULL DEFAULT '');`);
  await query("CREATE INDEX IF NOT EXISTS idx_rd_sn ON qlt_repair_detail(sn)");
  await query("CREATE INDEX IF NOT EXISTS idx_rd_status ON qlt_repair_detail(verify_status)");
  await query("CREATE INDEX IF NOT EXISTS idx_rd_time ON qlt_repair_detail(repair_time)");

  await query(`CREATE TABLE IF NOT EXISTS qlt_repair_part (
    id bigserial PRIMARY KEY,
    repair_no text NOT NULL,
    sn text NOT NULL DEFAULT '',
    designator text NOT NULL DEFAULT '',
    material_code text NOT NULL DEFAULT '',
    material_name text NOT NULL DEFAULT '',
    batch_no text NOT NULL DEFAULT '',
    lot_no text NOT NULL DEFAULT '',
    dc_code text NOT NULL DEFAULT '',
    qty integer NOT NULL DEFAULT 1,
    maker text NOT NULL DEFAULT '',
    operator text NOT NULL DEFAULT '',
    remark text NOT NULL DEFAULT '',
    created_at text NOT NULL DEFAULT '');`);
  await query("CREATE INDEX IF NOT EXISTS idx_rp_no ON qlt_repair_part(repair_no)");
  await query("CREATE INDEX IF NOT EXISTS idx_rp_sn ON qlt_repair_part(sn)");
  await query("CREATE INDEX IF NOT EXISTS idx_rp_mat ON qlt_repair_part(material_code)");

  await query(`CREATE TABLE IF NOT EXISTS cfg_repair_disposition (
    id bigserial PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name_cn text NOT NULL DEFAULT '',
    name_en text NOT NULL DEFAULT '',
    name_vi text NOT NULL DEFAULT '',
    need_part integer NOT NULL DEFAULT 0,
    sort_no integer NOT NULL DEFAULT 0,
    status integer NOT NULL DEFAULT 1);`);
  const have = await query("SELECT id FROM cfg_repair_disposition LIMIT 1");
  if (!have.rows[0]) {
    for (const d of DEFAULT_DISPOSITIONS) {
      await query(`INSERT INTO cfg_repair_disposition (code,name_cn,name_en,name_vi,need_part,sort_no,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`, [d.code, d.name_cn, d.name_en, d.name_vi, d.need_part, d.sort_no, 1]);
    }
  }
}

const _SPLIT = /[,;，；、\s/]+/;
const _RANGE = /^([A-Za-z]+)(\d+)\s*[-~—–]\s*([A-Za-z]*)(\d+)$/;
const _POS_OK = /^[A-Za-z]{1,4}\d{1,4}$/;

export function posTokens(posRef) {
  const out = [];
  for (const part of (posRef || "").split(_SPLIT)) {
    const p = part.trim();
    if (!p) continue;
    const m = _RANGE.exec(p);
    if (m) {
      const p1 = m[1].toUpperCase(), n1 = parseInt(m[2], 10);
      const p2 = (m[3] || m[1]).toUpperCase(), n2 = parseInt(m[4], 10);
      if (p1 === p2 && n2 - n1 >= 0 && n2 - n1 <= 200) {
        for (let i = n1; i <= n2; i++) out.push(`${p1}${i}`);
        continue;
      }
    }
    if (_POS_OK.test(p)) out.push(p.toUpperCase());
  }
  return out;
}

export function posMatch(posRef, want) {
  const w = (want || "").trim().toUpperCase();
  if (!w) return false;
  return posTokens(posRef).includes(w);
}

export async function codesOf(sn) {
  try {
    const rels = await query(
      `SELECT parent_sn, child_sn, rel_type, station FROM prd_sn_rel
       WHERE (parent_sn=$1 OR child_sn=$1) AND COALESCE(is_active,1)=1 ORDER BY id`, [sn]);
    const seen = new Set([sn]);
    const nxt = [];
    for (const r of rels.rows) {
      const rtype = (r.rel_type || "").trim();
      for (const x of [r.parent_sn, r.child_sn]) {
        if (x && x !== sn && !seen.has(x)) {
          seen.add(x);
          if (rtype === "PCBA_Link") nxt.push(x);
        }
      }
    }
    let frontier = nxt;
    while (frontier.length) {
      const nextRound = [];
      const ph = frontier.map((_, i) => `$${i + 1}`).join(",");
      const rs = await query(
        `SELECT parent_sn, child_sn, rel_type FROM prd_sn_rel
         WHERE (parent_sn IN (${ph}) OR child_sn IN (${ph})) AND COALESCE(is_active,1)=1 ORDER BY id`,
        [...frontier, ...frontier]);
      for (const r of rs.rows) {
        const rtype = (r.rel_type || "").trim();
        for (const x of [r.parent_sn, r.child_sn]) {
          if (x && x !== sn && !seen.has(x)) {
            seen.add(x);
            if (rtype === "PCBA_Link") nextRound.push(x);
          }
        }
      }
      frontier = nextRound;
    }
    return [...seen];
  } catch { return [sn]; }
}

export async function phenomena(keyword = "", limit = 200) {
  const kw = (keyword || "").trim();
  const out = [];
  const seen = new Set();
  let sql = `SELECT defect_code, name_cn, name_en, name_vi, category FROM md_defect`;
  const args = [];
  if (kw) {
    sql += ` WHERE defect_code ILIKE $${args.length + 1} OR name_cn ILIKE $${args.length + 2} OR name_en ILIKE $${args.length + 3}`;
    args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  sql += ` ORDER BY defect_code LIMIT $${args.length + 1}`;
  args.push(limit);
  for (const r of (await query(sql, args)).rows) {
    const key = (r.name_cn || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ code: r.defect_code, name: r.name_cn, name_en: r.name_en || "", name_vi: r.name_vi || "", category: r.category || "", from: "字典" });
  }
  for (const r of (await query(
    `SELECT defect_phenomenon AS p, COUNT(*) AS n FROM qlt_repair_detail
     WHERE COALESCE(defect_phenomenon,'')<>'' GROUP BY defect_phenomenon ORDER BY n DESC LIMIT 30`)).rows) {
    const p = (r.p || "").trim();
    if (!p || seen.has(p) || (kw && !p.includes(kw))) continue;
    seen.add(p);
    out.push({ code: "", name: p, name_en: "", name_vi: "", category: "", from: "手填" });
  }
  return out;
}

export async function dispositions() {
  return (await query(
    `SELECT code,name_cn,name_en,name_vi,need_part FROM cfg_repair_disposition WHERE status=1 ORDER BY sort_no, code`)).rows;
}

export async function dispositionOf(code) {
  const r = await query("SELECT * FROM cfg_repair_disposition WHERE code=$1", [code]);
  return r.rows[0] || null;
}

export function needPart(disp) {
  return Boolean(disp && parseInt(disp.need_part || 0) === 1);
}

export async function canRepair(sn) {
  sn = (sn || "").trim();
  const info = { sn, status: "", codes: sn ? [sn] : [], pending: [], openRepairs: [] };
  if (!sn) return { ok: false, reason: "请扫码或输入 SN", info };
  const base = await query("SELECT sn, status FROM prd_sn WHERE sn=$1", [sn]);
  info.codes = await codesOf(sn);
  if (!base.rows[0]) {
    return { ok: false, reason: `系统里没有 SN「${sn}」。请确认扫的是本厂条码，或该码还没开始生产`, info };
  }
  const status = (base.rows[0].status || "").trim();
  info.status = status;
  if (DEAD_STATUS.includes(status)) {
    const released = await _isReleased(sn);
    if (!released) {
      return { ok: false, reason: `SN ${sn} 当前状态是「${status}」，属于不可维修件（关键工位 NG 终态）。确需返修请先走「解报废审批」`, info };
    }
    info.release = true;
  }
  if ((status || "").toLowerCase() === "已发号") {
    return { ok: false, reason: `SN ${sn} 还没开始生产（状态「${status}」），没有不良可修。请先过首站再判断`, info };
  }
  info.pending = await pendingDefects(sn);
  info.openRepairs = await openRepairs(sn);
  if (info.openRepairs.length) {
    const o = info.openRepairs[0];
    return { ok: false, reason: `SN ${sn} 已有维修单 ${o.repair_no}（${o.verify_source} / ${o.verify_status}）还没判完，不能重复开单。请等它判完，或在该单上补充`, info };
  }
  if (info.pending.length) return { ok: true, reason: "", info };
  if (status === "待修") return { ok: true, reason: "", info };
  return { ok: false, reason: `SN ${sn} 是良品（状态「${status || "未知"}」，没有待处理的不良记录），不需要维修。如果这块板确实有问题，请先在过站台判 NG 登记不良，再来维修`, info };
}

export async function pendingDefects(sn) {
  const codes = await codesOf(sn);
  const ph = codes.map((_, i) => `$${i + 1}`).join(",");
  return (await query(
    `SELECT id, sn, defect_code, station_code, process_code, handle, defect_time FROM prd_defect_rec
     WHERE sn IN (${ph}) AND COALESCE(handle,'')=$${codes.length + 1} ORDER BY id`, [...codes, PENDING_HANDLE])).rows;
}

export async function openRepairs(sn) {
  const codes = await codesOf(sn);
  const ph = codes.map((_, i) => `$${i + 1}`).join(",");
  return (await query(
    `SELECT repair_no, sn, verify_source, verify_status, created_at FROM qlt_repair_detail
     WHERE sn IN (${ph}) AND verify_status IN ($${codes.length + 1}, $${codes.length + 2}) ORDER BY id`,
    [...codes, V_WAIT_ATE, V_WAIT_CHECK])).rows;
}

export function nextRepairNo() {
  const now = new Date();
  const d = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
  return "RP" + d;
}

export async function nextNoWithPrefix(pre) {
  const r = await query(
    `SELECT repair_no FROM qlt_repair_detail WHERE repair_no LIKE $1 ORDER BY repair_no DESC LIMIT 1`, [pre + "%"]);
  let n = 1;
  const row = r.rows[0];
  if (row && row.repair_no) {
    const m = /(\d{3})$/.exec(String(row.repair_no));
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `${pre}${String(n).padStart(3, "0")}`;
}

async function _isReleased(sn) {
  try {
    const r = await query("SELECT id FROM qlt_scrap_release WHERE sn=$1 AND status='已批准' AND consumed=0 LIMIT 1", [sn]);
    return Boolean(r.rows[0]);
  } catch { return false; }
}

/** 新建维修明细。必填：sn、repair_by、defect_phenomenon（或 defect_code）、disposition
 * 换件（need_part=1）时必须至少带一条 parts。返回 {detail, err} */
export async function createDetail(d) {
  const sn = (d.sn || "").trim();
  if (!sn) return { err: "请扫码或输入 SN" };

  const ok = await canRepair(sn);
  if (!ok.ok) return { err: ok.reason };

  if (!(d.repair_by || "").trim()) return { err: "请填写维修员工号/姓名" };

  const disp = (d.disposition || "").trim();
  if (!disp) return { err: "请选择处置方式" };
  const dj = await dispositionOf(disp);
  if (!dj) return { err: `处置方式不存在：${disp}` };

  const code = (d.defect_code || "").trim();
  let phen = (d.defect_phenomenon || "").trim();
  if (code) {
    const md = await query("SELECT defect_code, name_cn FROM md_defect WHERE defect_code=$1", [code]);
    if (md.rows[0]) {
      d.defect_name = md.rows[0].name_cn || "";
      if (!phen) phen = md.rows[0].name_cn || "";
    }
  }
  if (!phen) return { err: "请填写不良现象（或从字典选择不良代码）" };

  const parts = d.parts || [];
  if (!needPart(dj)) {
    parts = []; // 补锡/清洗等不换料，丢弃前端带的换料草稿
  } else if (!parts.length) {
    return { err: `处置方式为「${dj.name_cn}」，请至少登记一条换料（料号 + 批次 + 周期）` };
  }

  for (const p of parts) {
    if (!(p.material_code || "").trim()) return { err: "换料记录缺少料号" };
    if (!(p.dc_code || "").trim()) return { err: "换料记录缺少 Date Code（周期）" };
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const pre = nextRepairNo();
  const no = await nextNoWithPrefix(pre);

  const vs = (d.verify_source || "").trim() || VS_ATE;
  let status;
  if ((disp || "").toUpperCase() === "SCRAP") {
    vs = "";
    status = V_WAIT_SCRAP;
  } else {
    if (vs !== VS_ATE && vs !== VS_MANUAL) return { err: `验证方式只能是「${VS_ATE}」或「${VS_MANUAL}」` };
    if (vs === VS_MANUAL && !(d.verify_reason || "").trim()) return { err: "人工判定必须填写判定依据" };
    status = vs === VS_ATE ? V_WAIT_ATE : V_WAIT_CHECK;
  }

  const photos = Array.isArray(d.photos) ? d.photos : (d.photos || "").toString().split(",").filter(Boolean);

  await query(
    `INSERT INTO qlt_repair_detail (repair_no,sn,mo_no,handover_no,defect_station,defect_code,defect_name,
       designator,defect_phenomenon,defect_qty,disposition,root_cause,photos,verify_source,verify_status,
       verify_reason,repair_by,repair_time,remark,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)`,
    [no, sn, (d.mo_no || "").trim(), (d.handover_no || "").trim(), (d.defect_station || "").trim(),
     code, d.defect_name || "", (d.designator || "").trim(), phen, parseInt(d.defect_qty || 1),
     disp, (d.root_cause || "").trim(), JSON.stringify(photos), vs, status,
     (d.verify_reason || "").trim(), d.repair_by.trim(), now, (d.remark || "").trim(), now],
  );

  for (const p of parts) {
    await addPart(no, p, d.repair_by);
  }

  await markSnRepairing(sn, now);
  if (status === V_WAIT_SCRAP) {
    try {
      const codes = await codesOf(sn);
      const ph = codes.map((_, i) => `$${i + 1}`).join(",");
      await query(`UPDATE prd_sn SET status=$1, updated_at=$2 WHERE sn IN (${ph})`,
        [...codes, V_WAIT_SCRAP, now]);
    } catch { /* best effort */ }
  }

  return { detail: await getDetail(no) };
}

export async function addPart(repairNo, p, operator = "") {
  const code = (p.material_code || "").trim();
  if (!code) return null;
  let name = p.material_name || "", maker = p.maker || "";
  if (!name || !maker) {
    const md = await query("SELECT material_name, maker FROM md_material WHERE material_code=$1 LIMIT 1", [code]);
    if (md.rows[0]) {
      name = name || md.rows[0].material_name || "";
      maker = maker || md.rows[0].maker || "";
    }
  }
  await query(
    `INSERT INTO qlt_repair_part (repair_no,sn,designator,material_code,material_name,batch_no,lot_no,dc_code,qty,maker,operator,remark,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [repairNo, (p.sn || "").trim(), (p.designator || "").trim(), code, name,
     (p.batch_no || "").trim(), (p.lot_no || "").trim(), (p.dc_code || "").trim(),
     parseInt(p.qty || 1), maker, operator || (p.operator || ""), (p.remark || "").trim(), new Date().toISOString().slice(0, 19).replace("T", " ")],
  );
  return true;
}

const _photosOf = (txt) => {
  try { const v = JSON.parse(txt || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};

export async function getDetail(repairNo) {
  const r = await query("SELECT * FROM qlt_repair_detail WHERE repair_no=$1", [repairNo]);
  if (!r.rows[0]) return null;
  const d = { ...r.rows[0] };
  d.photo_list = _photosOf(d.photos);
  d.parts = (await query("SELECT * FROM qlt_repair_part WHERE repair_no=$1 ORDER BY id", [repairNo])).rows;
  const dj = await dispositionOf(d.disposition);
  d.disposition_name = (dj || {}).name_cn || d.disposition || "";
  d.need_part = Boolean(dj && parseInt(dj.need_part || 0) === 1);
  return d;
}

export async function listBySn(sn, limit = 50) {
  const rows = (await query("SELECT * FROM qlt_repair_detail WHERE sn=$1 ORDER BY id DESC LIMIT $2", [sn, limit])).rows;
  const out = [];
  for (const r of rows) {
    const d = { ...r };
    d.photo_list = _photosOf(d.photos);
    d.parts = (await query("SELECT * FROM qlt_repair_part WHERE repair_no=$1 ORDER BY id", [d.repair_no])).rows;
    const dj = await dispositionOf(d.disposition);
    d.disposition_name = (dj || {}).name_cn || "";
    out.push(d);
  }
  return out;
}

/** 扫一个 SN，返回维修员看的一屏全部信息 */
export async function snContext(sn) {
  sn = (sn || "").trim();
  const base = await query(
    `SELECT s.sn, s.sn_type, s.product_code, s.mo_no, s.status, s.cur_station, s.repair_times,
            s.box_no, s.pallet_no,
            COALESCE((SELECT product_model FROM md_product WHERE product_code=s.product_code LIMIT 1), '') AS product_model,
            COALESCE((SELECT product_name FROM md_product WHERE product_code=s.product_code LIMIT 1), '') AS product_name
     FROM prd_sn s WHERE s.sn=$1`, [sn],
  );
  const defects = (await query(
    `SELECT d.id, d.defect_code,
            COALESCE(m.name_cn,'') AS defect_name, COALESCE(m.description,'') AS defect_desc,
            COALESCE(m.category,'') AS category, COALESCE(m.is_terminal,0) AS is_terminal,
            d.station_code, d.process_code, d.handle, d.defect_time,
            COALESCE(d.root_cause,'') AS root_cause,
            COALESCE(d.operator,'') AS operator, COALESCE(d.operator_no,'') AS operator_no
     FROM prd_defect_rec d LEFT JOIN md_defect m ON m.defect_code=d.defect_code
     WHERE d.sn=$1 ORDER BY d.id DESC LIMIT 20`, [sn],
  )).rows;
  for (const x of defects) {
    try {
      const md = await query(
        `SELECT machine_no, COALESCE(ng_info,'') AS ng_info, COALESCE(end_time,'') AS end_time
         FROM prd_machine_data WHERE sn=$1 AND COALESCE(station_code,'')=$2 ORDER BY id DESC LIMIT 1`,
        [sn, x.station_code || ""],
      );
      if (md.rows[0]) {
        x.machine_no = md.rows[0].machine_no || "";
        x.ng_info = md.rows[0].ng_info || "";
        x.machine_at = md.rows[0].end_time || "";
      }
    } catch { /* best effort */ }
  }
  const passes = (await query(
    `SELECT station_code, result, ng_code, pass_time FROM prd_pass WHERE sn=$1 ORDER BY pass_time DESC LIMIT 20`, [sn],
  )).rows;
  const hist = await listBySn(sn, 20);
  const ok = await canRepair(sn);
  return {
    sn,
    base: base.rows[0] || null,
    exists: Boolean(base.rows[0]),
    defects,
    defectsPending: defects.filter(x => (x.handle || "") === "" || (x.handle || "") === PENDING_HANDLE),
    passes,
    history: hist,
    repairTimes: hist.length,
    waitingVerify: hist.filter(x => x.verify_status === V_WAIT_ATE || x.verify_status === V_WAIT_CHECK),
    canRepair: ok.ok,
    blockReason: ok.reason,
    codes: ok.info.codes,
    pendingDefects: ok.info.pending,
    openRepairs: ok.info.openRepairs,
  };
}

/** 人工判定的复核：approve → PASS 回在制；reject → 判 NG */
export async function manualVerify(repairNo, approve, by, remark = "") {
  const d = await getDetail(repairNo);
  if (!d) return { err: `维修单不存在：${repairNo}` };
  if (d.verify_source !== VS_MANUAL) return { err: `该单是「${d.verify_source}」，请送 ATE 复测，不走人工复核` };
  if (d.verify_status !== V_WAIT_CHECK) return { err: `该单当前状态是「${d.verify_status}」，不需要复核` };
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (approve) {
    await query(
      `UPDATE qlt_repair_detail SET verify_status=$1, result='PASS', verify_by=$2, verify_time=$3,
       verify_reason=CASE WHEN $4<>'' THEN $5 ELSE verify_reason END, updated_at=$3 WHERE repair_no=$6`,
      [V_PASS, by, now, remark, remark, repairNo],
    );
    await backToWip(d.sn, now);
    return { detail: await getDetail(repairNo) };
  }
  await query(
    `UPDATE qlt_repair_detail SET verify_status=$1, result='NG', verify_by=$2, verify_time=$3,
     verify_reason=CASE WHEN $4<>'' THEN $5 ELSE verify_reason END, updated_at=$3 WHERE repair_no=$6`,
    [V_NG, by, now, remark, remark, repairNo],
  );
  return { detail: await getDetail(repairNo) };
}

/** 品质/主管判定「维修员建议报废」 */
export async function scrapVerify(repairNo, approve, by, remark = "") {
  const d = await getDetail(repairNo);
  if (!d) return { err: `维修单不存在：${repairNo}` };
  if (d.verify_status !== V_WAIT_SCRAP) return { err: `这张单当前是「${d.verify_status || "—"}」，不是待判废` };
  const sn = d.sn;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  if (!approve) {
    if (!(remark || "").trim()) return { err: "驳回要写原因（例如：还能修，请重新处理）" };
    await query(
      `UPDATE qlt_repair_detail SET verify_status=$1, verify_source=$2, verify_by=$3, verify_time=$4,
       verify_reason=$5, updated_at=$4 WHERE repair_no=$6`,
      [V_WAIT_ATE, VS_ATE, by, now, remark.trim(), repairNo],
    );
    try {
      const codes = await codesOf(sn);
      const ph = codes.map((_, i) => `$${i + 1}`).join(",");
      await query(`UPDATE prd_sn SET status=$1, updated_at=$2 WHERE sn IN (${ph})`, [...codes, "维修中", now]);
    } catch { /* best effort */ }
    return { detail: await getDetail(repairNo) };
  }

  const fb = `维修员建议报废：${d.defect_phenomenon || d.root_cause || ""}${remark ? "；" + remark : ""}`;
  try {
    await query(
      `INSERT INTO prd_scrap (sn,scrap_code,reason,station_code,mo_no,approved_by,scrap_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [sn, d.defect_code || "维修判废", fb.slice(0, 200), d.defect_station || "", d.mo_no || "", by, now],
    );
  } catch (e) {
    return { err: `写报废记录失败：${e.message}` };
  }
  try {
    const codes = await codesOf(sn);
    const ph = codes.map((_, i) => `$${i + 1}`).join(",");
    await query(`UPDATE prd_sn SET status=$1, updated_at=$2 WHERE sn IN (${ph})`, [...codes, "报废", now]);
    await query(`UPDATE prd_defect_rec SET handle='报废' WHERE sn IN (${ph}) AND COALESCE(handle,'') IN ('','待处理')`, codes);
  } catch { /* best effort */ }
  await query(
    `UPDATE qlt_repair_detail SET verify_status='已通过', result='SCRAP', verify_by=$1, verify_time=$2,
     verify_reason=$3, updated_at=$2 WHERE repair_no=$4`,
    [by, now, remark.trim() || "品质/主管同意报废", repairNo],
  );
  return { detail: await getDetail(repairNo) };
}

/** 「待复测」转人工判定（品质/主管操作） */
export async function toManual(repairNo, reason, by) {
  const d = await getDetail(repairNo);
  if (!d) return { err: `维修单不存在：${repairNo}` };
  if (d.verify_status !== V_WAIT_ATE) return { err: `只有「${V_WAIT_ATE}」的单可以转人工判定（当前：${d.verify_status || "—"}）` };
  if (!(reason || "").trim()) return { err: "请写转人工判定的原因" };
  await query(
    `UPDATE qlt_repair_detail SET verify_source=$1, verify_status=$2, verify_reason=$3, updated_at=$4 WHERE repair_no=$5`,
    [VS_MANUAL, V_WAIT_CHECK, reason.trim(), new Date().toISOString().slice(0, 19).replace("T", " "), repairNo],
  );
  return { detail: await getDetail(repairNo) };
}

/** ATE 复测结果回填：把该 SN 所有「待复测」的单判掉 */
export async function applyAteResult(sn, result, ref = "") {
  const ok = /^(ok|pass|good)$/i.test(String(result || ""));
  const rows = await query("SELECT repair_no FROM qlt_repair_detail WHERE sn=$1 AND verify_status=$2", [sn, V_WAIT_ATE]);
  if (!rows.rows[0]) return [];
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const out = [];
  for (const r of rows.rows) {
    await query(
      `UPDATE qlt_repair_detail SET verify_status=$1, result=$2, verify_ref=$3, verify_time=$4, updated_at=$4 WHERE repair_no=$5`,
      [ok ? V_PASS : V_NG, ok ? "PASS" : "NG", String(ref || ""), now, r.repair_no],
    );
    out.push(r.repair_no);
  }
  if (ok) await backToWip(sn, now);
  return out;
}

async function backToWip(sn, now) {
  try {
    const row = await query("SELECT status FROM prd_sn WHERE sn=$1", [sn]);
    if (row.rows[0] && DEAD_STATUS.includes(row.rows[0].status || "")) return;
    await query("UPDATE prd_sn SET status=$1, updated_at=$2 WHERE sn=$3", ["在制", now, sn]);
  } catch { /* best effort */ }
  try {
    const codes = await codesOf(sn);
    const ph = codes.map((_, i) => `$${i + 1}`).join(",");
    await query(`UPDATE prd_defect_rec SET handle='维修' WHERE sn IN (${ph}) AND COALESCE(handle,'')=$${codes.length + 1}`, [...codes, PENDING_HANDLE]);
  } catch { /* best effort */ }
}

async function markSnRepairing(sn, now) {
  try {
    const row = await query("SELECT status FROM prd_sn WHERE sn=$1", [sn]);
    if (row.rows[0] && !DEAD_STATUS.includes(row.rows[0].status || "")) {
      await query("UPDATE prd_sn SET status=$1, updated_at=$2 WHERE sn=$3", ["维修中", now, sn]);
    }
  } catch { /* best effort */ }
}

/** ── 解报废特批（qlt_scrap_release） ── */

/** 申请解报废：同一 SN 同一 status=待批准 的记录只有一张（幂等） */
export async function scrapReleaseApply(sn, reason, applyBy) {
  sn = (sn || "").trim();
  reason = (reason || "").trim();
  if (!sn) return { err: "缺少 SN" };
  if (!reason) return { err: "请填申请原因（品质评估结论）" };
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const base = await query("SELECT sn, status FROM prd_sn WHERE sn=$1", [sn]);
  if (!base.rows[0]) return { err: "系统里没有该 SN" };
  const status = (base.rows[0].status || "").trim();
  if (!DEAD_STATUS.includes(status)) return { err: `SN ${sn} 当前是「${status}」，不是报废件，无需解报废` };
  const cur = await query("SELECT * FROM qlt_scrap_release WHERE sn=$1 AND status='待批准' ORDER BY id DESC LIMIT 1", [sn]);
  if (cur.rows[0]) {
    return { existed: true, release_no: cur.rows[0].sn ? `REL-${cur.rows[0].id.toString().padStart(6, '0')}` : `REL-000001`, status: cur.rows[0].status };
  }
  const ins = await query(`INSERT INTO qlt_scrap_release (sn, station_code, defect_code, reason, status, created_by, created_at, consumed)
    VALUES ($1,'','',$2,'待批准',$3,$4,0) RETURNING id`, [sn, reason, applyBy || "", now]);
  const releaseNo = `REL-${String(ins.rows[0].id).padStart(6, '0')}`;
  return { existed: false, release_no: releaseNo, status: "待批准" };
}

/** 批准/驳回解报废 */
export async function scrapReleaseApprove(releaseNo, approvedBy, approve, remark = "") {
  const r = await query("SELECT * FROM qlt_scrap_release WHERE sn=$1 ORDER BY id DESC LIMIT 1", [releaseNo]);
  if (!r.rows[0]) return { err: "解报废单不存在" };
  const row = r.rows[0];
  const st = row.status;
  if (st === "已使用") return { err: "该解报废单已使用，不能再批准" };
  if (st !== "待批准") return { err: `该解报废单已是「${st}` };
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (approve) {
    await query("UPDATE qlt_scrap_release SET status='已批准', approved_by=$1, approved_at=$2 WHERE id=$3",
      [approvedBy || "", now, row.id]);
  } else {
    await query("UPDATE qlt_scrap_release SET status='已拒绝', approved_by=$1, approved_at=$2, remark=$3 WHERE id=$4",
      [approvedBy || "", now, remark, row.id]);
  }
  return { release_no: row.sn ? `REL-${String(row.id).padStart(6, '0')}` : `REL-000001`, status: approve ? "已批准" : "已拒绝" };
}

/** 查解报废列表 */
export async function scrapReleaseList(status, sn, size) {
  const args = [], conds = [];
  if (status) { conds.push(`status=$${args.length + 1}`); args.push(status); }
  if (sn) { conds.push(`sn=$${args.length + 1}`); args.push(sn); }
  const sql = `SELECT id,sn,station_code,defect_code,reason,status,approved_by,approved_at,created_by,created_at,consumed FROM qlt_scrap_release${conds.length ? " WHERE " + conds.join(" AND ") : ""} ORDER BY id DESC LIMIT $${args.length + 1}`;
  args.push(Number(size || 100));
  return (await query(sql, args)).rows;
}

/** 查某个 SN 的解报废记录（最近一张） */
export async function scrapReleaseOne(sn) {
  const r = await query("SELECT id,sn,station_code,defect_code,reason,status,approved_by,approved_at,created_by,created_at,consumed FROM qlt_scrap_release WHERE sn=$1 ORDER BY id DESC LIMIT 1", [sn]);
  return r.rows[0] || null;
}

/** 维修登记「已修复」时把该 SN 解报废单标记为已使用（一次性） */
export async function scrapReleaseConsume(sn, by) {
  sn = (sn || "").trim();
  const r = await query("SELECT * FROM qlt_scrap_release WHERE sn=$1 AND status='已批准' AND consumed=0 ORDER BY id DESC LIMIT 1", [sn]);
  if (!r.rows[0]) return;
  await query("UPDATE qlt_scrap_release SET consumed=1 WHERE id=$1", [r.rows[0].id]);
}

/** 查某个 SN 是否已解报废并未使用 */
export async function scrapReleaseIsReleased(sn) {
  sn = (sn || "").trim();
  const r = await query("SELECT * FROM qlt_scrap_release WHERE sn=$1 AND status='已批准' AND consumed=0 ORDER BY id DESC LIMIT 1", [sn]);
  return Boolean(r.rows[0]);
}

/** 供域层 canRepair 调用的别名 */
export const isReleased = scrapReleaseIsReleased;
