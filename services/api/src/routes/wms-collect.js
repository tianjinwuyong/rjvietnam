// ============================================================================
// WMS 集料/缺料/发料公告（16 路由）—— 从 server.js 整段搬迁
// （refactor-plan-2026-11-21 阶段3轮2）。原位置：server.js 22540-23624（app 级鉴权
// 闸门之后）。classifyProcessDomain / domainFromUsername / resolveCollectOrder /
// ensureCollectOrder 随块迁入；ensureCollectOrder 经返回值导出供 PMC 挂载注入。
// normalizeLocationKey / ensureMissingCollectOrders 全仓零调用，随迁删除。
// 注意：ensureCollectOrder 内含并行 lane 在途的 migration-332 手工冻结过滤
// （1 处 SQL，未提交，随块搬迁、归属见 commit 说明）。
// ============================================================================
import { errorEnvelope } from "../shared/helpers.js";
import { WAREHOUSE_INVENTORY_EMPLOYEE_ID } from "../virtual-employees/warehouse-safety-report.js";

export function registerWmsCollectRoutes(app, { query, pgPool, requirePermission, sendVirtualEmployeeWechat }) {
// ── WMS Material Collect Orders ─────────────────────────────────────────
// The warehouse collection step between WO pick planning and line issue.
// POST generate snapshots the same FIFO pick-order items into a collect order
// (material + lot + storage location to pick from). The PDA material collector
// scans the location QR and the roll/lot to confirm each line COLLECTED. Web's
// material-issue page consumes GET to show where to pick and what is done.

// Scoped collector roles: VN_WC_SMT / VN_WC_AUTO / VN_WC_MAN (and *_SMT/_AUTO/_MAN
// style accounts) collect only their own line's material; warehouse-wide users
// (VN_WH_*, warehouse role) return "" (all domains).
// Material-code -> process-domain fallback when the BOM line has no 工段 tag
// yet (BOMs are immutable once active; classification must not block issue).
// Mirrors migration 266 rules for the EPS18R1G power-adapter family.
function classifyProcessDomain(materialCode) {
  const c = String(materialCode || "").toUpperCase();
  if (c.startsWith("R0204-") || /^R021[0-7]-/.test(c) || c.startsWith("R0222-")) return "SMT";
  if (["R0203-", "R0206-", "R0207-", "R0208-", "R0209-", "R0218-", "R0219-", "R0220-", "R0221-"].some((p) => c.startsWith(p))) return "AUTO";
  if (["R0101-", "R0102-", "R0103-", "R0104-", "R0105-", "R0106-", "R0108-", "R0110-", "R0201-", "R0202-"].some((p) => c.startsWith(p))) return "MANUAL";
  if (["R0111-", "R0112-", "R0301-", "R0302-", "R0303-", "R0304-", "R0305-", "R0306-", "R0307-", "R0308-"].some((p) => c.startsWith(p))) return "PACKAGING";
  return null;
}

function domainFromUsername(username) {  const u = String(username || "").toUpperCase();
  if (u.includes("_SMT") || u.includes("SMT_")) return "SMT";
  if (u.includes("_AUTO") || u.includes("AUTO_")) return "AUTO";
  if (u.includes("_MAN") || u.includes("_MANUAL") || u.includes("MANUAL_")) return "MANUAL";
  return "";
}

async function resolveCollectOrder(woCode, actorId, actorName, activeOnly = true) {
  // Returns { order, lines } for the collect order of a WO. activeOnly=true
  // (generate path) picks an OPEN/PARTIAL order; false (display path) picks
  // the latest non-cancelled order so COLLECTED/ISSUED states stay visible.
  const order = (await query(
    `SELECT c.id, c.collect_no AS "collectNo", c.work_order_code AS "workOrderCode",
            c.line_code AS "lineCode", c.status, c.collector, c.collected_at AS "collectedAt",
            c.created_at AS "createdAt"
       FROM wms_collect_orders c
      WHERE c.work_order_code = $1 ${activeOnly ? "AND c.status IN ('OPEN','PARTIAL')" : "AND c.status <> 'CANCELLED'"}
      ORDER BY c.id DESC LIMIT 1`, [woCode]
  )).rows[0] ?? null;
  if (!order) return null;
  const lines = (await query(
    `SELECT id, line_no AS "lineNo", material_code AS "materialCode", material_name AS "materialName",
            ruijing_code AS "ruijingCode", lot_no AS "lotNo", material_sn AS "materialSn",
            location_code AS "locationCode", location_qr AS "locationQr", required_qty AS "requiredQty",
            process_stage AS "processStage", process_domain AS "processDomain",
            status, scanned_qr AS "scannedQr", collected_by AS "collectedBy", collected_at AS "collectedAt",
            assigned_to AS "assignedTo", assigned_at AS "assignedAt"
       FROM wms_collect_order_lines WHERE collect_order_id = $1 ORDER BY line_no`, [order.id]
  )).rows;
  return { order, lines };
}

// POST /wms/collect-orders/generate — create (or reuse) the collect list for a
// work order from the same BOM+FIFO resolution as GET /wms/pick-orders. Only
// lines still needing collection (pickedQty < requiredQty) are snapshotted.
// ── ensureCollectOrder: get-or-create the collect list for a WO. Released
// work orders always have materials to collect, so WMS auto-generates the list
// (BOM + FIFO + process-domain tags) on first touch — PDA/Web never see a WO
// without a collect list. Reuses the same resolution as GET /wms/pick-orders;
// only lines still needing collection (pickedQty < requiredQty) are snapshotted.
async function ensureCollectOrder(workOrderCode, actorName) {
  const code = String(workOrderCode || "").trim().toUpperCase();
  if (!code) throw Object.assign(new Error("workOrderCode required"), { status: 400, code: "VALIDATION" });
  const existing = await resolveCollectOrder(code);
  if (existing) return { reused: true, order: existing.order, items: existing.lines };

  const wo = (await query(
    `SELECT w.id, w.code, w.planned_qty, w.line_id, pl.internal_code AS line_code
       FROM work_orders w LEFT JOIN production_lines pl ON pl.id = w.line_id
      WHERE w.code = $1 LIMIT 1`, [code]
  )).rows[0];
  if (!wo) throw Object.assign(new Error(`Work order '${code}' not found`), { status: 404, code: "NOT_FOUND" });

  const bom = (await query("SELECT id FROM boms WHERE product_id = (SELECT product_id FROM work_orders WHERE id=$1) AND status='active' LIMIT 1", [wo.id])).rows[0];
  if (!bom) throw Object.assign(new Error(`No active BOM for work order ${code}`), { status: 409, code: "NO_BOM" });

  const bomLines = (await query(
    `SELECT bl.material_id, bl.qty_per, bl.loss_rate, m.code AS material_code,
            jsonb_build_object('zh', COALESCE(m.name_zh,''), 'en', COALESCE(m.name_en,''), 'vi', COALESCE(m.name_vi,'')) AS material_name,
            COALESCE(NULLIF(lm.ruijing_material_code,''), NULLIF(lm2.vietnam_material_code,'')) AS ruijing_code,
            fifo.lot_no, fifo.location_code, fifo.location_qr, roll.material_sn,
            bl.process_stage, bl.process_domain,
            COALESCE(tx.picked_qty, 0) AS picked_qty
       FROM bom_lines bl
       JOIN materials m ON m.id = bl.material_id
       LEFT JOIN wms_material_label_master lm ON lm.vietnam_material_code = m.code
       LEFT JOIN wms_material_label_master lm2 ON lm2.ruijing_material_code = m.code
       LEFT JOIN LATERAL (
         SELECT ml.lot_no,
                COALESCE(sl.code, bind.location_qr) AS location_code,
                COALESCE(sl.qr_code, bind.location_qr) AS location_qr
         FROM material_lots ml
         LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
         LEFT JOIN LATERAL (
           SELECT b.location_qr
           FROM wms_receiving_pallet_box_bindings b
           WHERE UPPER(b.lot_no) = UPPER(ml.lot_no)
           ORDER BY b.bound_at DESC LIMIT 1
         ) bind ON true
         WHERE ml.material_id = bl.material_id
           AND ml.iqc_status = 'released' AND ml.lot_status = 'open'
           AND ml.received_qty - COALESCE(ml.reserved_qty, 0) > 0
           AND (ml.expiry_date IS NULL OR ml.expiry_date >= CURRENT_DATE)
           -- 手工冻结（migration 332）：冻结批次不进拣料清单
           AND NOT COALESCE(ml.locked, false)
         ORDER BY ml.received_at ASC NULLS LAST, ml.id ASC LIMIT 1
       ) fifo ON true
       LEFT JOIN LATERAL (
         SELECT r.material_sn FROM wms_material_roll_labels r
         WHERE r.material_code = m.code AND r.lot_no = fifo.lot_no
           AND r.lifecycle_status <> 'RETIRED'
         ORDER BY r.created_at DESC LIMIT 1
       ) roll ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(it.qty) FILTER (WHERE it.action='PICK'), 0) AS picked_qty
         FROM inventory_transactions it
         JOIN material_lots tx_lot ON tx_lot.id = it.material_lot_id
         WHERE it.work_order_id = $1 AND tx_lot.material_id = bl.material_id
           AND it.tx_status = 'posted'
       ) tx ON true
      WHERE bl.bom_id = $2 ORDER BY bl.id`, [wo.id, bom.id]
  )).rows;

  const plannedQty = Number(wo.planned_qty || 0);
  const entries = bomLines
    .map((bl, idx) => {
      const required = Math.ceil(Number(bl.qty_per) * plannedQty * (1 + Number(bl.loss_rate ?? 0)));
      const picked = Number(bl.picked_qty || 0);
      return { idx: idx + 1, materialCode: bl.material_code, materialName: bl.material_name, ruijingCode: bl.ruijing_code || null, lotNo: bl.lot_no || null, locationCode: bl.location_code || null, locationQr: bl.location_qr || null, materialSn: bl.material_sn || null, requiredQty: Math.max(required - picked, 0), processStage: bl.process_stage || null, processDomain: bl.process_domain || classifyProcessDomain(bl.material_code) };
    })
    .filter((e) => e.requiredQty > 0);
  if (!entries.length) throw Object.assign(new Error(`All BOM lines for ${code} are already picked`), { status: 409, code: "NOTHING_TO_COLLECT" });

  const collectNo = `CL-${code}-${Date.now().toString().slice(-6)}`;
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const ins = (await client.query(
      `INSERT INTO wms_collect_orders (collect_no, work_order_code, work_order_id, line_code, status, created_by)
       VALUES ($1,$2,$3,$4,'OPEN',$5) RETURNING id, collect_no AS "collectNo", work_order_code AS "workOrderCode", line_code AS "lineCode", status, created_at AS "createdAt"`,
      [collectNo, code, wo.id, wo.line_code || null, actorName || "WMS"]
    )).rows[0];
    for (const e of entries) {
      await client.query(
        `INSERT INTO wms_collect_order_lines
           (collect_order_id, line_no, material_code, material_name, ruijing_code, lot_no, material_sn, location_code, location_qr, required_qty, process_stage, process_domain)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [ins.id, e.idx, e.materialCode, JSON.stringify(e.materialName), e.ruijingCode, e.lotNo, e.materialSn, e.locationCode, e.locationQr, e.requiredQty, e.processStage || null, e.processDomain || null]
      );
    }
    await client.query("COMMIT");
    const created = await resolveCollectOrder(code);
    return { reused: false, order: created.order, items: created.lines };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally { client.release(); }
}

app.post("/wms/collect-orders/generate", requirePermission("wms.execute"), async (req, res) => {
  try {
    const workOrderCode = String(req.body?.workOrderCode || req.body?.woCode || "").trim().toUpperCase();
    const result = await ensureCollectOrder(workOrderCode, req.user?.username || "WMS");
    res.status(result.reused ? 200 : 201).json({ success: true, data: result });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status === 500) console.error("POST /wms/collect-orders/generate:", err.message);
    res.status(status).json(errorEnvelope(err?.code || "COLLECT_GENERATE_FAILED", err.message));
  }
});

// GET /wms/collect-orders?workOrderCode= — active collect order + lines for a WO
// (or latest for all WOs when no filter). Consumed by web issue + PDA collector.
app.get("/wms/collect-orders", requirePermission("wms.view"), async (req, res) => {
  try {
    const woCode = String(req.query.workOrderCode ?? "").trim().toUpperCase();
    const domain = String(req.query.domain ?? "").trim().toUpperCase();
    const assignee = String(req.query.assignee ?? req.query.collector ?? "").trim();
    const validDomains = new Set(["SMT", "MANUAL", "AUTO", "PACKAGING", "AUX", ""]);
    if (!validDomains.has(domain)) return res.status(400).json(errorEnvelope("VALIDATION", `domain must be one of SMT/MANUAL/AUTO/PACKAGING/AUX`));
    if (woCode) {
      // WMS auto-creates the collect list for any released WO on first touch —
      // a work order always has materials to collect, so the PDA/Web never see
      // "no collect list". Errors (no BOM / all picked) fall back to null so the
      // caller can still show a helpful message instead of a 500.
      let found = await resolveCollectOrder(woCode, undefined, undefined, false);
      if (!found) {
        try {
          await ensureCollectOrder(woCode, req.user?.username || "WMS");
          found = await resolveCollectOrder(woCode, undefined, undefined, false);
        } catch (autoErr) {
          console.error("GET /wms/collect-orders auto-generate:", autoErr.message);
        }
      }
      if (!found) return res.json({ success: true, data: { order: null, items: [] } });
      // Line-role collectors only see (and only count) their own domain lines.
      // With ?assignee= only lines allocated to that employee are returned.
      let lines = domain
        ? found.lines.filter((l) => (l.processDomain || "").toUpperCase() === domain)
        : found.lines;
      if (assignee) {
        lines = lines.filter(
          (l) => String(l.assignedTo || "").toUpperCase() === assignee.toUpperCase()
        );
      }
      const order = { ...found.order };
      const collected = lines.filter((l) => l.status === "COLLECTED" || l.status === "ISSUED").length;
      order.domains = [...new Set(found.lines.map((l) => (l.processDomain || "").toUpperCase()).filter(Boolean))];
      return res.json({
        success: true,
        data: {
          order,
          items: lines,
          summary: {
            domain,
            assignee: assignee || null,
            visible: lines.length,
            collected,
            pending: lines.length - collected,
            total: found.lines.length,
          },
        },
      });
    }
    // List = WOs that ALREADY have an active collect list (they need material
    // collection). No batch auto-generation here: a released WO gets its list
    // at release time (see quick-approve-release), so stale/demo WOs never
    // pollute the collector's task list.
    const orders = (await query(
      `SELECT c.id, c.collect_no AS "collectNo", c.work_order_code AS "workOrderCode",
              c.line_code AS "lineCode", c.status, c.collector,
              (SELECT COUNT(*) FROM wms_collect_order_lines l WHERE l.collect_order_id=c.id AND l.status='COLLECTED') AS "collectedLines",
              (SELECT COUNT(*) FROM wms_collect_order_lines l WHERE l.collect_order_id=c.id) AS "totalLines",
              c.collected_at AS "collectedAt", c.created_at AS "createdAt"
         FROM wms_collect_orders c
        WHERE c.status IN ('OPEN','PARTIAL','COLLECTED','ISSUED')
          ${domain ? "AND EXISTS (SELECT 1 FROM wms_collect_order_lines l WHERE l.collect_order_id=c.id AND (l.process_domain=$1 OR COALESCE(l.process_domain,'')='') AND l.status IN ('PENDING','COLLECTED'))" : ""}
        ORDER BY c.id DESC LIMIT 100`,
      domain ? [domain] : []
    )).rows;
    res.json({ success: true, data: { items: orders } });
  } catch (err) {
    console.error("GET /wms/collect-orders:", err.message);
    res.status(500).json(errorEnvelope("COLLECT_LIST_FAILED", err.message));
  }
});

// POST /wms/collect-orders/:id/confirm — the PDA collector scans the storage
// location QR and the material roll/lot to mark one line COLLECTED.
app.post("/wms/collect-orders/:id/confirm", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const orderId = Number(req.params.id);
    const locationQr = String(req.body?.locationQr ?? "").trim();
    const scannedQr = String(req.body?.scannedQr ?? req.body?.scanQr ?? "").trim();
    const lotNo = String(req.body?.lotNo ?? "").trim();
    const lineId = Number(req.body?.lineId ?? 0);
    const confirmAllDomain = String(req.body?.confirmAll ?? req.body?.confirmAllDomain ?? "") === "true";
    // PDA collection actions (server-side enum only — never trust raw status):
    // "confirm" (default, PENDING -> COLLECTED, warehouse staging),
    // "noMaterial" (PENDING -> NO_MATERIAL 缺料),
    // "pick" (COLLECTED -> ISSUED, line-side takeaway from the staging area).
    const rawAction = String(req.body?.action ?? "confirm").toLowerCase();
    const markAction = rawAction === "nomaterial" ? "NO_MATERIAL" : rawAction === "pick" ? "ISSUED" : "COLLECTED";
    const pickMode = markAction === "ISSUED";
    if (!Number.isFinite(orderId)) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "collect order id required")); }
    // Simplified flow: account login is the authority — location/material scans
    // are optional. Either a specific lineId or confirmAll within the user's
    // domain is enough to confirm collection.
    if (!lineId && !confirmAllDomain) {
      await client.query("ROLLBACK");
      return res.status(400).json(errorEnvelope("CONFIRM_TARGET_REQUIRED", "lineId or confirmAll=true required"));
    }

    const order = (await client.query("SELECT id, status, collect_no AS \"collectNo\", work_order_id AS \"workOrderId\", work_order_code AS \"workOrderCode\" FROM wms_collect_orders WHERE id=$1 FOR UPDATE", [orderId])).rows[0];
    if (!order) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("NOT_FOUND", "Collect order not found")); }
    if (order.status === "ACCEPTED" || order.status === "CANCELLED") { await client.query("ROLLBACK"); return res.status(409).json(errorEnvelope("ORDER_CLOSED", `Collect order is ${order.status}`)); }
    if (order.status === "COLLECTED" && !pickMode) { await client.query("ROLLBACK"); return res.status(409).json(errorEnvelope("ALREADY_COLLECTED", "Collect order already completed")); }

    const userDomain = String(req.body?.domain ?? "")
      .toUpperCase() || domainFromUsername(req.user?.username || "");
    const scopedLines = (await client.query(
      `SELECT id, line_no AS "lineNo", material_code AS "materialCode", lot_no AS "lotNo", material_sn AS "materialSn",
              location_code AS "locationCode", location_qr AS "locationQr", required_qty AS "requiredQty", status,
              process_stage AS "processStage", process_domain AS "processDomain",
               assigned_to AS "assignedTo"
         FROM wms_collect_order_lines WHERE collect_order_id=$1 AND status IN (${pickMode ? "'COLLECTED'" : "'PENDING'" + (markAction === "COLLECTED" ? ",'NO_MATERIAL'" : "")}) ORDER BY line_no`, [orderId]
    )).rows.filter((l) => {
      // Untagged lines (no process domain yet) stay visible to every
      // collector; tagged lines are restricted to their own domain.
      const d = (l.processDomain || "").trim().toUpperCase();
      return !userDomain || !d || d === userDomain;
    });

    const operator = req.user?.username || "PDA_COLLECTOR";
    const operatorId = req.user?.userId ?? null;
    // PICK = material leaves the warehouse → post an ISSUE_TO_LINE stock
    // transaction (inventory is derived from transactions, never a balance).
    // One txn per collect line; skips when the pick was already deducted.
    const postPickDeduction = async (line) => {
      if (markAction !== "ISSUED") return null;
      const refNo = `CL:${order.collectNo}:L${line.lineNo}`;
      const exists = (await client.query(
        `SELECT 1 FROM inventory_transactions WHERE reference_type='WMS_PICK' AND reference_no=$1 LIMIT 1`, [refNo]
      )).rowCount;
      if (exists) return null;
      const ded = (await client.query(
        `SELECT id, is_test FROM material_lots WHERE lot_no = $1 AND lot_status <> 'voided' ORDER BY id LIMIT 1`, [line.lotNo]
      )).rows[0];
      // Lines without a tracked lot (aux/consumables not in stock) carry no
      // inventory — record the issue without a stock deduction.
      if (!ded) return null;
      const txNo = `TXN-ISSUE-${orderId}-${line.id}-${Date.now()}`;
      const ins = await client.query(
        `INSERT INTO inventory_transactions
           (tx_no, action, material_lot_id, work_order_id, qty, operator_id, occurred_at, tx_status, voided,
            reference_type, reference_no, is_test)
         VALUES ($1,'ISSUE_TO_LINE',$2,$3,$4,$5,NOW(),'posted',false,'WMS_PICK', $6, $7)
         RETURNING id, action, qty, is_test`,
        [txNo, ded?.id ?? null, order.workOrderId ?? null, line.requiredQty, operatorId,
         refNo, ded?.is_test === true]
      );
      return ins.rows[0] ?? null;
    };
    // Staging touches collected_by/at; picking (takeaway) touches picked_by/at
    // so the stager's signature is never overwritten by the picker.
    const touchCols = pickMode ? "picked_by=$2, picked_at=NOW()" : "collected_by=$2, collected_at=NOW()";
    // Lines allocated to a specific employee may only be confirmed by that
    // employee; unassigned lines stay open for anyone in the domain.
    const ownedByOther = (l) =>
      l.assignedTo && String(l.assignedTo).toUpperCase() !== String(operator).toUpperCase();
    const updated = [];
    const skipped = [];
    // Collection must be confirmed line by line — one-tap complete-all is
    // forbidden on the staging side (it lives on the picking PDA only).
    if (confirmAllDomain && markAction === "COLLECTED") {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("ONE_CLICK_NOT_ALLOWED", "Collection must be confirmed line by line"));
    }
    if (confirmAllDomain) {
      // Pick mode: any line PDA may take every staged line (assigned_to only
      // matters for the staging side). Collect mode: only own/unassigned lines.
      const mine = pickMode ? scopedLines : scopedLines.filter((l) => !ownedByOther(l));
      if (mine.length === 0) {
        await client.query("ROLLBACK");
        return res.status(409).json(errorEnvelope(scopedLines.length ? "CLAIMED_BY_OTHER" : "DOMAIN_SCOPED",
          scopedLines.length
            ? `All ${scopedLines.length} ${pickMode ? "staged" : "pending"} line(s) are allocated to other collectors`
            : `You are scoped to ${userDomain || "ALL"} lines; none ${pickMode ? "staged" : "pending"} here`));
      }
      for (const l of scopedLines) {
        if (!pickMode && ownedByOther(l)) { skipped.push({ id: l.id, lineNo: l.lineNo, assignedTo: l.assignedTo }); continue; }
        // One-tap collect must never sweep lines already flagged 缺料 —
        // missing material needs purchasing, not a blind confirm.
        if (l.status === "NO_MATERIAL" && markAction === "COLLECTED") { skipped.push({ id: l.id, lineNo: l.lineNo, reason: "NO_MATERIAL" }); continue; }
        const upd = (await client.query(
          `UPDATE wms_collect_order_lines SET status='${markAction}', ${touchCols}, updated_at=NOW(),
                  assigned_to=COALESCE(assigned_to,$2), assigned_at=COALESCE(assigned_at,NOW())
            WHERE id=$1 RETURNING id, line_no AS "lineNo", material_code AS "materialCode", status`,
          [l.id, operator]
        )).rows[0];
        if (upd) { updated.push(upd); if (pickMode) await postPickDeduction(l); }
      }
    } else {
      const target = scopedLines.find((l) => Number(l.id) === lineId);
      if (!target) {
        await client.query("ROLLBACK");
        return res.status(404).json(errorEnvelope("LINE_NOT_FOUND", `No ${pickMode ? "staged" : "pending"} ${userDomain || ""} line matches lineId ${lineId}`));
      }
      if (!pickMode && ownedByOther(target)) {
        await client.query("ROLLBACK");
        return res.status(409).json(errorEnvelope("CLAIMED_BY_OTHER", `Line ${target.lineNo} (${target.materialCode}) is allocated to ${target.assignedTo}`));
      }
      const upd = (await client.query(
        `UPDATE wms_collect_order_lines SET status='${markAction}', ${touchCols}, updated_at=NOW(),
                assigned_to=COALESCE(assigned_to,$2), assigned_at=COALESCE(assigned_at,NOW())
          WHERE id=$1 RETURNING id, line_no AS "lineNo", material_code AS "materialCode", status`,
        [target.id, operator]
      )).rows[0];
      if (upd)       updated.push(upd);
      if (pickMode) await postPickDeduction(target);
    }

    const remaining = (await client.query("SELECT COUNT(*)::int AS n FROM wms_collect_order_lines WHERE collect_order_id=$1 AND status='PENDING'", [orderId])).rows[0].n;
    const remainingReady = (await client.query("SELECT COUNT(*)::int AS n FROM wms_collect_order_lines WHERE collect_order_id=$1 AND status='COLLECTED'", [orderId])).rows[0].n;
    // Staging actions: all COLLECTED -> COLLECTED (READY announcement fires
    // below); nothing PENDING but some 缺料 -> PARTIAL (needs attention).
    // Pick action: nothing staged left to take -> ISSUED.
    let nextStatus;
    if (pickMode) {
      nextStatus = remainingReady === 0 ? "ISSUED" : "PARTIAL";
    } else {
      nextStatus = remaining === 0 ? "COLLECTED" : "PARTIAL";
      if (remaining === 0) {
        const noMat = (await client.query("SELECT COUNT(*)::int AS n FROM wms_collect_order_lines WHERE collect_order_id=$1 AND status='NO_MATERIAL'", [orderId])).rows[0].n;
        if (noMat > 0) nextStatus = "PARTIAL";
      }
    }
    await client.query(
      `UPDATE wms_collect_orders SET status=$2::varchar, collector=COALESCE(collector,$3::varchar), collected_at=CASE WHEN $2='COLLECTED' THEN NOW() ELSE collected_at END, updated_at=NOW() WHERE id=$1`,
      [orderId, nextStatus, operator]
    );
    // Whole WO fully collected → announce "materials ready to pick" to the line.
    // Announcement is append-only history (one per collect order completion).
    if (nextStatus === "COLLECTED") {
      const orderInfo = (await client.query(
        `SELECT c.work_order_code AS "woCode", c.collect_no AS "collectNo", c.line_code AS "lineCode"
           FROM wms_collect_orders c WHERE c.id=$1`, [orderId]
      )).rows[0];
      if (orderInfo) {
        await client.query(
          `INSERT INTO wms_issue_announcements (wo_code, line_code, collect_no, message, status)
           VALUES ($1,$2,$3,$4,'READY')
           ON CONFLICT DO NOTHING`,
          [orderInfo.woCode, orderInfo.lineCode || null, orderInfo.collectNo,
           `工单 ${orderInfo.woCode} 物料已全部集齐，可发料上线（${orderInfo.collectNo}）`]
        );
      }
    }
    await client.query("COMMIT");
    // 缺料 selected -> warn the warehouse manager for handling: one
    // SHORTAGE_ALERT task per line (deduped, so re-marks never spam).
    if (markAction === "NO_MATERIAL" && updated.length) {
      try {
        const info = (await query(`SELECT work_order_code AS "wo", collect_no AS "no" FROM wms_collect_orders WHERE id=$1`, [orderId])).rows[0];
        const recipients = ["VN_WM_001", "MENG_YING", "MO_LI_BIN"];
        for (const u of updated) {
          await query(
            `INSERT INTO factory_virtual_employee_tasks(task_key,employee_id,task_type,title,domain,status,priority,input,requested_by)
             VALUES($1,'WMS-INVENTORY-VIRTUAL-01','SHORTAGE_ALERT',$2,'wms','OPEN','HIGH',$3::jsonb,$4)
             ON CONFLICT(task_key) WHERE task_key IS NOT NULL DO NOTHING`,
            [`SHORTAGE:${orderId}:${u.id}`, `缺料待处理：${info?.wo} ${u.materialCode}（${info?.no} L${u.lineNo}）`,
             JSON.stringify({ wo: info?.wo, slipNo: info?.no, lineId: u.id, lineNo: u.lineNo, materialCode: u.materialCode, markedBy: operator, markedAt: new Date().toISOString(), recipients }), operator]);
        }
        // Push to warehouse manager + plant managers (蒙营/莫立斌) via WeCom.
        const first = updated[0];
        await sendVirtualEmployeeWechat({
          employeeId: "WMS-INVENTORY-VIRTUAL-01",
          subject: `缺料告警 ${info?.wo} ${first.materialCode}等${updated.length}项`,
          message: `集料员${operator}上报缺料，请仓库主管(VN_WM_001)组织处理，并同步厂长蒙营、莫立斌。单据${info?.no}。`,
          entityRef: info?.no,
          priority: "WARNING",
        });
      } catch (warnErr) { console.error("SHORTAGE_ALERT task:", warnErr.message); }
    }
    res.json({ success: true, data: { orderId, status: nextStatus, confirmed: updated, skipped, remaining } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/collect-orders/:id/confirm:", err.message);
    res.status(500).json(errorEnvelope("COLLECT_CONFIRM_FAILED", err.message));
  } finally { client.release(); }
});

// POST /wms/collect-orders/:id/accept — WMS confirms acceptance of a fully-picked
// order and finishes the WO material flow. Production picking happens on the PDA
// (Material Picking screen: lines → COLLECTED, READY announcement); the WMS
// operator then closes the loop here from the slips page 验收 button.
// Terminal action: only when NO PENDING lines remain; idempotent on re-accept.
app.post("/wms/collect-orders/:id/accept", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const orderId = Number(req.params.id);
    if (!Number.isFinite(orderId)) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "collect order id required")); }
    const order = (await client.query(
      `SELECT id, collect_no AS "collectNo", work_order_code AS "workOrderCode", status,
              accepted_by AS "acceptedBy", accepted_at AS "acceptedAt"
         FROM wms_collect_orders WHERE id=$1 FOR UPDATE`, [orderId]
    )).rows[0];
    if (!order) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("NOT_FOUND", "Collect order not found")); }
    if (order.status === "ACCEPTED") {
      await client.query("ROLLBACK");
      return res.json({ success: true, data: { orderId, status: "ACCEPTED", already: true, acceptedBy: order.acceptedBy, acceptedAt: order.acceptedAt } });
    }
    if (order.status === "CANCELLED") { await client.query("ROLLBACK"); return res.status(409).json(errorEnvelope("ORDER_CANCELLED", "Collect order is cancelled")); }
    const notPicked = (await client.query(
      "SELECT COUNT(*)::int AS n FROM wms_collect_order_lines WHERE collect_order_id=$1 AND status IN ('PENDING','COLLECTED')", [orderId]
    )).rows[0].n;
    if (notPicked > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("NOT_FULLY_PICKED", `${notPicked} line(s) not yet picked (PENDING/COLLECTED) — production picking is not finished`));
    }
    const acceptor = req.user?.username || "WMS";
    const done = (await client.query(
      `UPDATE wms_collect_orders SET status='ACCEPTED', accepted_by=$2, accepted_at=NOW(), updated_at=NOW()
        WHERE id=$1
        RETURNING id, collect_no AS "collectNo", work_order_code AS "workOrderCode",
                  status, accepted_by AS "acceptedBy", accepted_at AS "acceptedAt"`,
      [orderId, acceptor]
    )).rows[0];
    await client.query("COMMIT");
    res.json({ success: true, data: done });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/collect-orders/:id/accept:", err.message);
    res.status(500).json(errorEnvelope("COLLECT_ACCEPT_FAILED", err.message));
  } finally { client.release(); }
});

// ── WMS live tracking of PDA material collection: the most recent line-level
// actions (collected / 缺料) across all orders, newest first — who picked what,
// when, on which slip. Polled by the WMS slips live tab every few seconds.
app.get("/wms/collect-activity", requirePermission("wms.view"), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 30) || 30, 1), 100);
    const feed = (await query(
      `SELECT COALESCE(l.picked_at, l.collected_at) AS "at",
              COALESCE(CASE WHEN l.status = 'ISSUED' THEN l.picked_by END, l.collected_by) AS "by", l.status,
              o.collect_no AS "slipNo", o.work_order_code AS "workOrderCode",
              l.material_code AS "materialCode", l.required_qty AS "qty",
              l.lot_no AS "lotNo", l.location_qr AS "locationQr"
         FROM wms_collect_order_lines l
         JOIN wms_collect_orders o ON o.id = l.collect_order_id
        WHERE l.collected_at IS NOT NULL
        ORDER BY l.collected_at DESC, l.id DESC
        LIMIT $1`, [limit]
    )).rows;
    const active = (await query(
      `SELECT o.id, o.collect_no AS "slipNo", o.work_order_code AS "workOrderCode",
              o.status, o.collector AS "collector",
              COUNT(l.id)::int AS "totalLines",
              COUNT(l.id) FILTER (WHERE l.status IN ('COLLECTED','ISSUED'))::int AS "doneLines",
              MAX(l.collected_at) AS "lastAt",
              (SELECT string_agg(DISTINCT x.collected_by, ', ')
                 FROM wms_collect_order_lines x
                WHERE x.collect_order_id = o.id AND x.collected_by IS NOT NULL) AS "pickers"
         FROM wms_collect_orders o
         LEFT JOIN wms_collect_order_lines l ON l.collect_order_id = o.id
        WHERE o.status IN ('OPEN','PARTIAL','COLLECTED','ISSUED')
        GROUP BY o.id
        ORDER BY MAX(l.collected_at) DESC NULLS LAST, o.id DESC
        LIMIT 50`
    )).rows;
    res.json({ success: true, data: { feed, active } });
  } catch (err) {
    console.error("GET /wms/collect-activity:", err.message);
    res.status(500).json(errorEnvelope("COLLECT_ACTIVITY_FAILED", err.message));
  }
});

// ── 厂长指派工段领料员 (plant manager assigns an employee to a 工段 picker
// role). 集料员 has no 工段 limit; pickers are segmented SMT/AUTO/MANUAL/
// PACKAGING. One person may hold MULTIPLE roles (user_roles) — assigning ADDS
// the picker role without removing existing ones; revoke removes one role.
app.post("/wms/assign-picker-role", requirePermission("admin.users"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const username = String(req.body?.username ?? "").trim().toUpperCase();
    const segment = String(req.body?.segment ?? "").trim().toUpperCase(); // SMT|AUTO|MANUAL|PACKAGING
    const PICKER_ROLES = {
      SMT: "material_picker_smt",
      AUTO: "material_picker_auto",
      MANUAL: "material_picker_man",
      MAN: "material_picker_man",
      PACKAGING: "material_picker_packaging",
    };
    const targetRoleCode = PICKER_ROLES[segment];
    if (!targetRoleCode) {
      await client.query("ROLLBACK");
      return res.status(400).json(errorEnvelope("VALIDATION", "segment must be SMT/AUTO/MANUAL/PACKAGING"));
    }
    const user = (await client.query(
      `SELECT u.id, u.username, u.display_name, r.code AS "roleCode", r.name_zh AS "roleName"
         FROM users u JOIN roles r ON r.id = u.role_id WHERE UPPER(u.username) = $1`, [username]
    )).rows[0];
    if (!user) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("NOT_FOUND", `Employee login '${username}' not found`)); }
    const role = (await client.query("SELECT id, code FROM roles WHERE code=$1", [targetRoleCode])).rows[0];
    if (!role) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("NOT_FOUND", `Picker role ${targetRoleCode} not found`)); }
    const actor = req.user?.username || "PLANT_MANAGER";
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, role_id) DO NOTHING`, [user.id, role.id, actor]
    );
    const allRoles = (await client.query(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.code`, [user.id]
    )).rows.map((x) => x.code);
    await client.query(
      `INSERT INTO factory_virtual_employee_events (employee_id, event_type, detail, actor)
       VALUES ($1,'PICKER_ROLE_ASSIGNED',$2::jsonb,$3)`,
      [WAREHOUSE_INVENTORY_EMPLOYEE_ID, JSON.stringify({
        username, displayName: user.display_name,
        addedRole: targetRoleCode, segment, allRoles,
        assignedBy: actor, at: new Date().toISOString(),
      }), actor]
    );
    await client.query("COMMIT");
    res.json({ success: true, data: { username, displayName: user.display_name, addedRole: targetRoleCode, segment, allRoles, assignedBy: actor } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/assign-picker-role:", err.message);
    res.status(500).json(errorEnvelope("PICKER_ASSIGN_FAILED", err.message));
  } finally { client.release(); }
});

// GET /wms/user-roles?username= — all roles a person holds (multi-role view).
app.get("/wms/user-roles", requirePermission("admin.users"), async (req, res) => {
  try {
    const username = String(req.query.username ?? "").trim().toUpperCase();
    const base = await query(
      `SELECT u.id, u.username, u.display_name, r.code AS "primaryRole"
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE ($1 = '' OR UPPER(u.username) LIKE '%' || $1 || '%')
        ORDER BY u.username LIMIT 50`, [username]
    );
    const out = [];
    for (const u of base.rows) {
      const roles = (await query(
        `SELECT r.code AS "roleKey", r.name_zh AS "nameZh", ur.is_primary AS "isPrimary", ur.granted_at AS "grantedAt"
           FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 ORDER BY ur.is_primary DESC, r.code`, [u.id]
      )).rows;
      out.push({ ...u, roles: roles.length ? roles : [{ roleKey: u.primaryRole, isPrimary: true }] });
    }
    res.json({ success: true, data: { items: out } });
  } catch (err) {
    console.error("GET /wms/user-roles:", err.message);
    res.status(500).json(errorEnvelope("USER_ROLES_FAILED", err.message));
  }
});

// POST /wms/user-roles/revoke — remove one role from a person (multi-role).
app.post("/wms/user-roles/revoke", requirePermission("admin.users"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const username = String(req.body?.username ?? "").trim().toUpperCase();
    const roleCode = String(req.body?.roleCode ?? "").trim().toLowerCase();
    if (!username || !roleCode) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "username + roleCode required")); }
    const user = (await client.query("SELECT id FROM users WHERE UPPER(username)=$1", [username])).rows[0];
    if (!user) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("NOT_FOUND", "user not found")); }
    // Never revoke the last role — the legacy users.role_id keeps the person
    // logged in; only user_roles extra rows are removable.
    const kept = (await client.query(
      `SELECT COUNT(*)::int n FROM user_roles WHERE user_id=$1 AND role_id <> (SELECT role_id FROM users WHERE id=$1)`, [user.id]
    )).rows[0].n;
    const del = (await client.query(
      `DELETE FROM user_roles WHERE user_id=$1 AND role_id=(SELECT id FROM roles WHERE code=$2)
       RETURNING role_id`, [user.id, roleCode]
    )).rowCount;
    await client.query("COMMIT");
    res.json({ success: true, data: { username, roleCode, revoked: del, extraRolesRemaining: Math.max(kept - del, 0) } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/user-roles/revoke:", err.message);
    res.status(500).json(errorEnvelope("USER_ROLES_REVOKE_FAILED", err.message));
  } finally { client.release(); }
});

// ── WMS collector roster: eligible warehouse collectors for line allocation.// Derived from users in collector-capable roles (warehouse / material_collector*).
app.get("/wms/collectors", requirePermission("wms.view"), async (req, res) => {
  try {
    const rows = (await query(
      `SELECT u.username AS "username", u.display_name AS "displayName", r.code AS "roleCode",
              (SELECT COUNT(*)::int FROM wms_collect_order_lines l
                WHERE UPPER(l.assigned_to) = UPPER(u.username) AND l.status = 'PENDING') AS "pendingAssigned"
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.status = 'active' AND r.code IN ('warehouse', 'material_collector', 'material_collector_smt', 'material_collector_auto', 'material_collector_man')
        ORDER BY u.username`
    )).rows.map((u) => ({ ...u, domain: domainFromUsername(u.username) || "ALL" }));
    res.json({ success: true, data: { items: rows } });
  } catch (err) {
    console.error("GET /wms/collectors:", err.message);
    res.status(500).json(errorEnvelope("COLLECTORS_LIST_FAILED", err.message));
  }
});

// POST /wms/collect-orders/:id/assign — allocate pending lines to specific
// employees. Manual: { assignments: [{ lineId, assignee }] }.
// Auto: { assignees: ["VN_WC_SMT", ...] } distributes this order's still
// unassigned PENDING lines across the collectors, ordered by location so each
// person walks one contiguous area; each assignee only receives lines inside
// their own process domain when they have one.
app.post("/wms/collect-orders/:id/assign", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const orderId = Number(req.params.id);
    if (!Number.isFinite(orderId)) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "collect order id required")); }
    const order = (await client.query("SELECT id, status FROM wms_collect_orders WHERE id=$1 FOR UPDATE", [orderId])).rows[0];
    if (!order) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("NOT_FOUND", "Collect order not found")); }
    if (order.status === "COLLECTED" || order.status === "ISSUED") {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("ORDER_CLOSED", "Collect order already completed"));
    }
    const by = req.user?.username || "WMS";
    const assigned = [];
    // SECTION CLAIM (工段认领): { section: "SMT" } assigns EVERY unassigned
    // PENDING line of that process section to the requesting PDA — one PDA
    // collects one whole 工段 together. Sections already owned by someone else
    // are refused (claim conflict) so two PDAs never split one section.
    const sectionClaim = String(req.body?.section ?? "").trim().toUpperCase();
    if (sectionClaim) {
      const mine = req.user?.username || by;
      const sectionLines = (await client.query(
        `SELECT l.id, l.line_no, l.process_domain, l.assigned_to
           FROM wms_collect_order_lines l
          WHERE l.collect_order_id=$1 AND l.status='PENDING'
            AND UPPER(COALESCE(l.process_domain,'UNSCOPED')) = $2
          FOR UPDATE OF l SKIP LOCKED`, [orderId, sectionClaim]
      )).rows;
      if (!sectionLines.length) {
        await client.query("ROLLBACK");
        return res.status(404).json(errorEnvelope("SECTION_EMPTY", `No pending lines in section ${sectionClaim}`));
      }
      const owner = sectionLines.find((l) => l.assigned_to && l.assigned_to !== mine)?.assigned_to;
      if (owner) {
        await client.query("ROLLBACK");
        return res.status(409).json(errorEnvelope("SECTION_CLAIMED", `Section ${sectionClaim} already claimed by ${owner}`));
      }
      for (const l of sectionLines) {
        const upd = (await client.query(
          "UPDATE wms_collect_order_lines SET assigned_to=$2, assigned_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING id, line_no AS \"lineNo\", assigned_to AS \"assignedTo\"",
          [l.id, mine]
        )).rows[0];
        if (upd) assigned.push(upd);
      }
      await client.query("COMMIT");
      return res.json({ success: true, data: { orderId, section: sectionClaim, claimedBy: mine, claimed: assigned.length, assigned } });
    }
    const manual = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    if (manual.length) {
      for (const a of manual) {
        const lineId = Number(a.lineId);
        const assignee = String(a.assignee || "").trim().toUpperCase();
        if (!Number.isFinite(lineId)) {
          await client.query("ROLLBACK");
          return res.status(400).json(errorEnvelope("VALIDATION", "each assignment requires lineId"));
        }
        if (!assignee) {
          // Release the claim on this line (back to the unassigned pool).
          await client.query("UPDATE wms_collect_order_lines SET assigned_to=NULL, assigned_at=NULL, updated_at=NOW() WHERE id=$1 AND collect_order_id=$2", [lineId, orderId]);
          assigned.push({ id: lineId, released: true });
          continue;
        }
        const line = (await client.query(
          "SELECT id, status, process_domain, assigned_to FROM wms_collect_order_lines WHERE id=$1 AND collect_order_id=$2 FOR UPDATE",
          [lineId, orderId]
        )).rows[0];
        if (!line) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("LINE_NOT_FOUND", `Line ${lineId} not in this order`)); }
        if (line.status !== "PENDING") { await client.query("ROLLBACK"); return res.status(409).json(errorEnvelope("LINE_CLOSED", `Line ${lineId} already ${line.status}`)); }
        if (line.assigned_to && line.assigned_to !== assignee) {
          await client.query("ROLLBACK");
          return res.status(409).json(errorEnvelope("LINE_CLAIMED", `Line ${lineId} already claimed by ${line.assigned_to}`));
        }
        const upd = (await client.query(
          "UPDATE wms_collect_order_lines SET assigned_to=$2, assigned_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING id, line_no AS \"lineNo\", assigned_to AS \"assignedTo\"",
          [lineId, assignee]
        )).rows[0];
        assigned.push(upd);
      }
    } else {
      // Auto-allocate: explicit assignees[] wins; otherwise WMS dynamically
      // distributes across the collectors already active on this order
      // (claimed or collected lines) plus the requesting PDA itself.
      let assignees = (Array.isArray(req.body?.assignees) ? req.body.assignees : [])
        .map((u) => String(u || "").trim().toUpperCase())
        .filter(Boolean);
      if (!assignees.length) {
        const act = (await client.query(
          `SELECT DISTINCT UPPER(COALESCE(assigned_to, collected_by)) AS u
             FROM wms_collect_order_lines WHERE collect_order_id=$1
             AND COALESCE(assigned_to, collected_by) IS NOT NULL`, [orderId]
        )).rows.map((r) => r.u).filter(Boolean);
        const me = String(req.user?.username || "").trim().toUpperCase();
        assignees = [...new Set([...act, me])].filter(Boolean);
      }
      if (!assignees.length) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "assignees[] or assignments[] required")); }
      const open = (await client.query(
        `SELECT l.id, l.line_no, l.process_domain, l.location_code, s.x_coord, s.y_coord
           FROM wms_collect_order_lines l
           LEFT JOIN storage_locations s ON s.code = l.location_code
          WHERE l.collect_order_id=$1 AND l.status='PENDING' AND l.assigned_to IS NULL
          ORDER BY COALESCE(s.y_coord, 1e9), COALESCE(s.x_coord, 1e9), l.location_code, l.line_no
          FOR UPDATE OF l SKIP LOCKED`, [orderId]
      )).rows;
      const buckets = new Map(assignees.map((u) => [u, []]));
      // SECTION RULE (工段一起集): materials of ONE process section must be
      // collected together — never split across collectors. We bucket lines by
      // process_domain FIRST (domain order preserved), then hand each whole
      // section bucket to ONE eligible collector (domain match, else any
      // full-scope 集料员). Inside a bucket lines stay location-sorted so the
      // collector still walks one continuous route through that section's
      // shelves. Sections are load-balanced: biggest section first, then the
      // least-loaded eligible collector takes the next whole section.
      const sectionBuckets = new Map(); // domain -> [lines]
      for (const line of open) {
        const d = String(line.process_domain || "UNSCOPED").toUpperCase();
        if (!sectionBuckets.has(d)) sectionBuckets.set(d, []);
        sectionBuckets.get(d).push(line);
      }
      const eligibleFor = (line) => {
        const lineDomain = String(line.process_domain || "").toUpperCase();
        let el = assignees.filter((u) => domainFromUsername(u) === lineDomain);
        if (!el.length) el = assignees.filter((u) => !domainFromUsername(u));
        return el;
      };
      const sortedSections = [...sectionBuckets.entries()].sort(
        (a, b) => b[1].length - a[1].length
      );
      for (const [, lines] of sortedSections) {
        const candidate = eligibleFor(lines[0]);
        if (!candidate.length) continue; // no collector may take this section
        candidate.sort((a, b) => buckets.get(a).length - buckets.get(b).length);
        const owner = candidate[0];
        for (const line of lines) buckets.get(owner).push(line);
      }
      for (const [assignee, lines] of buckets) {
        for (const line of lines) {
          const upd = (await client.query(
            "UPDATE wms_collect_order_lines SET assigned_to=$2, assigned_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING id, line_no AS \"lineNo\", assigned_to AS \"assignedTo\"",
            [line.id, assignee]
          )).rows[0];
          if (upd) assigned.push(upd);
        }
      }
    }
    await client.query("COMMIT");
    res.json({ success: true, data: { orderId, assigned, assignedBy: by } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/collect-orders/:id/assign:", err.message);
    res.status(500).json(errorEnvelope("COLLECT_ASSIGN_FAILED", err.message));
  } finally { client.release(); }
});

// ── 缺料应急处理 (shortage emergency handling): every NO_MATERIAL line across
// all orders — material code + qty + WO/slip/location/marker — for the WMS
// 缺料应急 page and the warehouse-manager PDA 缺料处理 page.
app.get("/wms/shortages", requirePermission("wms.view"), async (req, res) => {
  try {
    const onlyOpen = String(req.query.open ?? "1") !== "0";
    const rows = (await query(
      `SELECT l.id AS "lineId", l.line_no AS "lineNo", l.material_code AS "materialCode",
              l.required_qty AS "qty", l.lot_no AS "lotNo",
              l.location_code AS "locationCode", l.location_qr AS "locationQr",
              l.collected_by AS "markedBy", l.collected_at AS "markedAt",
              o.collect_no AS "slipNo", o.work_order_code AS "workOrderCode",
              (SELECT t.status FROM factory_virtual_employee_tasks t
                WHERE t.task_key = 'SHORTAGE:' || o.id || ':' || l.id
                ORDER BY t.id DESC LIMIT 1) AS "taskStatus"
         FROM wms_collect_order_lines l
         JOIN wms_collect_orders o ON o.id = l.collect_order_id
        WHERE l.status = 'NO_MATERIAL'
          ${onlyOpen ? "AND NOT EXISTS (SELECT 1 FROM factory_virtual_employee_tasks t WHERE t.task_key = 'SHORTAGE:' || o.id || ':' || l.id AND t.status IN ('RESOLVED','CLOSED','CANCELLED'))" : ""}
        ORDER BY l.collected_at DESC NULLS LAST, l.id DESC
        LIMIT 200`
    )).rows;
    res.json({ success: true, data: { items: rows } });
  } catch (err) {
    console.error("GET /wms/shortages:", err.message);
    res.status(500).json(errorEnvelope("SHORTAGES_FAILED", err.message));
  }
});

// POST /wms/shortages/:lineId/resolve — warehouse manager handled the
// shortage (replenished / substituted): line back to PENDING for collection,
// alert task closed. Idempotent.
app.post("/wms/shortages/:lineId/resolve", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const lineId = Number(req.params.lineId);
    if (!Number.isFinite(lineId)) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "line id required")); }
    const line = (await client.query(
      `SELECT l.id, l.line_no AS "lineNo", l.material_code AS "materialCode", l.status, l.collect_order_id AS "orderId",
              o.collect_no AS "slipNo", o.work_order_code AS "workOrderCode"
         FROM wms_collect_order_lines l JOIN wms_collect_orders o ON o.id = l.collect_order_id
        WHERE l.id = $1 FOR UPDATE`, [lineId]
    )).rows[0];
    if (!line) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("NOT_FOUND", "Shortage line not found")); }
    if (line.status !== "NO_MATERIAL") { await client.query("ROLLBACK"); return res.json({ success: true, data: { ...line, already: line.status } }); }
    const actor = req.user?.username || "WAREHOUSE_MANAGER";
    const upd = (await client.query(
      `UPDATE wms_collect_order_lines SET status='PENDING', collected_by=NULL, collected_at=NULL, updated_at=NOW()
        WHERE id=$1 RETURNING id, line_no AS "lineNo", material_code AS "materialCode", status`,
      [lineId]
    )).rows[0];
    // The order keeps whatever progress status it has (confirm endpoint owns
    // status transitions); resolving only requeues this line for collection.
    await client.query(
      `UPDATE factory_virtual_employee_tasks SET status='RESOLVED', updated_at=NOW()
        WHERE task_key=$1 AND status NOT IN ('RESOLVED','CLOSED','CANCELLED')`,
      [`SHORTAGE:${line.orderId}:${lineId}`]
    );
    await client.query("COMMIT");
    res.json({ success: true, data: { ...upd, workOrderCode: line.workOrderCode, slipNo: line.slipNo, resolvedBy: actor } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/shortages/:lineId/resolve:", err.message);
    res.status(500).json(errorEnvelope("SHORTAGE_RESOLVE_FAILED", err.message));
  } finally { client.release(); }
});

// ── WMS Slips ledger: 发料单 (material collect/issue orders) and 收料单
// (line pick acceptance) in one place, so the WMS page shows the whole
// material-issue history with the real actors and timestamps.
app.get("/wms/slips", requirePermission("wms.view"), async (req, res) => {
  try {
    const woCode = String(req.query.workOrderCode ?? "").trim().toUpperCase();
    const kind = String(req.query.kind ?? "").trim().toUpperCase(); // COLLECT | ACCEPT
    const woCond = woCode ? " AND work_order_code = $1" : "";
    const params = woCode ? [woCode] : [];

    // 发料单: collect orders with per-line progress (发料员 = collector/collected_by).
    const collectOrders = (await query(
      `SELECT c.id, c.collect_no AS "slipNo", c.work_order_code AS "workOrderCode",
              c.line_code AS "lineCode", c.status, c.process_domain AS "domain",
              c.created_by AS "raisedBy", c.created_at AS "raisedAt",
              c.collector AS "collectedBy", c.collected_at AS "collectedAt",
              c.accepted_by AS "acceptedBy", c.accepted_at AS "acceptedAt",
              (SELECT string_agg(DISTINCT u, ', ')
                 FROM (SELECT l2.collected_by AS u FROM wms_collect_order_lines l2
                        WHERE l2.collect_order_id = c.id AND l2.collected_by IS NOT NULL
                       UNION
                       SELECT l2.picked_by FROM wms_collect_order_lines l2
                        WHERE l2.collect_order_id = c.id AND l2.picked_by IS NOT NULL) t) AS "pickers",
              COUNT(l.id)::int AS "lineCount",
              COUNT(l.id) FILTER (WHERE l.status IN ('COLLECTED','ISSUED'))::int AS "doneLines",
              COUNT(l.id) FILTER (WHERE l.status = 'ISSUED')::int AS "issuedLines"
         FROM wms_collect_orders c
         LEFT JOIN wms_collect_order_lines l ON l.collect_order_id = c.id
        WHERE c.status IN ('OPEN','PARTIAL','COLLECTED','ISSUED','ACCEPTED') ${woCond}
        GROUP BY c.id ORDER BY c.id DESC LIMIT 100`, params
    )).rows;

    // 收料单: pick acceptances signed by the line (收料人 = operator).
    const acceptances = (await query(
      `SELECT a.id, ('ACC-' || a.id) AS "slipNo", a.wo_code AS "workOrderCode",
              a.operator AS "receivedBy", a.item_count AS "itemCount",
              a.accepted_at AS "receivedAt", a.notes,
              COALESCE(a.items, '[]'::jsonb) AS "items",
              (SELECT string_agg(l.material_code || ':' || l.qty, ', ')
                 FROM jsonb_to_recordset(a.items) AS l(material_code text, qty numeric)) AS "lineSummary"
         FROM wms_pick_acceptance a
        WHERE 1=1 ${woCode ? " AND a.wo_code = $1" : ""}
        ORDER BY a.id DESC LIMIT 100`,
      params
    )).rows;

    let payload = {};
    if (kind === "COLLECT" || kind === "") payload.collectOrders = collectOrders;
    if (kind === "ACCEPT" || kind === "") payload.acceptances = acceptances;
    // Reporting ledger: flattened issue + acceptance sheets (append-only).
    const ledger = (await query(
      `SELECT sheet_type AS "sheetType", sheet_no AS "sheetNo", wo_code AS "woCode", line_code AS "lineCode",
              sheet_status AS "sheetStatus", raised_by AS "raisedBy", raised_at AS "raisedAt",
              picked_by AS "pickedBy", collected_at AS "collectedAt",
              line_count AS "lineCount", collected_count AS "collectedCount", issued_count AS "issuedCount"
         FROM wms_issue_sheet_ledger
        ${woCode ? "WHERE wo_code = $1" : ""}
        ORDER BY raised_at DESC LIMIT 500`, woCode ? [woCode] : []
    )).rows;
    payload.ledger = ledger;
    res.json({ success: true, data: payload });
  } catch (err) {
    console.error("GET /wms/slips:", err.message);
    res.status(500).json(errorEnvelope("SLIPS_LIST_FAILED", err.message));
  }
});

// ── WO material-pick announcements: emitted when a WO's whole collect order is
// done. Line picker PDA / display board poll or subscribe for "ready to issue".
app.get("/wms/issue-announcements", requirePermission("wms.view"), async (req, res) => {
  try {
    const woCode = String(req.query.workOrderCode ?? "").trim().toUpperCase();
    const lineCode = String(req.query.lineCode ?? "").trim().toUpperCase();
    const where = [];
    const params = [];
    if (woCode) { params.push(woCode); where.push(`UPPER(wo_code) = $${params.length}`); }
    if (lineCode) { params.push(lineCode); where.push(`UPPER(COALESCE(line_code,'')) = $${params.length}`); }
    const rows = (await query(
      `SELECT id, wo_code AS "woCode", line_code AS "lineCode", collect_no AS "collectNo",
              message, status, acked_by AS "ackedBy", acked_at AS "ackedAt", announced_at AS "announcedAt"
         FROM wms_issue_announcements
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY id DESC LIMIT 100`, params
    )).rows;
    res.json({ success: true, data: { items: rows } });
  } catch (err) {
    console.error("GET /wms/issue-announcements:", err.message);
    res.status(500).json(errorEnvelope("ISSUE_ANNOUNCEMENTS_FAILED", err.message));
  }
});

// ── WMS picking (收料) status: every WO's collect order → how many lines the
// warehouse has collected (COLLECTED, ready to pick) vs how many the LINE pick
// PDA has accepted (ISSUED), plus the last line-side PDA actor + time. This is
// the WMS view of "all pick PDAs' progress".
app.get("/wms/picking-status", requirePermission("wms.view"), async (req, res) => {
  try {
    const woCode = String(req.query.workOrderCode ?? "").trim().toUpperCase();
    const woCond = woCode ? " AND c.work_order_code = $1" : "";
    const params = woCode ? [woCode] : [];
    const rows = (await query(
      `SELECT c.id, c.collect_no AS "collectNo", c.work_order_code AS "workOrderCode",
              c.line_code AS "lineCode", c.status AS "collectStatus",
              c.collector AS "collector",
              COUNT(l.id)::int AS "totalLines",
              COUNT(l.id) FILTER (WHERE l.status='COLLECTED')::int AS "readyToPick",
              COUNT(l.id) FILTER (WHERE l.status='ISSUED')::int AS "acceptedLines",
              (SELECT a.operator FROM wms_pick_acceptance a
                WHERE a.wo_code = c.work_order_code
                ORDER BY a.accepted_at DESC, a.id DESC LIMIT 1) AS "lastPickingBy",
              (SELECT a.accepted_at FROM wms_pick_acceptance a
                WHERE a.wo_code = c.work_order_code
                ORDER BY a.accepted_at DESC, a.id DESC LIMIT 1) AS "lastPickingAt",
              (SELECT COUNT(*)::int FROM wms_pick_acceptance a
                WHERE a.wo_code = c.work_order_code) AS "acceptCount",
              (SELECT COUNT(*)::int FROM wms_issue_announcements an
                WHERE an.wo_code = c.work_order_code AND an.status='READY') AS "readyNotices"
         FROM wms_collect_orders c
         LEFT JOIN wms_collect_order_lines l ON l.collect_order_id = c.id
        WHERE c.status IN ('OPEN','PARTIAL','COLLECTED','ISSUED') ${woCond}
        GROUP BY c.id ORDER BY c.id DESC LIMIT 100`, params
    )).rows.map((r) => ({
      ...r,
      totalLines: Number(r.totalLines),
      readyToPick: Number(r.readyToPick),
      acceptedLines: Number(r.acceptedLines),
      acceptCount: Number(r.acceptCount),
      readyNotices: Number(r.readyNotices),
      // Warehouse collected N lines; line PDA accepted M of them.
      pickingStatus: Number(r.readyToPick) === 0
        ? "COLLECTING"
        : Number(r.acceptedLines) >= Number(r.readyToPick) ? "DONE" : "IN_PROGRESS",
    }));
    res.json({ success: true, data: { items: rows } });
  } catch (err) {
    console.error("GET /wms/picking-status:", err.message);
    res.status(500).json(errorEnvelope("PICKING_STATUS_FAILED", err.message));
  }
});

// POST /wms/issue-announcements/:id/ack — line picker acknowledges the ready alert.
app.post("/wms/issue-announcements/:id/ack", requirePermission("wms.execute"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const upd = (await query(
      `UPDATE wms_issue_announcements SET status='ACKED', acked_by=$2, acked_at=NOW()
        WHERE id=$1 RETURNING id, status AS "status", acked_by AS "ackedBy", acked_at AS "ackedAt"`,
      [id, req.user?.username || "PDA"]
    )).rows[0];
    if (!upd) return res.status(404).json(errorEnvelope("NOT_FOUND", "Announcement not found"));
    res.json({ success: true, data: upd });
  } catch (err) {
    console.error("POST /wms/issue-announcements/:id/ack:", err.message);
    res.status(500).json(errorEnvelope("ISSUE_ANNOUNCE_ACK_FAILED", err.message));
  }
});

  return { ensureCollectOrder };
}
