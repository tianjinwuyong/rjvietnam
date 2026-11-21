/**
 * W12 面板/分板逻辑 —— 源 api/panel.py (37-727) + 部分 api/exec.py 依赖的 helpers
 * 关键转换：SQLite -> PG (ILIKE, timestamptz, bigserial)
 * 依赖：domain.js 里的 doPassInner, ensureMoRoute, step_of, guard_open_ng
 */
import { query, getParam, setParam } from "../db.js";
import { doPassInner, ensureMoRoute, step_of, guard_open_ng } from "./domain.js";

/** 解析 SN：取最后一段连续数字当流水号，保留位宽用于拼回 */
export function parseSn(sn) {
  sn = (sn || "").trim();
  if (!sn) return null;
  const matches = [...sn.matchAll(/(\d+)/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const digits = last[1];
  return {
    prefix: sn.slice(0, last.index),
    num: parseInt(digits, 10),
    suffix: sn.slice(last.index + digits.length),
    width: digits.length,
  };
}

/** 按原位宽拼回 SN：width=5 时 6 -> '00006' */
export function joinSn(prefix, num, suffix, width = 0) {
  const s = String(num);
  const padded = width > s.length ? "0".repeat(width - s.length) + s : s;
  return `${prefix}${padded}${suffix}`;
}

/** 蛇形走位：给定行列生成面板内所有位置的 (row, col) */
function* serpentinePositions(rows, cols) {
  for (let r = 1; r <= rows; r++) {
    const colsArr = r % 2 === 1
      ? [...Array(cols).keys()].map(i => i + 1)
      : [...Array(cols).keys()].reverse().map(i => i + 1);
    for (const c of colsArr) yield { row: r, col: c };
  }
}

/** 把索引（1-based）转成 (row, col)，考虑 serpentine 与 seq_offset */
export function posOfIndex(index, layout) {
  const { rows, cols, serpentine, seq_offset = 0 } = layout;
  const total = rows * cols;
  if (index < 1 || index > total) return null;
  let i = index - 1 + (seq_offset || 0);
  i = ((i % total) + total) % total; // 循环
  if (!serpentine) {
    const r = Math.floor(i / cols) + 1;
    const c = (i % cols) + 1;
    return { row: r, col: c };
  }
  let cnt = 0;
  for (const p of serpentinePositions(rows, cols)) {
    if (cnt === i) return p;
    cnt++;
  }
  return null;
}

/** 给定 prefix/num/suffix/width + layout，生成整版所有子板 SN */
export function panelSns(baseSn, layout) {
  const p = parseSn(baseSn);
  if (!p) return [];
  const { prefix, num, suffix, width } = p;
  const { rows, cols, total } = layout;
  const out = [];
  for (let i = 1; i <= total; i++) {
    const pos = posOfIndex(i, layout);
    if (!pos) continue;
    const sn = joinSn(prefix, num + i - 1, suffix, width);
    out.push({ sn, panel_pos: `${pos.row}-${pos.col}`, row: pos.row, col: pos.col });
  }
  return out;
}

/** 判断工位是否属于该工单路线（分板属于组装段 P03） */
export async function judgeSlot(moNo, stationCode) {
  if (!moNo || !stationCode) return { ok: true }; // 不强拦
  const [steps] = await ensureMoRoute(moNo);
  if (!steps || !steps.length) return { ok: true };
  if (!step_of(steps, stationCode)) {
    const mo = await query("SELECT process_code FROM ord_mo WHERE mo_no=$1", [moNo]);
    const pn = { "01": "SMT", "02": "DIP", "03": "组装", "04": "包装" }[mo.rows[0]?.process_code || ""] || "";
    return {
      ok: false,
      msg: `工单 ${moNo} 是${pn}工序单，这里面没有「${stationCode}」这一站。分板属于组装段，请在上方工单下拉里换成组装段（P03）的工单再扫`,
    };
  }
  return { ok: true };
}

/** 解析工单下拉可见的面板布局 */
export async function listLayouts() {
  return query("SELECT * FROM cfg_panel_layout WHERE enabled=1 ORDER BY id");
}

/** 保存/新建面板布局：机型唯一 + 产品编码自动补齐（唯一才补） */
export async function saveLayout(d) {
  const id = d.id;
  const cols = parseInt(d.cols || 0);
  const rows = parseInt(d.rows || 0);
  const model = (d.model || "").trim();
  if (!model || cols <= 0 || rows <= 0) {
    throw new Error("机型、列数、行数必填且需大于 0");
  }
  let pc = (d.product_code || "").trim();
  if (!pc) {
    const sql = `SELECT product_code FROM md_product WHERE status=1 AND product_model=$1
                 AND COALESCE(NULLIF(product_type,''),'FG')='FG'`;
    const codes = (await query(sql, [model])).rows.map(r => r.product_code);
    if (codes.length === 1) pc = codes[0];
  }
  const serpentine = d.serpentine ? 1 : 0;
  const seq_offset = parseInt(d.seq_offset || 0);
  const total = rows * cols;
  const enabled = d.enabled ? 1 : 0;
  const remark = (d.remark || "").trim();

  if (id) {
    await query(
      `UPDATE cfg_panel_layout SET cols=$1, rows=$2, product_code=$3, serpentine=$4,
       seq_offset=$5, total=$6, enabled=$7, remark=$8
       WHERE id=$9`,
      [cols, rows, pc, serpentine, seq_offset, total, enabled, remark, id],
    );
    return { id };
  } else {
    const r = await query(
      `INSERT INTO cfg_panel_layout (model, cols, rows, product_code, serpentine,
       seq_offset, total, enabled, remark, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) RETURNING id`,
      [model, cols, rows, pc, serpentine, seq_offset, total, enabled, remark],
    );
    return { id: r.rows[0].id };
  }
}

/** 删除布局（软删除：enabled=0） */
export async function deleteLayout(id) {
  await query("UPDATE cfg_panel_layout SET enabled=0 WHERE id=$1", [id]);
  return { ok: true };
}

/** 匹配面板布局：优先 product_code，其次 model；启用且行列匹配 */
async function matchLayout(productCode, model) {
  let sql = `SELECT * FROM cfg_panel_layout WHERE enabled=1`;
  const args = [];
  if (productCode) {
    sql += ` AND product_code=$${args.length + 1}`;
    args.push(productCode);
  } else if (model) {
    sql += ` AND model=$${args.length + 1}`;
    args.push(model);
  }
  sql += ` ORDER BY id`;
  const rows = (await query(sql, args)).rows;
  if (!rows.length) return null;
  // 精确匹配行列的第一条
  return rows[0];
}

/** 老化计算：从 prd_pass 取首站时间到现在的小时数 */
export async function agingOf(sn) {
  const r = await query(
    `SELECT MIN(pass_time) AS first_time FROM prd_pass WHERE sn=$1`, [sn],
  );
  const ft = r.rows[0]?.first_time;
  if (!ft) return { hours: 0, first_time: null };
  const diffMs = Date.now() - new Date(ft).getTime();
  return { hours: Math.round(diffMs / 36e5 * 10) / 10, first_time: ft };
}

/** 构建面板视图：主板 SN + 子板数组 + 可选 AOI 数据 */
export async function buildView(sn, layoutId) {
  const base = await query("SELECT * FROM prd_sn WHERE sn=$1", [sn]);
  if (!base.rows[0]) return null;
  const s = base.rows[0];
  const layout = layoutId
    ? (await query("SELECT * FROM cfg_panel_layout WHERE id=$1", [layoutId])).rows[0]
    : await matchLayout(s.product_code, "");
  if (!layout) return { base: s, layout: null, slots: [], aoi: null };
  const slots = panelSns(sn, layout);
  // AOI 数据：通过 prd_sn_rel 找子板
  let aoi = null;
  const rels = await query(
    `SELECT parent_sn, child_sn FROM prd_sn_rel WHERE parent_sn=$1 AND rel_type='PANEL_SPLIT'`, [sn],
  );
  if (rels.rows.length) {
    const childSns = rels.rows.map(r => r.child_sn);
    const ph = childSns.map((_, i) => `$${i + 1}`).join(",");
    const aoiRows = await query(
      `SELECT pcb_sn, test_time, project_name, device_name, track_line, board_side,
              robot_result, user_result, final_result, board_number, board_ng_number,
              comp_number, comp_ng_number, file_name
       FROM prd_aoi_result WHERE pcb_sn IN (${ph})`, childSns,
    );
    aoi = aoiRows.rows;
  }
  return { base: s, layout, slots, aoi };
}

/** 解析下一站：工单路线里的下一步工位 */
export async function resolveNext(moNo, curStation) {
  const [steps] = await ensureMoRoute(moNo);
  if (!steps || !steps.length) return null;
  let idx = steps.findIndex(s => s.station_code === curStation);
  if (idx === -1) idx = 0;
  return steps[idx + 1] || null;
}

/** 对齐布局：用 AOI 板号 + 子板关系反推正确的布局（fail-fast，不猜） */
export async function alignLayout(sn) {
  const base = await query("SELECT product_code FROM prd_sn WHERE sn=$1", [sn]);
  if (!base.rows[0]) return null;
  // 找该板对应的 AOI 记录
  const rels = await query(
    `SELECT child_sn FROM prd_sn_rel WHERE parent_sn=$1 AND rel_type='PANEL_SPLIT'`, [sn],
  );
  if (!rels.rows.length) return null;
  const childSns = rels.rows.map(r => r.child_sn);
  const ph = childSns.map((_, i) => `$${i + 1}`).join(",");
  const boardRows = await query(
    `SELECT DISTINCT board_no FROM prd_aoi_board WHERE pcb_sn IN (${ph})`, childSns,
  );
  const boardNums = [...new Set(boardRows.rows.map(r => r.board_no).filter(Boolean))];
  if (!boardNums.length) return null;
  // 用板号去 cfg_panel_layout 找 total 匹配的
  const layouts = await query(
    `SELECT * FROM cfg_panel_layout WHERE enabled=1 AND product_code=$1 ORDER BY id`, [base.rows[0].product_code],
  );
  for (const l of layouts.rows) {
    if (l.total === boardNums.length) return l;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// 内部：系统判定 —— 源 panel.py _norm_result / _latest_test / _judge_slot
// ════════════════════════════════════════════════════════════════════════════

function _normResult(v) {
  const u = (v || "").trim().toUpperCase();
  if (["NG", "FAIL", "FALSE", "不良"].includes(u)) return "NG";
  if (["OK", "PASS", "TRUE", "合格"].includes(u)) return "OK";
  return "";
}

async function _latestTest(sn, keywords) {
  const cands = [];
  for (const kw of keywords) {
    const like = "%" + kw + "%";
    const r1 = await query(
      "SELECT station_code AS st, result AS r, pass_time AS t FROM prd_pass WHERE sn=$1 AND station_code LIKE $2 ORDER BY id DESC LIMIT 1",
      [sn, like]);
    if (r1.rows[0]) cands.push(r1.rows[0]);
    const r2 = await query(
      "SELECT station_code AS st, pass_ng AS r, created_at AS t FROM prd_machine_data WHERE sn=$1 AND station_code LIKE $2 ORDER BY id DESC LIMIT 1",
      [sn, like]);
    if (r2.rows[0]) cands.push(r2.rows[0]);
  }
  if (!cands.length) return null;
  cands.sort((a, b) => new Date(b.t || 0).getTime() - new Date(a.t || 0).getTime());
  const c = cands[0];
  return { result: _normResult(c.r), station: c.st || "", time: c.t || "" };
}

async function _judgeSlotByTest(sn) {
  const ict = await _latestTest(sn, ["ICT"]);
  const fct = await _latestTest(sn, ["FCT"]);
  const ir = (ict || {}).result || "";
  const fr = (fct || {}).result || "";
  let judge;
  if (ir === "NG" && fr === "NG") judge = "BOTH_NG";
  else if (ir === "NG") judge = "ICT_NG";
  else if (fr === "NG") judge = "FCT_NG";
  else if (ir === "OK" || fr === "OK") judge = "OK";
  else judge = "NONE";
  return {
    ict_result: ir, fct_result: fr,
    ict_station: (ict || {}).station || "", fct_station: (fct || {}).station || "",
    judge,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 内部：记录探测 —— 源 panel.py _records_near / _detect_base_by_records
// ════════════════════════════════════════════════════════════════════════════

async function _recordsNear(num, total, prefix, suffix, width = 0) {
  const cands = [];
  for (let n = num - total + 1; n < num + total; n++) {
    cands.push(joinSn(prefix, n, suffix, width));
  }
  const ph = cands.map((_, i) => `$${i + 1}`).join(",");
  let rows;
  try {
    const r = await query(
      `SELECT DISTINCT sn FROM prd_pass WHERE sn IN (${ph})
       UNION SELECT DISTINCT sn FROM prd_machine_data WHERE sn IN (${ph})
       UNION SELECT DISTINCT board_sn FROM prd_aoi_board WHERE board_sn IN (${ph})`,
      [...cands, ...cands, ...cands]);
    rows = r.rows;
  } catch {
    try {
      const r = await query(
        `SELECT DISTINCT sn FROM prd_pass WHERE sn IN (${ph})
         UNION SELECT DISTINCT sn FROM prd_machine_data WHERE sn IN (${ph})`,
        [...cands, ...cands]);
      rows = r.rows;
    } catch {
      return new Set();
    }
  }
  const have = new Set();
  for (const r of rows) {
    const p = parseSn(r.sn);
    if (p) have.add(p.num);
  }
  return have;
}

async function _detectBaseByRecords(anchorSn, total, cfgOffset = null) {
  const p = parseSn(anchorSn);
  if (!p) return null;
  const { prefix, num, suffix, width } = p;
  const have = await _recordsNear(num, total, prefix, suffix, width);

  if (cfgOffset != null && cfgOffset !== "") {
    try {
      const off = (num - parseInt(cfgOffset, 10)) % total;
      const base = num - off;
      let allPresent = true;
      for (let i = 0; i < total; i++) {
        if (!have.has(base + i)) { allPresent = false; break; }
      }
      if (allPresent) return base;
    } catch { /* fall through to scan */ }
  }

  for (let base = num - total + 1; base <= num; base++) {
    let allPresent = true;
    for (let i = 0; i < total; i++) {
      if (!have.has(base + i)) { allPresent = false; break; }
    }
    if (allPresent) return base;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// 内部：维修/工站简讯 —— 源 panel.py _is_repair / _st_brief / _resolve_next
// ════════════════════════════════════════════════════════════════════════════

function _isRepair(code, name = "") {
  const u = ((code || "") + " " + (name || "")).toUpperCase();
  return u.includes("REPAIR") || u.includes("维修") || u.includes("SỬA");
}

async function _stBrief(code) {
  if (!code) return null;
  const r = await query("SELECT station_code, station_name FROM md_station WHERE station_code=$1", [code]);
  if (!r.rows[0]) return null;
  return { code: r.rows[0].station_code, name: r.rows[0].station_name || r.rows[0].station_code };
}

async function _resolveNext(split) {
  const st = (split.station_code || "");
  let passNext = await _stBrief(await getParam("panel.next." + st, ""));
  let ngNext = await _stBrief(await getParam("panel.ngnext." + st, ""));
  if (passNext && ngNext) return { passNext, ngNext };

  const moNo = (split.mo_no || "");
  if (moNo) {
    try {
      const [steps] = await ensureMoRoute(moNo, split.product_code || "");
      if (steps.length) {
        const cur = steps.find(s => s.station_code === st);
        if (cur) {
          const curSeq = Number(cur.seq_no || 0);
          const sorted = [...steps].sort((a, b) => Number(a.seq_no || 0) - Number(b.seq_no || 0));
          for (const s of sorted) {
            if (Number(s.seq_no || 0) <= curSeq) continue;
            const code = s.station_code, name = s.station_name || s.station_code;
            if (_isRepair(code, name)) {
              if (!ngNext) ngNext = { code, name };
              continue;
            }
            if (!passNext) passNext = { code, name };
            if (passNext && ngNext) break;
          }
        }
      }
      if (!ngNext) {
        for (const s of steps) {
          if (_isRepair(s.station_code, s.station_name || "")) {
            ngNext = { code: s.station_code, name: s.station_name || s.station_code };
            break;
          }
        }
      }
    } catch { /* steps = [] */ }
  }
  return { passNext: passNext || null, ngNext: ngNext || null };
}

// ════════════════════════════════════════════════════════════════════════════
// 内部：老化计算 —— 源 panel.py _aging_of
// ════════════════════════════════════════════════════════════════════════════

async function _agingOf(sns, limitHours = null) {
  if (limitHours == null) {
    try { limitHours = Number(await getParam("smt.pcb_unseal_hours", "168")) || 168; }
    catch { limitHours = 168; }
  }
  const out = {};
  const uniq = [...new Set(sns || [])].filter(Boolean);
  if (!uniq.length) return out;
  const now = new Date();
  for (let i = 0; i < uniq.length; i += 400) {
    const chunk = uniq.slice(i, i + 400);
    const ph = chunk.map((_, j) => `$${j + 1}`).join(",");
    try {
      const r = await query(
        `SELECT sn, MAX(pass_time) AS t FROM prd_pass
         WHERE sn IN (${ph}) AND result='OK'
           AND (COALESCE(process_code,'')='01' OR station_code LIKE 'SMT-%')
         GROUP BY sn`,
        chunk);
      for (const row of r.rows) {
        try {
          const t = new Date(String(row.t || "").slice(0, 19).replace(" ", "T") || 0);
          const h = (now - t) / 36e5;
          out[row.sn] = {
            smt_at: row.t,
            age_h: Math.round(h * 10) / 10,
            left_h: Math.round((limitHours - h) * 10) / 10,
            expired: h > limitHours,
          };
        } catch { continue; }
      }
    } catch { return out; }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 内部：整版视图 —— 源 panel.py _build_view
// ════════════════════════════════════════════════════════════════════════════

async function _buildView(split) {
  const cols = Number(split.cols || 1);
  const total = Number(split.total || 0);
  const serpentine = split.serpentine != null ? Number(split.serpentine) : 1;
  const base = split.seq_base;
  const slotsRows = await query("SELECT * FROM prd_panel_slot WHERE split_id=$1", [split.id]);
  const slotsDb = {};
  for (const s of slotsRows.rows) slotsDb[Number(s.slot_no)] = s;
  const anchorRow = await query("SELECT child_sn FROM prd_panel_slot WHERE split_id=$1 ORDER BY id LIMIT 1", [split.id]);
  const anchor = anchorRow.rows[0] || null;
  const calc = {};
  if (anchor && base != null) {
    const p = parseSn(anchor.child_sn);
    if (p) {
      const { prefix, suffix, width } = p;
      for (let i = 0; i < total; i++) {
        const pos = _posOfIndex0(i + 1, cols, serpentine);
        calc[pos] = joinSn(prefix, Number(base) + i, suffix, width);
      }
    }
  }
  const view = [];
  for (let pos = 1; pos <= total; pos++) {
    const s = slotsDb[pos];
    if (s) {
      view.push({
        slot_no: pos, sn: s.child_sn, scanned: true,
        ict_result: s.ict_result || "", fct_result: s.fct_result || "",
        judge: s.judge || "NONE", scanned_at: s.scanned_at || "",
      });
    } else {
      view.push({
        slot_no: pos, sn: calc[pos] || "", scanned: false,
        ict_result: "", fct_result: "", judge: "WAIT", scanned_at: "",
      });
    }
  }
  const ag = await _agingOf(view.filter(x => x.sn).map(x => x.sn));
  for (const x of view) {
    const a = ag[x.sn] || {};
    x.smt_at = a.smt_at || "";
    x.age_h = a.age_h;
    x.left_h = a.left_h;
    x.expired = Boolean(a.expired);
  }
  const sc = view.filter(x => x.scanned);
  const stats = {
    total, scanned: sc.length,
    ok: sc.filter(x => x.judge === "OK").length,
    ict_ng: sc.filter(x => x.judge === "ICT_NG" || x.judge === "BOTH_NG").length,
    fct_ng: sc.filter(x => x.judge === "FCT_NG" || x.judge === "BOTH_NG").length,
    both_ng: sc.filter(x => x.judge === "BOTH_NG").length,
    none: sc.filter(x => x.judge === "NONE").length,
    need_take: sc.filter(x => x.judge === "ICT_NG" || x.judge === "FCT_NG" || x.judge === "BOTH_NG").length,
  };
  return { view, stats };
}

// 0-based index → 1-based position（源 panel.py _pos_of_index）
function _posOfIndex0(idx, cols, serpentine) {
  const row = Math.floor(idx / cols);
  let col = idx % cols;
  if (serpentine && row % 2 === 1) col = cols - 1 - col;
  return row * cols + col + 1;
}

// ════════════════════════════════════════════════════════════════════════════
// AOI 整版带出 —— 源 panel.py panel_from_aoi / panel_sns_for
// ════════════════════════════════════════════════════════════════════════════

async function panelFromAoi(anchorSn, wantModel = "") {
  if (!anchorSn) return null;
  let rows;
  try {
    const r = await query(
      `SELECT b.aoi_id, b.board_sn, b.board_no, b.test_time, b.pcb_sn,
              r.device_name, r.project_name
       FROM prd_aoi_board b JOIN prd_aoi_result r ON r.id=b.aoi_id
       WHERE b.board_sn=$1 ORDER BY b.test_time DESC, b.id DESC LIMIT 60`,
      [anchorSn]);
    rows = r.rows;
  } catch { return null; }
  if (!rows.length) return null;

  let chosen = null;
  let firstOk = null;
  for (const r of rows) {
    const dev = (r.device_name || "").trim();
    if (dev.toUpperCase().startsWith("WS-")) continue;
    if (firstOk === null) firstOk = r;
    if (wantModel && r.project_name && String(r.project_name).includes(wantModel)) {
      chosen = r;
      break;
    }
  }
  if (chosen === null) chosen = firstOk;
  if (!chosen) return null;
  const row = chosen;

  let sibs;
  try {
    const r = await query(
      "SELECT board_sn, board_no FROM prd_aoi_board WHERE aoi_id=$1 AND COALESCE(board_sn,'')<>'' ORDER BY CAST(board_no AS INTEGER)",
      [row.aoi_id]);
    sibs = r.rows;
  } catch { return null; }
  const seen = new Set();
  const boards = [];
  for (const s of sibs) {
    const code = (s.board_sn || "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    boards.push({ sn: code, board_no: (s.board_no || "").trim() });
  }
  if (boards.length < 2) return null;

  const total = boards.length;
  const posOk = boards.every(b => /^\d+$/.test(b.board_no) && 1 <= Number(b.board_no) && Number(b.board_no) <= total);
  const out = [];
  for (let i = 0; i < boards.length; i++) {
    const b = boards[i];
    const pos = posOk ? Number(b.board_no) : (i + 1);
    out.push({ pos, idx: i, sn: b.sn, aoi_pos: pos });
  }
  out.sort((a, b) => a.pos - b.pos);

  const parsed = out.map(b => parseSn(b.sn));
  if (parsed.every(Boolean) && new Set(parsed.map(p => `${p.prefix}|${p.suffix}|${p.width}`)).size === 1) {
    out.sort((a, b) => parseSn(a.sn).num - parseSn(b.sn).num);
  }
  for (let i = 0; i < out.length; i++) {
    out[i].idx = i;
    out[i].pos = i + 1;
  }

  return {
    sns: out,
    device: (row.device_name || "").trim(),
    test_time: String(row.test_time || "").slice(0, 19),
    pcb_sn: (row.pcb_sn || "").trim(),
  };
}

async function panelSnsFor(moNo, anchorSn) {
  const { layout, info } = await resolveLayout(moNo);
  if (!layout) {
    return { sns: null, layout: null, base: null, info: { source: "", warn: info.warn, model: info.model || "" } };
  }
  const want = info.model || "";
  const lay = { ...layout };

  const aoi = await panelFromAoi(anchorSn, want);
  const total = Number(lay.total || 0);
  if (aoi && !(total && aoi.sns.length < Math.max(2, Math.floor(total * 0.6)))) {
    return {
      sns: aoi.sns, layout: lay, base: null,
      info: { source: "aoi", device: aoi.device, test_time: aoi.test_time, model: want, warn: "" },
    };
  }

  const p = parseSn(anchorSn);
  let base = null;
  if (p) {
    base = await _detectBaseByRecords(anchorSn, total, lay.seq_offset);
  }
  const lay2 = { ...lay };
  if (base != null) {
    lay2.seq_offset = base % total;
  }
  const sns = [];
  if (p && base != null) {
    for (let i = 0; i < total; i++) {
      const pos = _posOfIndex0(i, lay2.cols, lay2.serpentine);
      sns.push({ pos, idx: i, sn: joinSn(p.prefix, base + i, p.suffix, p.width) });
    }
  }
  return {
    sns, layout: lay2, base,
    info: { source: "calc", device: "", test_time: "", model: want, warn: info.warn || "", detected: base != null },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 工单 → 机型 / 布局 —— 源 panel.py model_of_mo / resolve_layout
// ════════════════════════════════════════════════════════════════════════════

async function modelOfMo(moNo) {
  if (!moNo) return { model: "", productCode: "" };
  const mo = await query("SELECT product_code, fg_code, feeder_model FROM ord_mo WHERE mo_no=$1", [moNo]);
  if (!mo.rows[0]) return { model: "", productCode: "" };
  const mRow = mo.rows[0];
  const productCode = (mRow.product_code || "").trim();
  for (const pc of [(mRow.fg_code || "").trim(), productCode]) {
    if (!pc) continue;
    const p = await query("SELECT product_model FROM md_product WHERE product_code=$1", [pc]);
    if (p.rows[0] && (p.rows[0].product_model || "").trim()) {
      return { model: (p.rows[0].product_model || "").trim(), productCode };
    }
  }
  return { model: (mRow.feeder_model || "").trim(), productCode };
}

async function resolveLayout(moNo) {
  const { model, productCode: pc } = await modelOfMo(moNo);
  const info = { model: model || "", productCode: pc || "", matched: "", warn: "" };
  let layout = null;
  if (pc) {
    const r = await query("SELECT * FROM cfg_panel_layout WHERE enabled=1 AND product_code=$1 ORDER BY id DESC", [pc]);
    if (r.rows[0]) { info.matched = "product_code"; layout = r.rows[0]; return { layout, info }; }
  }
  if (model) {
    const r = await query("SELECT * FROM cfg_panel_layout WHERE enabled=1 AND model=$1 ORDER BY id DESC", [model]);
    if (r.rows[0]) { info.matched = "model"; layout = r.rows[0]; return { layout, info }; }
    info.warn = `机型「${model}」没有启用中的拼版布局，无法推算整版。请先到「配置中心 → 拼版布局」按该机型实际拼数配几列×几行（拼数错会推算出不存在的 SN）`;
    return { layout: null, info };
  }
  const r = await query("SELECT * FROM cfg_panel_layout WHERE enabled=1 ORDER BY id");
  if (r.rows.length === 1) {
    info.matched = "only";
    info.warn = `工单没维护机型，暂用唯一的一套布局（${r.rows[0].model || ""}）`;
    return { layout: r.rows[0], info };
  }
  info.warn = "工单没维护机型，且启用的拼版布局有多套，无法判断用哪一套";
  return { layout: null, info };
}

// Named exports for route modules (also bundled in default export below)
export {
  _normResult, _latestTest, _judgeSlotByTest,
  _recordsNear, _detectBaseByRecords,
  _isRepair, _stBrief, _resolveNext,
  _agingOf, _buildView, _posOfIndex0,
  panelFromAoi, panelSnsFor,
  modelOfMo, resolveLayout,
  matchLayout,
};

export default {
  parseSn, joinSn, posOfIndex, panelSns, judgeSlot,
  listLayouts, saveLayout, deleteLayout, matchLayout,
  agingOf, buildView, resolveNext, alignLayout,
  _normResult, _latestTest, _judgeSlotByTest,
  _recordsNear, _detectBaseByRecords,
  _isRepair, _stBrief, _resolveNext,
  _agingOf, _buildView, _posOfIndex0,
  panelFromAoi, panelSnsFor,
  modelOfMo, resolveLayout,
};