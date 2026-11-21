/**
 * W12 PO 全工序追溯导出 —— 源 core/trace_export.py + core/sn_full.py
 * 关键转换：SQLite -> PG ($n 参数, ILIKE, timestamptz, bigserial)
 * Excel 生成：SheetJS (xlsx)，替代源码的 openpyxl
 * 依赖：db.js (query)
 */
import { query } from "../db.js";
import XLSX from "xlsx";

export const CHUNK = 400;
export const EXCEL_MAX_ROWS = 1000000;

export function _now() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function _chunks(seq, n = CHUNK) {
  seq = Array.from(seq || []);
  const out = [];
  for (let i = 0; i < seq.length; i += n) out.push(seq.slice(i, i + n));
  return out;
}

/** 分块 IN 查询，避免 PG 参数上限；sqlTpl 含 {ph} 占位符，由本函数替换。 */
export async function _bySn(sqlTpl, vals, batch = CHUNK) {
  const list = Array.from(vals || []);
  if (!list.length) return [];
  const out = [];
  for (const part of _chunks(list, batch)) {
    const ph = part.map((_, i) => `$${i + 1}`).join(",");
    const r = await query(sqlTpl.replace("{ph}", ph), part);
    out.push(...r.rows);
  }
  return out;
}

export function _split(v) {
  return String(v || "").split(",").map(x => x.trim()).filter(Boolean);
}

/** ---------------------------------------------------------------- PO 解析 */
export async function resolvePo(poNo) {
  poNo = (poNo || "").trim();
  const poRows = await query("SELECT * FROM ord_po WHERE po_no=$1 ORDER BY id LIMIT 1", [poNo]);
  const po = poRows.rows[0] || null;
  const mos = (await query("SELECT mo_no, product_code, plan_qty, out_qty, ng_qty, status, line_code FROM ord_mo WHERE po_no=$1 ORDER BY mo_no", [poNo])).rows;
  const boxes = (await query("SELECT * FROM prd_box WHERE po_no=$1 ORDER BY box_no", [poNo])).rows;
  const pallets = (await query("SELECT * FROM prd_pallet WHERE po_no=$1 ORDER BY pallet_no", [poNo])).rows;

  const paths = [];
  const sns = new Set();

  // ① 工单挂 PO
  if (mos.length) {
    paths.push(`① 工单 ord_mo.po_no（${mos.length} 个工单）`);
    const moNos = mos.map(m => m.mo_no);
    for (const r of await _bySn("SELECT sn FROM prd_sn WHERE mo_no IN ({ph})", moNos)) sns.add(r.sn);
  }

  // ② 外箱挂 PO
  if (boxes.length) {
    paths.push(`② 外箱 prd_box.po_no（${boxes.length} 个箱）`);
    for (const b of boxes) for (const x of _split(b.sn_list)) sns.add(x);
    const boxNos = boxes.map(b => b.box_no);
    for (const r of await _bySn("SELECT sn FROM prd_sn WHERE box_no IN ({ph})", boxNos)) sns.add(r.sn);
  }

  // ③ 栈板挂 PO
  if (pallets.length) {
    paths.push(`③ 栈板 prd_pallet.po_no（${pallets.length} 个栈板）`);
    const boxNos = [];
    for (const p of pallets) boxNos.push(..._split(p.box_list));
    if (boxNos.length) {
      for (const b of await _bySn("SELECT box_no, sn_list FROM prd_box WHERE box_no IN ({ph})", boxNos))
        for (const x of _split(b.sn_list)) sns.add(x);
      for (const r of await _bySn("SELECT sn FROM prd_sn WHERE box_no IN ({ph})", boxNos)) sns.add(r.sn);
    }
    for (const r of await _bySn("SELECT sn FROM prd_sn WHERE pallet_no IN ({ph})", pallets.map(p => p.pallet_no))) sns.add(r.sn);
  }

  // ④ 兜底：SN 自己记了栈板号
  if (pallets.length) {
    for (const r of await _bySn("SELECT sn FROM prd_sn WHERE pallet_no IN ({ph})", pallets.map(p => p.pallet_no))) sns.add(r.sn);
  }

  sns.delete("");
  const known = new Set();
  if (sns.size) {
    for (const r of await _bySn("SELECT sn FROM prd_sn WHERE sn IN ({ph})", Array.from(sns))) known.add(r.sn);
  }
  const unknown = Array.from(sns).filter(s => !known.has(s)).sort();

  return {
    po_no: poNo, po, mos, boxes, pallets,
    sns: Array.from(sns).sort(),
    known: known.size,
    unknown,
    paths,
  };
}

/** ---------------------------------------------------------------- 数据汇集 */
export async function collectBySns(sns, moNos = []) {
  sns = Array.from(sns || []).filter(Boolean);
  const t0 = Date.now();

  const q = (sql, vals = [], def = []) => {
    return (async () => {
      try {
        const groups = (sql.match(/\{ph\}/g) || []).length || 1;
        const size = groups > 1 ? Math.floor(vals.length / groups) : vals.length;
        let gi = 0;
        const text = sql.replace(/\{ph\}/g, () => {
          const start = gi * size;
          gi++;
          return vals.slice(start, start + size).map((_, i) => `$${start + i + 1}`).join(",");
        });
        return (await query(text, vals)).rows;
      } catch { return def; }
    })();
  };

  const run = async () => {
    // 过站（含工位中文名）
    const pas = await q(
      `SELECT p.sn, p.process_code, p.seq_no, p.station_code,
              COALESCE(m.station_name,'') AS station_name, COALESCE(m.short_name,'') AS short_name,
              p.actual_station, p.line_code, p.result, p.ng_code, p.pass_time,
              p.operator, p.operator_no, p.forwarded, p.forward_msg
       FROM prd_pass p LEFT JOIN md_station m ON m.station_code = p.station_code
       WHERE p.sn IN ({ph}) ORDER BY p.sn, p.id`, sns);

    // 测试参数汇总
    const tests = await q(
      `SELECT sn, station_code, equip_code, COUNT(*) AS params,
              SUM(CASE WHEN result='PASS' THEN 1 ELSE 0 END) AS ok_cnt,
              SUM(CASE WHEN result<>'PASS' THEN 1 ELSE 0 END) AS ng_cnt,
              MIN(test_time) AS first_time, MAX(test_time) AS last_time
       FROM prd_test WHERE sn IN ({ph}) GROUP BY sn, station_code, equip_code ORDER BY sn`, sns);

    const testDetail = await q(
      `SELECT sn, station_code, equip_code, param_key, param_val, result, test_time
       FROM prd_test WHERE sn IN ({ph}) ORDER BY sn, id`, sns);

    // 设备上报
    const mach = await q(
      `SELECT sn, machine_no, machine_type, station_code, line_sn, track, lot_no, loader_no,
              begin_time, end_time, pass_ng, ng_info, location, channel
       FROM prd_machine_data WHERE sn IN ({ph}) ORDER BY sn, id`, sns);

    // AOI：先找母子码关系，再取 AOI 数据
    const rels = await q(
      `SELECT parent_sn, child_sn, rel_type, station, operator, mo_no, created_at
       FROM prd_sn_rel WHERE (parent_sn IN ({ph}) OR child_sn IN ({ph})) AND COALESCE(is_active,1)=1 ORDER BY id`,
      [...sns, ...sns]);

    const aoiSns = new Set(sns);
    for (const x of rels) { aoiSns.add(x.parent_sn); aoiSns.add(x.child_sn); }
    const aoiSnsArr = Array.from(aoiSns);

    const aoiPanel = await q(
      `SELECT pcb_sn, test_time, project_name, device_name, track_line, board_side,
              robot_result, user_result, final_result, board_number, board_ng_number,
              comp_number, comp_ng_number, file_name
       FROM prd_aoi_result WHERE pcb_sn IN ({ph}) ORDER BY pcb_sn, id`, aoiSnsArr);

    const aoiBoard = await q(
      `SELECT file_name, pcb_sn, board_no, board_sn, robot_result, user_result,
              final_result, ng_comp_number, test_time
       FROM prd_aoi_board WHERE pcb_sn IN ({ph}) ORDER BY pcb_sn, id`, aoiSnsArr);

    const aoiComp = await q(
      `SELECT pcb_sn, board_no, board_result, comp_designator, comp_part, comp_package,
              comp_type, robot_code, robot_result, user_code, user_result
       FROM prd_aoi_comp WHERE pcb_sn IN ({ph}) ORDER BY pcb_sn, id`, aoiSnsArr);

    // 维修：W12 用 qlt_repair_detail（prd_repair 老表可能不存在）
    const repair = await q(
      `SELECT sn, defect_station AS station_code, defect_code, root_cause,
              disposition AS action, result, repair_by, repair_time, remark
       FROM qlt_repair_detail WHERE sn IN ({ph}) ORDER BY sn, id`, sns);

    const defect = await q(
      `SELECT sn, defect_code, station_code, process_code, mo_no, root_cause, handle,
              repair_times, operator, defect_time
       FROM prd_defect_rec WHERE sn IN ({ph}) ORDER BY sn, id`, sns);

    const scrap = await q(
      `SELECT sn, scrap_code, reason, station_code, mo_no, approved_by, scrap_time
       FROM prd_scrap WHERE sn IN ({ph}) ORDER BY sn, id`, sns);

    let skip = [];
    try {
      skip = await q(
        `SELECT sn, station_code, skip_type, release_no, reason, operator, skip_time
         FROM prd_skip_log WHERE sn IN ({ph}) ORDER BY sn, id`, sns);
    } catch { skip = []; }

    let laser = [];
    if (moNos.length) {
      try {
        laser = await q(
          `SELECT sn, seq_no, panel_no, panel_pos, panel_size, mo_no, product_model,
                  machine_no, client_ip, created_at
           FROM prd_laser_sn WHERE mo_no IN ({ph}) ORDER BY id`, moNos);
      } catch { laser = []; }
    }

    const main = await q(
      `SELECT sn, sn_type, product_code, mo_no, line_code, cur_station, cur_seq, status,
              repair_times, box_no, pallet_no, batch_no, created_at, updated_at
       FROM prd_sn WHERE sn IN ({ph}) ORDER BY sn`, sns);

    return {
      main, pass: pas, tests, test_detail: testDetail, machine: mach, rels,
      aoi_panel: aoiPanel, aoi_board: aoiBoard, aoi_comp: aoiComp,
      repair, defect, scrap, skip, laser,
      elapsed: (Date.now() - t0) / 1000,
    };
  };

  return run();
}

export async function collect(poNo) {
  const r = await resolvePo(poNo);
  const d = await collectBySns(r.sns, r.mos.map(m => m.mo_no));
  d.meta = r;
  return d;
}

/** ---------------------------------------------------------------- 统计 */
export function stationStats(d) {
  const agg = {};
  for (const p of d.pass || []) {
    const code = p.station_code || "";
    const a = agg[code] || (agg[code] = { name: p.station_name || code, ok: new Set(), ng: new Set() });
    if ((p.result || "").toUpperCase() === "OK") a.ok.add(p.sn);
    else a.ng.add(p.sn);
  }
  const rows = [];
  for (const [code, a] of Object.entries(agg).sort()) {
    rows.push([code, a.name, a.ok.size, a.ng.size, a.ok.size + a.ng.size]);
  }
  return rows;
}

export async function stationList(sns) {
  const agg = {};
  for (const part of _chunks(sns || [])) {
    const ph = part.map((_, i) => `$${i + 1}`).join(",");
    const r = await query(
      `SELECT p.station_code, COALESCE(m.station_name,'') AS nm, COUNT(*) AS n
       FROM prd_pass p LEFT JOIN md_station m ON m.station_code = p.station_code
       WHERE p.sn IN (${ph}) GROUP BY p.station_code, m.station_name`, part);
    for (const x of r.rows) {
      const code = x.station_code || "";
      const a = agg[code] || (agg[code] = { code, name: x.nm || code || "", pass: 0 });
      a.pass += Number(x.n || 0);
    }
  }
  return Object.values(agg).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** PO 预览：只报数量与关联，不生成文件 */
export async function summary(poNo) {
  const r = await resolvePo(poNo);
  const sns = r.sns;
  const stations = await stationList(sns);
  const canExport = sns.length > 0;
  let hint = "";
  if (!r.paths.length && !sns.length) {
    hint = "该 PO 在 MES 里关联不到任何产品：请确认开单时有没有填 PO 号（工单 ord_mo.po_no），或该 PO 的货是否还没装箱";
  } else if (r.paths.length && !sns.length) {
    hint = "该 PO 找到了关联记录，但其下查不到任何 SN：多半是工单的 SN 在产品主档里已不存在，或货已装箱但箱的 sn_list 为空";
  }
  return {
    po_no: r.po_no, po: r.po, mos: r.mos,
    box_count: r.boxes.length, pallet_count: r.pallets.length,
    sn_count: sns.length, sn_in_master: r.known,
    sn_not_in_master: r.unknown.slice(0, 50), sn_not_in_master_count: r.unknown.length,
    paths: r.paths, stations, canExport, hint,
  };
}

/** ---------------------------------------------------------------- Excel 生成 (SheetJS) */
function _cell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v);
  return s.length > 32000 ? s.slice(0, 32000) : s;
}

function _sheet(name, header, rows) {
  const data = [header, ...rows.map(row => row.map(_cell))];
  return XLSX.utils.aoa_to_sheet(data);
}

export async function writeXlsx(poNo, stations = []) {
  const d = await collect(poNo);
  const m = d.meta || {};
  const po = m.po || {};
  const keep = new Set((stations || []).map(s => String(s).trim()).filter(Boolean));
  if (keep.size) {
    const f = (x) => keep.has(String(x.station_code || ""));
    d.pass = d.pass.filter(f);
    d.tests = d.tests.filter(f);
    d.test_detail = d.test_detail.filter(f);
    d.machine = d.machine.filter(f);
    d.repair = d.repair.filter(f);
    d.defect = d.defect.filter(f);
    d.skip = d.skip.filter(f);
  }

  const wb = XLSX.utils.book_new();

  // 1 导出说明
  const mosTxt = (m.mos || []).map(x => `${x.mo_no}(${x.product_code || ""})`).join("、") || "无";
  const explainRows = [
    ["导出时间", _now()],
    ["客户 PO", m.po_no],
    ["客户", po.cust_code || "-"],
    ["机型料号", po.product_code || "-"],
    ["PO 订单数量", po.order_qty || 0],
    ["关联工单", mosTxt],
    ["外箱数", m.boxes ? m.boxes.length : 0],
    ["栈板数", m.pallets ? m.pallets.length : 0],
    ["产品台数（去重 SN）", m.sns ? m.sns.length : 0],
    ["", ""],
    ["PO→产品 关联路径", (m.paths || []).join("；") || "（没有任何关联，见下方说明）"],
    ["工位范围", keep.size ? `已按工位筛选：${Array.from(keep).sort().join("、")}` : "全部工位（未筛选）"],
    ["说明 1", "本导出按 PO 全量输出，不分页、不截断。"],
    ["说明 2", "过站明细一个 SN × 一个工位一行，含结果/时间/操作员；设备测试参数为参数级明细，可据此复核测试过程。"],
    ["说明 3", "AOI 数据以整板条码（PCBSN）记录，已通过母码链与整机 SN 关联。"],
    ["未关联到产品主档的 SN 数", m.unknown ? m.unknown.length : 0],
    ["未关联明细", (m.unknown ? m.unknown.slice(0, 30).join("、") : "") || "无"],
  ];
  XLSX.utils.book_append_sheet(wb, _sheet("导出说明", ["项", "值"], explainRows), "导出说明");

  const counts = {};
  const addSheet = (name, header, rows) => {
    XLSX.utils.book_append_sheet(wb, _sheet(name, header, rows), name.slice(0, 31));
    counts[name] = rows.length;
  };

  // 2 PO 汇总
  const plan = Number((m.mos || []).reduce((s, x) => s + Number(x.plan_qty || 0), 0));
  const out = Number((m.mos || []).reduce((s, x) => s + Number(x.out_qty || 0), 0));
  const repSns = new Set((d.repair || []).map(x => x.sn));
  const ngSns = new Set((d.defect || []).map(x => x.sn));
  const scrapSns = new Set((d.scrap || []).map(x => x.sn));
  addSheet("PO汇总", ["项目", "数值"], [
    ["PO", m.po_no],
    ["客户", po.cust_code || "-"],
    ["机型料号", po.product_code || "-"],
    ["工单计划数", plan],
    ["工单已产数", out],
    ["产品台数", m.sns ? m.sns.length : 0],
    ["外箱数", m.boxes ? m.boxes.length : 0],
    ["栈板数", m.pallets ? m.pallets.length : 0],
    ["有过站记录的产品数", new Set((d.pass || []).map(x => x.sn)).size],
    ["有测试数据的产品数", new Set((d.tests || []).map(x => x.sn)).size],
    ["有 AOI 数据的产品数", new Set((d.aoi_panel || []).map(x => x.pcb_sn)).size],
    ["维修台数", repSns.size],
    ["不良台数", ngSns.size],
    ["报废台数", scrapSns.size],
  ]);

  // 3 工位统计
  addSheet("工位统计", ["工位编码", "工位名称", "通过台数", "不良台数", "合计台次"], stationStats(d));

  // 4 栈板清单
  addSheet("栈板清单", ["栈板码", "工单", "PO", "箱数", "数量", "状态", "OQC结果", "入库状态", "OQC判定时间", "创建时间"],
    (m.pallets || []).map(p => [p.pallet_no, p.mo_no, p.po_no, p.box_count, p.total_qty, p.status, p.oqc_status, p.stock_in_status, p.oqc_time, p.created_at]));

  // 5 外箱清单
  addSheet("外箱清单", ["外箱码", "栈板码", "工单", "PO", "数量", "容量", "状态", "SN数量", "SN清单", "创建时间"],
    (m.boxes || []).map(b => {
      const snl = _split(b.sn_list);
      return [b.box_no, b.pallet_no, b.mo_no, b.po_no, b.qty, b.capacity, b.status, snl.length, snl.join(","), b.created_at];
    }));

  // 6 产品台账
  const mainSnSet = new Set((d.main || []).map(x => x.sn));
  addSheet("产品台账", ["SN", "SN类型", "机型料号", "工单", "状态", "当前工位", "维修次数", "外箱码", "栈板码", "批次", "创建时间", "更新时间"],
    [...(d.main || []), ...(m.sns || []).filter(sn => !mainSnSet.has(sn)).map(sn => [sn, "", "", "", "无主档记录", "", "", "", "", "", "", ""])]
      .map(s => [s.sn, s.sn_type, s.product_code, s.mo_no, s.status, s.cur_station, s.repair_times, s.box_no, s.pallet_no, s.batch_no, s.created_at, s.updated_at]));

  // 7 过站明细
  addSheet("过站明细", ["SN", "工序", "序号", "工位编码", "工位名称", "实际站位", "产线", "结果", "不良代码", "过站时间", "操作员工号", "操作员", "转发", "转发信息"],
    (d.pass || []).map(p => [p.sn, p.process_code, p.seq_no, p.station_code, p.station_name, p.actual_station, p.line_code, p.result, p.ng_code, p.pass_time, p.operator_no, p.operator, p.forwarded, p.forward_msg]));

  // 8 设备测试汇总
  addSheet("设备测试汇总", ["SN", "工位编码", "机台", "参数条数", "通过数", "不良数", "首次测试", "末次测试"],
    (d.tests || []).map(t => [t.sn, t.station_code, t.equip_code, t.params, t.ok_cnt, t.ng_cnt, t.first_time, t.last_time]));

  // 9 测试参数明细
  addSheet("测试参数明细", ["SN", "工位编码", "机台", "参数名", "参数值", "结果", "测试时间"],
    (d.test_detail || []).map(t => [t.sn, t.station_code, t.equip_code, t.param_key, t.param_val, t.result, t.test_time]));

  // 10 AOI 整板
  addSheet("AOI整板", ["整板条码", "检测时间", "机型(程序名)", "设备", "线别", "板面", "首判", "复判", "最终判定", "PCBA数", "NG片数", "元件数", "NG元件数", "文件名"],
    (d.aoi_panel || []).map(a => [a.pcb_sn, a.test_time, a.project_name, a.device_name, a.track_line, a.board_side, a.robot_result, a.user_result, a.final_result, a.board_number, a.board_ng_number, a.comp_number, a.comp_ng_number, a.file_name]));

  // 11 AOI 元件
  addSheet("AOI元件", ["整板条码", "板号", "板结果", "位号", "料号", "封装", "元件类型", "不良代码", "设备结果", "复判代码", "复判结果"],
    (d.aoi_comp || []).map(a => [a.pcb_sn, a.board_no, a.board_result, a.comp_designator, a.comp_part, a.comp_package, a.comp_type, a.robot_code, a.robot_result, a.user_code, a.user_result]));

  // 12 维修与不良
  const sheet12 = [];
  for (const x of d.repair || []) sheet12.push([x.sn, "维修", x.station_code, x.defect_code, x.root_cause, x.action, x.result, x.repair_by, x.repair_time]);
  for (const x of d.defect || []) sheet12.push([x.sn, "不良", x.station_code, x.defect_code, x.root_cause, x.handle, "", x.operator, x.defect_time]);
  for (const x of d.scrap || []) sheet12.push([x.sn, "报废", x.station_code, x.scrap_code, x.reason, "", "报废", x.approved_by, x.scrap_time]);
  for (const x of d.skip || []) sheet12.push([x.sn, "跳站", x.station_code, x.skip_type, x.reason, x.release_no, "", x.operator, x.skip_time]);
  addSheet("维修与不良", ["SN", "类型", "工位", "代码", "原因", "处理/措施", "结果", "处理人", "时间"], sheet12);

  // 13 镭雕发码
  addSheet("镭雕发码", ["SN", "序列号", "版号", "版位", "每版块数", "工单", "机型", "机台", "来源IP", "时间"],
    (d.laser || []).map(x => [x.sn, x.seq_no, x.panel_no, x.panel_pos, x.panel_size, x.mo_no, x.product_model, x.machine_no, x.client_ip, x.created_at]));

  // 14 母码链
  addSheet("母码链", ["主码", "子码", "关系类型", "工位", "操作员", "工单", "绑定时间"],
    (d.rels || []).map(x => [x.parent_sn, x.child_sn, x.rel_type, x.station, x.operator, x.mo_no, x.created_at]));

  // 回填行数与耗时到说明页
  const explainWs = wb.Sheets["导出说明"];
  const tail = [
    ["", ""],
    ["各表行数", Object.entries(counts).map(([k, v]) => `${k} ${v} 行`).join("；")],
    ["取数耗时", `${(d.elapsed || 0).toFixed(1)} 秒`],
  ];
  const cur = explainWs["!ref"] ? XLSX.utils.decode_range(explainWs["!ref"]).e.r + 1 : 0;
  XLSX.utils.sheet_add_aoa(explainWs, tail, { origin: cur + 1 });

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  counts.sns = m.sns ? m.sns.length : 0;
  counts.bytes = buf.length;
  return { buffer: buf, counts };
}

/** ---------------------------------------------------------------- sn_full（任意码查询） */
export async function resolveCodes(sn, maxDepth = 5) {
  sn = (sn || "").trim();
  const out = { query: sn, codes: sn ? [sn] : [], peers: [], groups: [], rels: [], self: null };
  if (!sn) return out;

  const selfRows = await query("SELECT * FROM prd_sn WHERE sn=$1 LIMIT 1", [sn]);
  out.self = selfRows.rows[0] || null;

  const seen = new Set([sn]);
  let frontier = [sn];
  const groupSeen = new Set();
  for (let d = 0; d < maxDepth; d++) {
    if (!frontier.length) break;
    const ph1 = frontier.map((_, i) => `$${i + 1}`).join(",");
    const ph2 = frontier.map((_, i) => `$${frontier.length + i + 1}`).join(",");
    const rows = await query(
      `SELECT id, parent_sn, child_sn, rel_type, station, operator, mo_no, created_at
       FROM prd_sn_rel WHERE (parent_sn IN (${ph1}) OR child_sn IN (${ph2})) AND COALESCE(is_active,1)=1 ORDER BY id`,
      [...frontier, ...frontier]);
    const nxt = [];
    const seenIds = new Set(out.rels.map(x => x.id));
    for (const r of rows.rows) {
      if (seenIds.has(r.id)) continue;
      out.rels.push(r);
      const rtype = (r.rel_type || "").trim();
      const others = [r.parent_sn, r.child_sn].filter(x => x && x !== sn);
      if (rtype === "PCBA_Link") {
        for (const x of others) { if (!seen.has(x)) { seen.add(x); nxt.push(x); } }
      } else {
        for (const x of others) {
          if (!seen.has(x) && !groupSeen.has(x)) {
            groupSeen.add(x);
            out.groups.push({ sn: x, rel_type: rtype || "分组", via: r.station || "" });
          }
        }
      }
    }
    frontier = nxt;
  }
  out.codes = [sn, ...Array.from(seen).filter(x => x !== sn).sort()];
  out.peers = Array.from(out.codes).slice(1);
  return out;
}

export async function _codeInfo(codes) {
  const out = [];
  for (const sn of codes) {
    const r = await query("SELECT sn, sn_type, mo_no, status, box_no, pallet_no FROM prd_sn WHERE sn=$1 LIMIT 1", [sn]);
    const row = r.rows[0] || null;
    out.push({
      sn, sn_type: (row && row.sn_type) || "", mo_no: (row && row.mo_no) || "",
      status: (row && row.status) || "", box_no: (row && row.box_no) || "", pallet_no: (row && row.pallet_no) || "",
      in_master: Boolean(row),
    });
  }
  return out;
}

/** 任意码 → 全部数据（与 PO 导出共用 collectBySns，口径一致） */
export async function snQuery(sn) {
  sn = (sn || "").trim();
  if (!sn) return { err: "请扫码或输入 SN" };
  const info = await resolveCodes(sn);
  if (!info.self && !info.rels.length) {
    return { err: `SN 不存在：${sn}（产品主档和绑定关系里都没有）。如果是 AOI 拼板子板码，请到「AOI / SPI 数据」查` };
  }
  const codes = info.codes;
  const moNos = Array.from(new Set((await _codeInfo(codes)).map(x => x.mo_no).filter(Boolean))).sort();
  const d = await collectBySns(codes, moNos);
  (d.pass || []).sort((a, b) => String(a.pass_time || "").localeCompare(String(b.pass_time || "")) || (Number(a.id || 0) - Number(b.id || 0)));
  const counts = {
    codes: codes.length, pass: (d.pass || []).length, tests: (d.tests || []).length,
    test_detail: (d.test_detail || []).length, machine: (d.machine || []).length,
    aoi_panel: (d.aoi_panel || []).length, aoi_comp: (d.aoi_comp || []).length,
    repair: (d.repair || []).length, defect: (d.defect || []).length,
    scrap: (d.scrap || []).length, skip: (d.skip || []).length,
  };
  return {
    query: sn, self: info.self, codes: await _codeInfo(codes), peers: info.peers,
    groups: info.groups, rels: info.rels, data: d, counts,
  };
}

/** 任意码摘要：只报能不能查、关联到几个码（不取全量数据） */
export async function snSummary(sn) {
  sn = (sn || "").trim();
  if (!sn) return { err: "请扫码或输入 SN" };
  const info = await resolveCodes(sn);
  if (!info.self && !info.rels.length) return { err: `SN 不存在：${sn}` };
  let passes = 0;
  for (const code of info.codes) {
    const r = await query("SELECT COUNT(*) AS c FROM prd_pass WHERE sn=$1", [code]);
    passes += Number(r.rows[0]?.c || 0);
  }
  return {
    query: sn, self: info.self, codes: await _codeInfo(info.codes), peers: info.peers,
    groups: info.groups, pass_count: passes,
  };
}
