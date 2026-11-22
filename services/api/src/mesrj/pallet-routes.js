// ============================================================================
// W12 栈板绑码（源 api/pallet.py，14 路由） —— 从 routes/mesrj.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮1续）。
// 依赖经 registerPalletRoutes(router, deps) 注入，与 smta-routes/ultra 同一约定；
// 注册位置在 createMesrjRouter 内保持不变（JWT 之后，顺序即原块顺序）。
// ============================================================================
import { guard_open_ng } from "./domain.js";
import { dayCode, getRule, ruleOfMo, nextPalletNo, wipNo, makePrintJob } from "./packcode.js";

export function registerPalletRoutes(router, { query, ok, fail, getParam, perm: requireMesrjPerm }) {
  // ═════════════════════════════════════════════════════════════════════════════
  const PALLET_OPEN = "装板中", PALLET_CLOSED = "已封板";

  const _pallet = async (palletNo) => {
    const r = await query("SELECT * FROM prd_pallet WHERE pallet_no=$1", [palletNo]);
    return r.rows[0] || null;
  };
  const _boxesOf = (row) => String(row && row.box_list || "").split(",").map(s => s.trim()).filter(Boolean);
  const _box = async (boxNo) => {
    const r = await query("SELECT * FROM prd_box WHERE box_no=$1", [boxNo]);
    return r.rows[0] || null;
  };
  const _palletJson = async (row, full) => {
    if (!row) return null;
    const d = { ...row };
    const bl = _boxesOf(row);
    if (full) {
      d.boxes = [];
      for (const bn of bl) {
        const b = await _box(bn);
        d.boxes.push({ box_no: bn, qty: b ? Number(b.qty || 0) : 0, status: b ? b.status : "?" });
      }
    } else {
      d.box_preview = bl.slice(0, 3);
    }
    d.box_n = bl.length;
    delete d.box_list;
    return d;
  };
  const _userName = async (req) => {
    try { return req.user && (req.user.emp_name || req.user.login_name) || ""; } catch { return ""; }
  };
  const _openPalletOf = async (moNo, lineCode) => {
    lineCode = (lineCode || "").trim();
    if (lineCode) {
      const r = await query(
        "SELECT * FROM prd_pallet WHERE mo_no=$1 AND status=$2 AND COALESCE(line_code,'')=$3 ORDER BY id DESC LIMIT 1",
        [moNo, PALLET_OPEN, lineCode]);
      if (r.rows[0]) return r.rows[0];
      const cnt = (await query("SELECT COUNT(*) AS n FROM prd_pallet WHERE mo_no=$1 AND status=$2", [moNo, PALLET_OPEN])).rows[0].n;
      if (Number(cnt) === 1) {
        const old = await query(
          "SELECT * FROM prd_pallet WHERE mo_no=$1 AND status=$2 AND COALESCE(line_code,'')='' ORDER BY id DESC LIMIT 1", [moNo, PALLET_OPEN]);
        if (old.rows[0]) {
          await query("UPDATE prd_pallet SET line_code=$1 WHERE pallet_no=$2", [lineCode, old.rows[0].pallet_no]);
          return old.rows[0];
        }
      }
      return null;
    }
    const r = await query("SELECT * FROM prd_pallet WHERE mo_no=$1 AND status=$2 ORDER BY id DESC LIMIT 1", [moNo, PALLET_OPEN]);
    return r.rows[0] || null;
  };
  const _nowTs = () => { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

  // pallet/init —— 首页信息（容量/规则/打印模板）
  router.get("/pallet/init", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1 LIMIT 1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    const rule = await getRule(mo.product_code || "");
    if (!rule) return fail(res, `机型【${mo.product_code || "?"}】未配置装箱编码规则`);
    const cap = rule.cartons_per_pallet ? Number(rule.cartons_per_pallet) : 0;
    const openPallet = await _openPalletOf(moNo, mo.line_code);
    const tpls = (await query("SELECT tpl_code,tpl_name,file_name FROM cfg_print_tpl WHERE tpl_type='pallet' AND enabled=1 ORDER BY sort_no,id")).rows;
    return ok(res, {
      mo_no: moNo, product_code: mo.product_code, cust_code: mo.cust_code,
      plan_qty: mo.plan_qty, out_qty: mo.out_qty, line_code: mo.line_code,
      carton_qty: rule.carton_qty || 0, cartons_per_pallet: cap,
      pallet_tpl_code: rule.pallet_tpl_code || "",
      open_pallet: openPallet ? { pallet_no: openPallet.pallet_no, status: openPallet.status, box_count: openPallet.box_count, total_qty: openPallet.total_qty } : null,
      templates: tpls,
    });
  });

  // pallet/open —— 取或新建「装板中」栈板
  router.post("/pallet/open", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const moNo = String(d.mo_no || "").trim();
    const lineCode = String(d.line_code || "").trim();
    const poNo = String(d.po_no || "").trim();
    const capacity = d.capacity || "";
    const tplCode = String(d.tpl_code || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1 LIMIT 1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    const status = (mo.status || "").trim();
    if (status === "已完工" || status === "已关闭" || status === "作废")
      return fail(res, `工单 ${moNo} 状态为【${status}】，不能码垛`);
    const rule = await getRule(mo.product_code || "");
    if (!rule) return fail(res, `机型【${mo.product_code || "?"}】未配置装箱编码规则`);
    let cap = Number(capacity || 0);
    if (cap <= 0) cap = Number(rule.cartons_per_pallet || 0);
    if (cap <= 0) return fail(res, `机型【${rule.machine_model || mo.product_code}】未配置每栈板箱数`);
    if (cap > 200) return fail(res, "每栈板箱数必须是 1~200 的整数");
    const ex = await _openPalletOf(moNo, lineCode);
    if (ex) return ok(res, await _palletJson(ex, true), "已有装板中的栈板");
    const poOut = poNo || mo.po_no || "";
    const isPool = Number(mo.is_pool || 0) === 1;
    if (isPool && !poOut) return fail(res, `工单 ${moNo} 是常驻单，建栈板时必须选择出货 PO`);
    const wip = await wipNo("PAL");
    await query(`INSERT INTO prd_pallet (pallet_no,mo_no,po_no,cust_code,product_code,capacity,line_code,box_count,total_qty,box_list,status,tpl_code,created_by,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [wip, moNo, poOut, mo.cust_code || "", mo.product_code || "", cap, lineCode, 0, 0, "", PALLET_OPEN,
       (tplCode || rule.pallet_tpl_code || ""), await _userName(req), _nowTs()]);
    const p = await _pallet(wip);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "开板", wip, `${moNo} 每板 ${cap} 箱${lineCode ? " 产线 " + lineCode : ""}`, _nowTs()]);
    return ok(res, await _palletJson(p, true), "栈板已新建");
  });

  // pallet/box/add —— 把外箱装入栈板
  router.post("/pallet/box/add", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    const boxNo = String(d.box_no || "").trim();
    if (!palletNo || !boxNo) return fail(res, "缺少栈板号或外箱码");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    if (p.status !== PALLET_OPEN) return fail(res, "栈板已封板，不能装箱");
    const b = await _box(boxNo);
    if (!b) return fail(res, `外箱不存在：${boxNo}`);
    if (b.status !== "已封箱") return fail(res, `外箱 ${boxNo} 尚未封箱，不能装板`);
    if (String(b.mo_no || "") !== String(p.mo_no)) return fail(res, `外箱工单 ${b.mo_no} 与栈板工单 ${p.mo_no} 不一致`);
    if (String(b.po_no || "") !== String(p.po_no)) return fail(res, `外箱 PO 与栈板 PO 不一致`);
    if (String(b.product_code || "") !== String(p.product_code)) return fail(res, `外箱机型与栈板机型不一致`);
    const boxes = _boxesOf(p);
    if (boxes.includes(boxNo)) return fail(res, `外箱 ${boxNo} 已在栈板上`);
    if (boxes.length >= Number(p.capacity || 0)) return fail(res, `栈板已满（${p.box_count}/${p.capacity}）`);
    // 防呆：箱内还有未处理不良的 SN 不许上栈板（源 api/pallet.py pallet.check_ng）
    if (String(await getParam("pallet.check_ng", "1")).trim() !== "0") {
      const sns = String(b.sn_list || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 100);
      for (const s of sns) {
        const ng = await guard_open_ng(s);
        if (ng) return fail(res, `外箱 ${boxNo} 里的 ${s} 还有未处理不良，不能上栈板`);
      }
    }
    boxes.push(boxNo);
    const totalQty = Number(p.total_qty || 0) + Number(b.qty || 0);
    await query("UPDATE prd_pallet SET box_count=$1,total_qty=$2,box_list=$3,updated_at=$4 WHERE pallet_no=$5",
      [boxes.length, totalQty, boxes.join(","), _nowTs(), palletNo]);
    await query("UPDATE prd_box SET pallet_no=$1,updated_at=$2 WHERE box_no=$3", [palletNo, _nowTs(), boxNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "装箱", boxNo, `装入栈板 ${palletNo}`, _nowTs()]);
    return ok(res, await _palletJson(await _pallet(palletNo), true), "外箱已装板");
  });

  // pallet/box/remove —— 从栈板移出外箱
  router.post("/pallet/box/remove", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    const boxNo = String(d.box_no || "").trim();
    if (!palletNo || !boxNo) return fail(res, "缺少栈板号或外箱码");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    if (p.status !== PALLET_OPEN) return fail(res, "栈板已封板，不能移箱");
    const boxes = _boxesOf(p);
    if (!boxes.includes(boxNo)) return fail(res, `外箱 ${boxNo} 不在栈板 ${palletNo} 上`);
    const b = await _box(boxNo);
    boxes.splice(boxes.indexOf(boxNo), 1);
    const totalQty = Math.max(0, Number(p.total_qty || 0) - Number(b ? b.qty || 0 : 0));
    await query("UPDATE prd_pallet SET box_count=$1,total_qty=$2,box_list=$3,updated_at=$4 WHERE pallet_no=$5",
      [boxes.length, totalQty, boxes.join(","), _nowTs(), palletNo]);
    await query("UPDATE prd_box SET pallet_no='',updated_at=$1 WHERE box_no=$2", [_nowTs(), boxNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "移箱", boxNo, `移出栈板 ${palletNo}`, _nowTs()]);
    return ok(res, await _palletJson(await _pallet(palletNo), true), "外箱已移出");
  });

  // pallet/close —— 封板：生成正式栈板码 + 更新外箱 + 发起打印
  router.post("/pallet/close", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    if (p.status !== PALLET_OPEN) return fail(res, "栈板已封板");
    if ((p.box_count || 0) <= 0) return fail(res, "空栈板不能封板");
    const [rule] = await ruleOfMo(p.mo_no);
    if (!rule) return fail(res, `机型【${p.product_code || "?"}】未配置装箱编码规则`);
    let finalNo = null;
    for (let i = 0; i < 5; i++) {
      const cand = await nextPalletNo(rule);
      try {
        await query("UPDATE prd_pallet SET pallet_no=$1,status=$2,updated_at=$3 WHERE pallet_no=$4", [cand, PALLET_CLOSED, _nowTs(), palletNo]);
        finalNo = cand;
        break;
      } catch { continue; }
    }
    if (!finalNo) return fail(res, "栈板码生成冲突，请重试");
    await query("UPDATE prd_box SET pallet_no=$1,updated_at=$2 WHERE pallet_no=$3", [finalNo, _nowTs(), palletNo]);
    // OQC block: prd_pallet has no oqc_status/release_locked columns → guarded no-op
    const tplCode = (p.tpl_code || rule.pallet_tpl_code || "").trim();
    let jobNo = "", warn = "";
    if (tplCode) {
      const tpl = (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1 LIMIT 1", [tplCode])).rows[0];
      if (tpl) {
        const payload = {
          ref_type: "pallet", ref_no: finalNo, pallet_no: finalNo, mo_no: p.mo_no, po_no: p.po_no, cust_code: p.cust_code,
          product_code: p.product_code, machine_model: rule.machine_model, carton_count: p.box_count, total_qty: p.total_qty,
          day_code: dayCode(new Date()), year_digit: new Date().getFullYear() % 10,
          date_of_mfg: new Date().toLocaleDateString("zh-CN").replace(/\//g, "."),
          wireline_sku: rule.wireline_sku || "", consumer_sku: rule.consumer_sku || "",
          ship_to: p.ship_to || "", subordinate_name: p.subordinate_name || "", sub_po: p.sub_po || "",
          pallet_no_seq: ((p.pallet_x || "") + "/" + (p.pallet_y || "")).replace(/\/$/, "") || "",
          tpl: { tpl_code: tpl.tpl_code, tpl_name: tpl.tpl_name, file_name: tpl.file_name, fields: tpl.fields },
          printed_by: (req.user && req.user.login_name) || "", printed_at: _nowTs(),
        };
        const job = await makePrintJob("pallet", finalNo, tpl.tpl_code, payload, (req.user && req.user.login_name) || "");
        jobNo = job || ""; // makePrintJob 返回 job_no 字符串（packcode.js）
        await query("UPDATE prd_pallet SET print_times=COALESCE(print_times,0)+1,tpl_code=$1,updated_at=$2 WHERE pallet_no=$3", [tpl.tpl_code, _nowTs(), finalNo]);
      } else warn = "未配置栈板打印模板，请稍后用【补打】手动打印";
    } else warn = "未配置栈板打印模板，请稍后用【补打】手动打印";
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "封板", finalNo, `${p.box_count} 箱（原临时号 ${palletNo}）`, _nowTs()]);
    return ok(res, { pallet: await _palletJson(await _pallet(finalNo), true), final_pallet_no: finalNo, print_job: jobNo, print_warn: warn }, "栈板已封板");
  });

  // pallet/list —— 栈板列表
  router.get("/pallet/list", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const status = String(req.query.status || "").trim();
    const page = Number(req.query.page || 1), pageSize = Number(req.query.pageSize || 20);
    let sql = "SELECT pallet_no,mo_no,po_no,product_code,capacity,box_count,total_qty,status,tpl_code,print_times,line_code,created_by,created_at FROM prd_pallet";
    const args = [], conds = [];
    if (moNo) { conds.push(`mo_no=$${args.length + 1}`); args.push(moNo); }
    if (status) { conds.push(`status=$${args.length + 1}`); args.push(status); }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY created_at DESC";
    const total = (await query("SELECT COUNT(*) AS n FROM (" + sql.replace(/ORDER BY.*$/, "") + ") t", args)).rows[0].n;
    sql += ` LIMIT $${args.length + 1} OFFSET $${args.length + 2}`;
    args.push(pageSize, (page - 1) * pageSize);
    const rows = (await query(sql, args)).rows;
    return ok(res, { list: rows, total: Number(total), page, pageSize });
  });

  // pallet/detail —— 栈板详情（含箱）
  router.get("/pallet/detail", requireMesrjPerm(null), async (req, res) => {
    const palletNo = String(req.query.pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    return ok(res, await _palletJson(p, true));
  });

  // pallet/reopen —— 已封板栈板重新打开（只允许重开刚封的）
  router.post("/pallet/reopen", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const palletNo = String((req.body || {}).pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    if (p.status !== PALLET_CLOSED) return fail(res, "栈板未封板，无需重开");
    await query("UPDATE prd_pallet SET status=$1,updated_at=$2 WHERE pallet_no=$3", [PALLET_OPEN, _nowTs(), palletNo]);
    await query("UPDATE prd_box SET pallet_no='',updated_at=$1 WHERE pallet_no=$2", [_nowTs(), palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "重开", palletNo, "解封板，外箱全部解绑", _nowTs()]);
    return ok(res, { pallet_no: palletNo, status: PALLET_OPEN }, "栈板已重开");
  });

  // pallet/change-po —— 改挂 PO（台账 prd_pallet_po_log；源 /pallet/change-po）
  router.post("/pallet/change-po", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    const toPo = String(d.to_po || "").trim();
    const reason = String(d.reason || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    if (!toPo) return fail(res, "请选择要改挂到的 PO");
    if (!reason) return fail(res, "改挂 PO 必须填写原因（会记入台账，出货对账时要查）");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在：" + palletNo);
    const fromPo = (p.po_no || "").trim();
    if (toPo === fromPo) return fail(res, "目标 PO 与当前 PO 相同（" + toPo + "），无需改挂");
    const po = (await query("SELECT * FROM ord_po WHERE po_no=$1 ORDER BY po_line LIMIT 1", [toPo])).rows[0];
    if (!po) return fail(res, "客户 PO【" + toPo + "」还没在「订单管理」建档 —— 没建档就不知道订单量，欠数账会算成已齐套。请先建档后再改挂");
    const poPc = (po.product_code || "").trim();
    const palPc = (p.product_code || "").trim();
    if (poPc && palPc && poPc !== palPc)
      return fail(res, "不能跨机型改挂：本栈板是【" + palPc + "】，PO " + toPo + " 要的是【" + poPc + "】");
    const poCust = (po.cust_code || "").trim();
    const palCust = (p.cust_code || "").trim();
    if (poCust && palCust && poCust !== palCust)
      return fail(res, "不能跨客户改挂：本栈板货主是【" + palCust + "】，PO " + toPo + " 是【" + poCust + "】");
    const qty = Number(p.total_qty || 0);
    const boxN = Number(p.box_count || 0);
    await query("UPDATE prd_pallet SET po_no=$1, cust_code=$2, updated_at=$3 WHERE pallet_no=$4",
      [toPo, poCust || palCust, _nowTs(), palletNo]);
    await query("UPDATE prd_box SET po_no=$1, updated_at=$2 WHERE pallet_no=$3", [toPo, _nowTs(), palletNo]);
    await query(`INSERT INTO prd_pallet_po_log (pallet_no,mo_no,from_po,to_po,qty,box_count,reason,operator,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [palletNo, p.mo_no, fromPo, toPo, qty, boxN, reason, (req.user && req.user.login_name) || "", _nowTs()]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "改挂PO", palletNo, (fromPo || "无") + " → " + toPo + "（" + boxN + " 箱 " + qty + " 台）" + reason, _nowTs()]);
    return ok(res, { pallet_no: palletNo, from_po: fromPo, to_po: toPo, need_reprint: p.status === PALLET_CLOSED }, "已改挂：" + (fromPo || "无") + " → " + toPo + "（" + qty + " 台）");
  });

  // pallet/reprint —— 补打栈板标签
  router.post("/pallet/reprint", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    const [rule] = await ruleOfMo(p.mo_no);
    const tplCode = String(d.tpl_code || p.tpl_code || rule.pallet_tpl_code || "").trim();
    if (!tplCode) return fail(res, "没有可用的打印模板");
    const tpl = (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1 LIMIT 1", [tplCode])).rows[0];
    if (!tpl) return fail(res, "打印模板不存在或已禁用");
    const payload = {
      ref_type: "pallet", ref_no: palletNo, pallet_no: palletNo, mo_no: p.mo_no, po_no: p.po_no, cust_code: p.cust_code,
      product_code: p.product_code, machine_model: rule.machine_model, carton_count: p.box_count, total_qty: p.total_qty,
      day_code: dayCode(new Date()), year_digit: new Date().getFullYear() % 10,
      date_of_mfg: new Date().toLocaleDateString("zh-CN").replace(/\//g, "."),
      wireline_sku: rule.wireline_sku || "", consumer_sku: rule.consumer_sku || "",
      ship_to: p.ship_to || "", subordinate_name: p.subordinate_name || "", sub_po: p.sub_po || "",
      pallet_no_seq: ((p.pallet_x || "") + "/" + (p.pallet_y || "")).replace(/\/$/, "") || "",
      tpl: { tpl_code: tpl.tpl_code, tpl_name: tpl.tpl_name, file_name: tpl.file_name, fields: tpl.fields },
      reprint: true, printed_by: (req.user && req.user.login_name) || "", printed_at: _nowTs(),
    };
    const job = await makePrintJob("pallet", palletNo, tpl.tpl_code, payload, (req.user && req.user.login_name) || "");
    await query("UPDATE prd_pallet SET print_times=COALESCE(print_times,0)+1,tpl_code=$1,updated_at=$2 WHERE pallet_no=$3", [tpl.tpl_code, _nowTs(), palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "补打", palletNo, "重新生成栈板标签打印任务", _nowTs()]);
    return ok(res, { job_no: job }, "打印任务已生成");
  });

  // pallet/next —— 下一张栈板码预览
  router.get("/pallet/next", requireMesrjPerm(null), async (req, res) => {
    const pc = String(req.query.product_code || "").trim();
    let rule = pc ? await getRule(pc) : null;
    if (!rule) {
      const rows = (await query("SELECT * FROM cfg_pack_rule WHERE enabled=1 ORDER BY id LIMIT 1")).rows;
      rule = rows[0] || null;
    }
    if (!rule) return fail(res, "未配置装箱编码规则，无法预览栈板码");
    const no = await nextPalletNo(rule);
    return ok(res, { pallet_no: no });
  });

  // pallet/po-log —— 改挂台账
  router.get("/pallet/po-log", requireMesrjPerm(null), async (req, res) => {
    const palletNo = String(req.query.pallet_no || "").trim();
    let sql = "SELECT id,pallet_no,mo_no,from_po,to_po,qty,box_count,reason,operator,created_at FROM prd_pallet_po_log";
    const args = [], conds = [];
    if (palletNo) { conds.push(`pallet_no=$${args.length + 1}`); args.push(palletNo); }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY id DESC LIMIT 100";
    const rows = (await query(sql, args)).rows;
    return ok(res, rows);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // pallet/context —— 工单上下文（开板前/码垛中首屏信息；源 /pallet/context）
  router.get("/pallet/context", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const lineCode = String(req.query.line_code || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1 LIMIT 1", [moNo])).rows[0];
    const openPallet = await _openPalletOf(moNo, lineCode);
    const moPalletizedBoxes = (await query(
      "SELECT COUNT(*) AS n FROM prd_box WHERE mo_no=$1 AND COALESCE(pallet_no,'') <> ''", [moNo]
    )).rows[0].n;
    const moClosedPallets = (await query(
      "SELECT COUNT(*) AS n FROM prd_pallet WHERE mo_no=$1 AND status=$2", [moNo, PALLET_CLOSED]
    )).rows[0].n;
    return ok(res, {
      open_pallet: openPallet ? await _palletJson(openPallet, false) : null,
      mo_palletized_boxes: Number(moPalletizedBoxes),
      mo_closed_pallets: Number(moClosedPallets),
      mo_po: (mo && mo.po_no) || "",
      mo_product_code: (mo && mo.product_code) || "",
      is_pool: Number(mo && mo.is_pool != null ? mo.is_pool : 0),
    });
  });

  // pallet/cancel —— 作废空栈板（源 /pallet/cancel）
  router.post("/pallet/cancel", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const palletNo = String((req.body || {}).pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在：" + palletNo);
    if (p.status !== PALLET_OPEN) return fail(res, "已封板的栈板不能作废");
    if (Number(p.box_count || 0) > 0)
      return fail(res, `栈板上已有 ${p.box_count} 箱，不能作废（请先逐箱解绑）`);
    await query("DELETE FROM prd_pallet WHERE pallet_no=$1 AND box_count=0", [palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "作废空板", palletNo, "", _nowTs()]);
    return ok(res, null, "空栈板已作废");
  });

  // pallet/meta —— 打印信息（送至/货主/子PO/栈板序号，仅未封板可改；源 /pallet/meta）
  router.post("/pallet/meta", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在：" + palletNo);
    if (p.status !== PALLET_OPEN) return fail(res, "已封板的栈板不能修改打印信息（可改后再补打）");
    await query(
      "UPDATE prd_pallet SET ship_to=$1, subordinate_name=$2, sub_po=$3, pallet_x=$4, pallet_y=$5, updated_at=$6 WHERE pallet_no=$7",
      [String(d.ship_to || "").trim(), String(d.subordinate_name || "").trim(),
       String(d.sub_po || "").trim(), String(d.pallet_x || "").trim(), String(d.pallet_y || "").trim(),
       _nowTs(), palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "打印信息", palletNo, "修改打印信息", _nowTs()]);
    return ok(res, await _palletJson(await _pallet(palletNo), true), "打印信息已保存");
  });

  // pallet/po-options —— 可改挂 PO 候选（同机型、未关闭，带欠数；源 /pallet/po-options）
  router.get("/pallet/po-options", requireMesrjPerm(null), async (req, res) => {
    let productCode = String(req.query.product_code || "").trim();
    const moNo = String(req.query.mo_no || "").trim();
    if (!productCode && moNo) {
      const mo = (await query("SELECT product_code FROM ord_mo WHERE mo_no=$1 LIMIT 1", [moNo])).rows[0];
      productCode = (mo && mo.product_code) || "";
    }
    if (!productCode) return fail(res, "缺少机型（product_code）");
    const rows = (await query(
      "SELECT po_no, COALESCE(po_line,'1') AS po_line, COALESCE(cust_code,'') AS cust_code, " +
      "COALESCE(order_qty,0) AS order_qty, COALESCE(delivery_date,'') AS delivery_date, " +
      "COALESCE(status,'') AS status FROM ord_po " +
      "WHERE product_code=$1 AND COALESCE(status,'') NOT IN ('已关闭','已完工') " +
      "ORDER BY (COALESCE(delivery_date,'')=''), delivery_date, po_no LIMIT 50",
      [productCode])).rows;
    const out = [];
    for (const r of rows) {
      const orderQty = Number(r.order_qty || 0);
      const done = (await query(
        "SELECT COALESCE(SUM(total_qty),0) AS n FROM prd_pallet WHERE po_no=$1 AND status='已封板'", [r.po_no]
      )).rows[0].n;
      const gap = Math.max(0, orderQty - Number(done));
      out.push({
        po_no: r.po_no, po_line: r.po_line, cust_code: r.cust_code,
        order_qty: orderQty, delivery_date: r.delivery_date, status: r.status,
        done_qty: Number(done), gap: gap, complete: gap <= 0,
      });
    }
    return ok(res, { product_code: productCode, pos: out });
  });

  // pallet/print —— 补打/打印栈板标签（须已封板；源 /pallet/print）
  router.post("/pallet/print", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    const tplCode = String(d.tpl_code || "").trim();
    const reprint = Boolean(d.reprint);
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在：" + palletNo);
    if (p.status !== PALLET_CLOSED) return fail(res, "请先完成封板再打印标签");
    const [rule] = await ruleOfMo(p.mo_no);
    if (!rule) return fail(res, "机型【" + (p.product_code || "?") + "】未配置装箱编码规则");
    const code = tplCode || p.tpl_code || rule.pallet_tpl_code || "";
    if (!code) return fail(res, "没有可用的打印模板");
    const tpl = (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1 LIMIT 1", [code])).rows[0];
    if (!tpl) return fail(res, "打印模板不存在或已禁用");
    const boxes = _boxesOf(p);
    const cartons = [];
    for (const bn of boxes) {
      const b = await _box(bn);
      cartons.push({ box_no: bn, qty: b ? Number(b.qty || 0) : 0 });
    }
    const seq = (p.pallet_x || p.pallet_y) ? (p.pallet_x || "") + "/" + (p.pallet_y || "").replace(/\/$/, "") : "";
    const payload = {
      ref_type: "pallet", ref_no: p.pallet_no, pallet_no: p.pallet_no,
      mo_no: p.mo_no, po_no: p.po_no, cust_code: p.cust_code,
      product_code: p.product_code, machine_model: rule.machine_model,
      carton_count: p.box_count, total_qty: p.total_qty, cartons: cartons,
      day_code: dayCode(new Date()), year_digit: new Date().getFullYear() % 10,
      date_of_mfg: new Date().toLocaleDateString("zh-CN").replace(/\//g, "."),
      wireline_sku: rule.wireline_sku || "", consumer_sku: rule.consumer_sku || "",
      ship_to: p.ship_to || "", subordinate_name: p.subordinate_name || "", sub_po: p.sub_po || "",
      pallet_no_seq: seq || "", reprint,
      tpl: { tpl_code: tpl.tpl_code, tpl_name: tpl.tpl_name, file_name: tpl.file_name, fields: tpl.fields },
      printed_by: (req.user && req.user.login_name) || "", printed_at: _nowTs(),
    };
    const job = await makePrintJob("pallet", p.pallet_no, tpl.tpl_code, payload, (req.user && req.user.login_name) || "");
    await query("UPDATE prd_pallet SET print_times=COALESCE(print_times,0)+1, tpl_code=$1, updated_at=$2 WHERE pallet_no=$3",
      [tpl.tpl_code, _nowTs(), palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "打印标签", palletNo,
       tpl.tpl_code + " " + (reprint ? "补打" : "打印"), _nowTs()]);
    return ok(res, { job_no: job, payload }, "已生成打印任务 " + job + "（等待打印程序取走）");
  });

  // W12：不良品维修交接（源 api/repair.py，31 路由）—— 复用 repair-core.js + designator.js
}
