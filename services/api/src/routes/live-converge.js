// ============================================================================
// Live-sync CONVERGENCE — sync_stage.live_* → canonical business tables
// ============================================================================
// The pull side (live-sync.js) lands the running WMS / OA payloads verbatim in
// sync_stage. This module is the second half the operator asked for: "migrate
// the data from the working WMS and OA, then keep syncing as new rows show up".
// Every statement here is set-based against the staging tables, keyed on the
// natural business key, so a re-run converges (idempotent) instead of
// duplicating. The running WMS/OA is the system of record for these facts —
// drift is corrected toward the source, never the other way.
//
// Invariant discipline (MISSION):
//   ① inventory is derived: a new lot gets an inventory_transactions RECEIVE
//      row, never a balance write. tx_no follows the existing RK<yyyymmdd><seq>
//      pattern; operator_id=12 (admin) matches every RK row already in the DB.
//   ② no hard deletes: only INSERT / UPDATE here, no DELETE anywhere.
//   ③ IQC status mirror: pass→released, rejected→rejected, everything else
//      (pending / review_pending)→pending. A rejected lot must never read as
//      released on this side.
//   workorders land in mes_work_orders (the MES-domain table mes-sync.js also
//      writes), keyed by work_order_no; a manually created order that collides
//      with a source number is SKIPPED, never overwritten (same rule as
//      mes-sync.js writeWorkOrder).
//   OA instances/definitions already exist in oa.* (the 260/33 graft); this
//      aligns mutable fields (status, current_index, finished_at, title,
//      active) — new definitions cannot be created here because form_schema /
//      flow_nodes are NOT NULL and the list API does not return them; those
//      count as skipped and are reported.
//
// Called from live-sync.js runSync() after each successful pull (auto), and
// from POST /api/live-sync/converge/:code (manual, works off staged data only).
// ============================================================================

/** Tasks that have a canonical target. */
export const CONVERGE_TASKS = new Set([
  "iqc", "workorders", "picking", "instances", "flows", "inventory",
]);

const mapLotStatus = (s) => (s === "pass" ? "released" : s === "rejected" ? "rejected" : "pending");

/**
 * @param {Function} query pg query helper (server.js pool)
 * @param {string} code wms-rjvn | oa-portal
 * @param {string} task one of CONVERGE_TASKS
 * @returns {Promise<{created:number,updated:number,skipped:number,note?:string}>}
 */
export async function convergeTask(query, code, task) {
  if (code === "wms-rjvn" && task === "iqc") {
    const canon = await convergeIqc(query);
    const mirror = await convergeIqcLotMirror(query);
    return {
      created: canon.created + mirror.created,
      updated: canon.updated + mirror.updated,
      skipped: canon.skipped + mirror.skipped,
      note: `${canon.note ?? ""} | mirror: ${mirror.note ?? `lot+${mirror.created}/~${mirror.updated} bad-key=${mirror.skipped}`}`,
    };
  }
  if (code === "wms-rjvn" && task === "workorders") {
    const canon = await convergeWorkorders(query);
    const mirror = await convergeWorkOrderMirror(query);
    return {
      created: canon.created + mirror.created,
      updated: canon.updated + mirror.updated,
      skipped: canon.skipped + mirror.skipped,
      note: `${canon.note ?? ""} | mirror: ${mirror.note ?? `wo+${mirror.created}/~${mirror.updated}`}`,
    };
  }
  if (code === "wms-rjvn" && task === "picking") return convergePicking(query);
  if (code === "wms-rjvn" && task === "inventory") return convergeInventoryMirror(query);
  if (code === "oa-portal" && task === "instances") return convergeOaInstances(query);
  if (code === "oa-portal" && task === "flows") return convergeOaFlows(query);
  return { created: 0, updated: 0, skipped: 0, note: "no convergence target" };
}

// ── IQC: lots + RECEIVE transactions + decided inspection rows ─────────────
async function convergeIqc(query) {
  const srcCte = `
    WITH src AS (
      SELECT s.payload->>'lotNo'          AS lot_no,
             s.payload->>'materialCode'   AS material_code,
             s.payload->>'supplierCode'   AS supplier_code,
             (s.payload->>'totalQty')::numeric AS qty,
             s.payload->>'status'         AS live_status,
             (s.payload->>'receiptDate')::date  AS receipt_date,
             split_part(s.payload->>'locationCodes', ',', 1) AS loc_code
        FROM sync_stage.live_wms_rjvn__iqc s
       WHERE s.payload->>'lotNo' IS NOT NULL
     )`;

  // 1) lots: create new, mirror iqc_status onto existing (source wins)
  const lots = await query(`${srcCte}
    INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status,
                               received_at, created_at, updated_at)
    SELECT (SELECT m.id FROM materials m WHERE m.code = s.material_code LIMIT 1),
           (SELECT sp.id FROM suppliers sp WHERE sp.code = s.supplier_code LIMIT 1),
           s.lot_no, s.qty,
           CASE s.live_status WHEN 'pass' THEN 'released' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END,
           s.receipt_date AT TIME ZONE 'Asia/Ho_Chi_Minh', now(), now()
      FROM src s
     WHERE EXISTS (SELECT 1 FROM materials m WHERE m.code = s.material_code)
       AND EXISTS (SELECT 1 FROM suppliers sp WHERE sp.code = s.supplier_code)
       AND s.qty > 0
    ON CONFLICT (lot_no) DO UPDATE
      SET iqc_status = EXCLUDED.iqc_status, updated_at = now()
    RETURNING (xmax = 0) AS inserted, lot_no`, []);
  const createdLots = lots.rows.filter((r) => r.inserted);
  const updatedLots = lots.rows.length - createdLots.length;
  const skippedMaster = await query(`
    SELECT count(*)::int AS n FROM sync_stage.live_wms_rjvn__iqc s
     WHERE s.payload->>'lotNo' IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM materials m WHERE m.code = s.payload->>'materialCode')`, []);

  // 2) RECEIVE transactions for lots that have none (invariant ①)
  const seq = await query(`
    WITH orphans AS (
      SELECT ml.id AS lot_id, ml.received_qty, ml.received_at,
             split_part(s.payload->>'locationCodes', ',', 1) AS loc_code
        FROM material_lots ml
        JOIN sync_stage.live_wms_rjvn__iqc s ON s.payload->>'lotNo' = ml.lot_no
       WHERE NOT EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.material_lot_id = ml.id)
    ), day_max AS (
      SELECT d.day, COALESCE(max(substring(t.tx_no from 11 for 4))::int, 0) AS mx
        FROM (SELECT DISTINCT to_char(o.received_at, 'YYYYMMDD') AS day FROM orphans o) d
        LEFT JOIN inventory_transactions t ON t.tx_no LIKE 'RK' || d.day || '%'
       GROUP BY d.day
    )
    INSERT INTO inventory_transactions
          (tx_no, action, material_lot_id, qty, to_location_id, operator_id, occurred_at, tx_status)
    SELECT 'RK' || to_char(o.received_at, 'YYYYMMDD')
             || lpad((dm.mx + row_number() OVER (PARTITION BY to_char(o.received_at,'YYYYMMDD') ORDER BY o.lot_id))::text, 4, '0'),
           'RECEIVE', o.lot_id, o.received_qty,
           (SELECT l.id FROM storage_locations l WHERE l.code = o.loc_code LIMIT 1),
           12, o.received_at, 'posted'
      FROM orphans o
      JOIN day_max dm ON dm.day = to_char(o.received_at, 'YYYYMMDD')
    RETURNING id`, []);

  // 3) inspection rows for decided lots that lack one
  const insp = await query(`
    WITH src AS (
      SELECT s.payload->>'inspectionNo' AS ino,
             s.payload->>'lotNo'        AS lot_no,
             s.payload->>'materialCode' AS material_code,
             s.payload->>'materialName' AS material_name,
             s.payload->>'supplierCode' AS supplier_code,
             s.payload->>'supplierName' AS supplier_name,
             s.payload->>'status'       AS live_status,
             (s.payload->>'totalQty')::numeric AS qty,
             (s.payload->>'inspectionTime')::timestamptz AS insp_at,
             s.payload->>'remark'       AS remark
        FROM sync_stage.live_wms_rjvn__iqc s
       WHERE s.payload->>'status' IN ('pass','rejected')
         AND s.payload->>'inspectionNo' IS NOT NULL
    )
    INSERT INTO iqc_inspections (inspection_no, material_lot_id, result, operator_id, occurred_at,
                                 lot_no, material_code, material_name, supplier_code, supplier_name,
                                 inspection_date, sampled_qty, inspected_qty, accepted_qty, rejected_qty,
                                 remarks, created_at, updated_at)
    SELECT src.ino, ml.id, CASE src.live_status WHEN 'pass' THEN 'pass' ELSE 'reject' END, 12,
           COALESCE(src.insp_at, now()),
           src.lot_no, src.material_code, src.material_name, src.supplier_code, src.supplier_name,
           COALESCE(src.insp_at, now()) AT TIME ZONE 'Asia/Ho_Chi_Minh',
           src.qty, src.qty,
           CASE WHEN src.live_status = 'pass' THEN src.qty ELSE 0 END,
           CASE WHEN src.live_status = 'rejected' THEN src.qty ELSE 0 END,
           src.remark, now(), now()
      FROM src JOIN material_lots ml ON ml.lot_no = src.lot_no
     WHERE NOT EXISTS (SELECT 1 FROM iqc_inspections i WHERE i.inspection_no = src.ino)
     RETURNING id`, []);

  return {
    created: createdLots.length + seq.rows.length + insp.rows.length,
    updated: updatedLots,
    skipped: skippedMaster.rows[0].n,
    note: `lots+${createdLots.length}/~${updatedLots} tx+${seq.rows.length} insp+${insp.rows.length} master-missing=${skippedMaster.rows[0].n}`,
  };
}

// ── Work orders → mes_work_orders (MES domain, same table as mes-sync) ─────
async function convergeWorkorders(query) {
  const r = await query(`
    WITH src AS (
      SELECT s.payload->>'workOrderNo'  AS wno,
             COALESCE(NULLIF(s.payload->>'source',''), 'mes') AS src_sys,
             s.payload->>'status'       AS st,
             s.payload->>'productCode'  AS pc,
             s.payload->>'productName'  AS pn,
             COALESCE((s.payload->>'planQty')::int, 0) AS pq,
             (s.payload->>'workOrderDate')::date AS wdate,
             s.payload->>'mesStatus'    AS ms,
             s.payload->>'remark'       AS rmk
        FROM sync_stage.live_wms_rjvn__workorders s
       WHERE s.payload->>'workOrderNo' IS NOT NULL
    )
    INSERT INTO mes_work_orders (work_order_no, source, status, product_code, product_name,
                                 plan_qty, work_order_date, mes_status, remark, created_at, updated_at)
    SELECT s.wno, s.src_sys, s.st, s.pc, s.pn, s.pq, s.wdate, s.ms, s.rmk, now(), now()
      FROM src s
    ON CONFLICT (work_order_no) DO UPDATE
      SET status = EXCLUDED.status, mes_status = EXCLUDED.mes_status,
          plan_qty = EXCLUDED.plan_qty, product_name = EXCLUDED.product_name,
          work_order_date = EXCLUDED.work_order_date, remark = EXCLUDED.remark,
          updated_at = now()
      WHERE mes_work_orders.source = 'mes'
    RETURNING (xmax = 0) AS inserted, work_order_no`, []);
  const created = r.rows.filter((x) => x.inserted).length;
  const updated = r.rows.length - created;
  const skipped = await query(`
    SELECT count(*)::int AS n FROM sync_stage.live_wms_rjvn__workorders s
     WHERE s.payload->>'workOrderNo' IS NOT NULL
       AND EXISTS (SELECT 1 FROM mes_work_orders w
                    WHERE w.work_order_no = s.payload->>'workOrderNo' AND w.source <> 'mes')`, []);
  return { created, updated, skipped: skipped.rows[0].n };
}

// ── IQC mirror → rjvn_iqc_lot (the screen /rjvn-iqc/pending reads) ─────────
// Same source rows as convergeIqc, landing on the rjvn mirror the WMS graft
// screens query. Keyed by source uuid; a row whose material/supplier uuid is
// not in the mirror master data is skipped (FK), never guessed.
async function convergeIqcLotMirror(query) {
  const r = await query(`
    WITH src AS (
      SELECT (s.payload->>'id')::uuid          AS id,
             s.payload->>'lotNo'               AS lot_no,
             s.payload->>'inspectionNo'        AS inspection_no,
             (s.payload->>'receiptDate')::date AS receipt_date,
             (s.payload->>'materialId')::uuid  AS material_id,
             (s.payload->>'supplierId')::uuid  AS supplier_id,
             (s.payload->>'totalQty')::numeric AS total_qty,
             s.payload->>'unit'                AS unit,
             (s.payload->>'productionDate')::date AS production_date,
             s.payload->>'batchNo'             AS batch_no,
             s.payload->>'locationCodes'       AS location_codes,
             COALESCE((s.payload->>'boxCount')::int, 0) AS box_count,
             s.payload->>'materialSource'      AS material_source,
             s.payload->>'inspectionResult'    AS inspection_result,
             s.payload->>'defectType'          AS defect_type,
             (s.payload->>'inspectionTime')::timestamptz AS inspection_time,
             s.payload->>'status'              AS status,
             s.payload->>'remark'              AS remark
        FROM sync_stage.live_wms_rjvn__iqc s
       WHERE s.payload->>'id' IS NOT NULL
         AND EXISTS (SELECT 1 FROM rjvn_material m WHERE m.id::text = s.payload->>'materialId')
         AND EXISTS (SELECT 1 FROM rjvn_supplier sp WHERE sp.id::text = s.payload->>'supplierId')
    )
    -- inspector/approver/keeper columns are the composite domain
    -- rjvn_user_profile (source uuids are not that shape); left NULL — the
    -- screen renders names from the payload-independent joins.
    INSERT INTO rjvn_iqc_lot (id, lot_no, inspection_no, receipt_date, material_id, supplier_id,
                              total_qty, unit, production_date, batch_no, location_codes, box_count,
                              material_source, inspection_result,
                              defect_type, inspection_time, status, remark, _created_at, _updated_at)
    SELECT id, lot_no, inspection_no, receipt_date, material_id, supplier_id,
           total_qty, unit, production_date, batch_no, location_codes, box_count,
           material_source, inspection_result,
           defect_type, inspection_time, status, remark, now(), now()
      FROM src
    ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status,
          inspection_result = EXCLUDED.inspection_result,
          inspection_time = EXCLUDED.inspection_time,
          total_qty = EXCLUDED.total_qty,
          defect_type = EXCLUDED.defect_type,
          remark = EXCLUDED.remark,
          location_codes = EXCLUDED.location_codes,
          box_count = EXCLUDED.box_count,
          _updated_at = now()
    RETURNING (xmax = 0) AS inserted`, []);
  const created = r.rows.filter((x) => x.inserted).length;
  const badKey = await query(`
    SELECT count(*)::int AS n FROM sync_stage.live_wms_rjvn__iqc s
     WHERE s.payload->>'id' IS NOT NULL
       AND (NOT EXISTS (SELECT 1 FROM rjvn_material m WHERE m.id::text = s.payload->>'materialId')
         OR NOT EXISTS (SELECT 1 FROM rjvn_supplier sp WHERE sp.id::text = s.payload->>'supplierId'))`, []);
  return { created, updated: r.rows.length - created, skipped: badKey.rows[0].n };
}

// ── Inventory mirror → rjvn_inventory (the screen /rjvn-inventory/list reads)
async function convergeInventoryMirror(query) {
  const r = await query(`
    WITH src AS (
      SELECT (s.payload->>'id')::uuid          AS id,
             (s.payload->>'materialId')::uuid  AS material_id,
             (s.payload->>'locationId')::uuid  AS location_id,
             (s.payload->>'supplierId')::uuid  AS supplier_id,
             s.payload->>'batchNo'             AS batch_no,
             (s.payload->>'quantity')::numeric AS quantity,
             s.payload->>'unit'                AS unit,
             s.payload->>'stockStatus'         AS stock_status,
             (s.payload->>'productionDate')::date AS production_date,
             COALESCE((s.payload->>'locked')::boolean, false) AS locked,
             s.payload->>'lockReason'          AS lock_reason,
             COALESCE((s.payload->>'isSpecialAdmit')::boolean, false) AS is_special_admit
        FROM sync_stage.live_wms_rjvn__inventory s
       WHERE s.payload->>'id' IS NOT NULL
         AND EXISTS (SELECT 1 FROM rjvn_material m WHERE m.id::text = s.payload->>'materialId')
         AND EXISTS (SELECT 1 FROM rjvn_warehouse_location l WHERE l.id::text = s.payload->>'locationId')
    )
    INSERT INTO rjvn_inventory (id, material_id, location_id, supplier_id, batch_no, quantity, unit,
                                stock_status, production_date, locked, lock_reason, is_special_admit,
                                _created_at, _updated_at)
    SELECT id, material_id, location_id, supplier_id, batch_no, quantity, unit,
           stock_status, production_date, locked, lock_reason, is_special_admit, now(), now()
      FROM src
    ON CONFLICT (id) DO UPDATE
      SET quantity = EXCLUDED.quantity,
          stock_status = EXCLUDED.stock_status,
          locked = EXCLUDED.locked,
          lock_reason = EXCLUDED.lock_reason,
          is_special_admit = EXCLUDED.is_special_admit,
          batch_no = EXCLUDED.batch_no,
          production_date = EXCLUDED.production_date,
          _updated_at = now()
    RETURNING (xmax = 0) AS inserted`, []);
  const created = r.rows.filter((x) => x.inserted).length;
  const badKey = await query(`
    SELECT count(*)::int AS n FROM sync_stage.live_wms_rjvn__inventory s
     WHERE s.payload->>'id' IS NOT NULL
       AND (NOT EXISTS (SELECT 1 FROM rjvn_material m WHERE m.id::text = s.payload->>'materialId')
         OR NOT EXISTS (SELECT 1 FROM rjvn_warehouse_location l WHERE l.id::text = s.payload->>'locationId'))`, []);
  return { created, updated: r.rows.length - created, skipped: badKey.rows[0].n };
}

// ── Work orders mirror → rjvn_work_order (the screen /rjvn-work-order reads) ─
async function convergeWorkOrderMirror(query) {
  const r = await query(`
    WITH src AS (
      SELECT (s.payload->>'id')::uuid           AS id,
             s.payload->>'workOrderNo'          AS work_order_no,
             s.payload->>'productCode'          AS product_code,
             s.payload->>'productName'          AS product_name,
             COALESCE((s.payload->>'planQty')::numeric, 0) AS plan_qty,
             COALESCE((s.payload->>'actualQty')::numeric, 0) AS actual_qty,
             (s.payload->>'workOrderDate')::date AS work_order_date,
             COALESCE((s.payload->>'isSupplement')::boolean, false) AS is_supplement,
             s.payload->>'status'               AS status,
             s.payload->>'remark'               AS remark,
             COALESCE(NULLIF(s.payload->>'source',''), 'mes') AS source,
             s.payload->>'mesMoNo'              AS mes_mo_no,
             s.payload->>'mesStatus'            AS mes_status,
             CASE WHEN EXISTS (SELECT 1 FROM rjvn_bom b WHERE b.id::text = s.payload->>'bomId')
                  THEN (s.payload->>'bomId')::uuid ELSE NULL END AS bom_id
        FROM sync_stage.live_wms_rjvn__workorders s
       WHERE s.payload->>'id' IS NOT NULL AND s.payload->>'workOrderNo' IS NOT NULL
    )
    INSERT INTO rjvn_work_order (id, work_order_no, product_code, product_name, plan_qty, actual_qty,
                                 work_order_date, is_supplement, status, remark, source, mes_mo_no,
                                 mes_status, bom_id, _created_at, _updated_at)
    SELECT id, work_order_no, product_code, product_name, plan_qty, actual_qty,
           work_order_date, is_supplement, status, remark, source, mes_mo_no,
           mes_status, bom_id, now(), now()
      FROM src
    ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status,
          actual_qty = EXCLUDED.actual_qty,
          plan_qty = EXCLUDED.plan_qty,
          mes_status = EXCLUDED.mes_status,
          work_order_date = EXCLUDED.work_order_date,
          is_supplement = EXCLUDED.is_supplement,
          remark = EXCLUDED.remark,
          _updated_at = now()
    RETURNING (xmax = 0) AS inserted`, []);
  const created = r.rows.filter((x) => x.inserted).length;
  return { created, updated: r.rows.length - created, skipped: 0 };
}

// ── Picking → wms_picking_orders (crosswalk rjvn_id; slice-2 canonical) ────
async function convergePicking(query) {
  const r = await query(`
    UPDATE wms_picking_orders w
       SET status          = COALESCE(NULLIF(s.payload->>'status',''), w.status),
           total_qty       = COALESCE((s.payload->>'totalQty')::numeric, w.total_qty),
           approval_time   = COALESCE((s.payload->>'approvalTime')::timestamptz, w.approval_time),
           approval_remark = COALESCE(s.payload->>'approvalRemark', w.approval_remark),
           mes_issue_no    = COALESCE(s.payload->>'mesIssueNo', w.mes_issue_no),
           work_order_no   = COALESCE(s.payload->>'workOrderNo', w.work_order_no),
           work_section    = COALESCE(s.payload->>'workSection', w.work_section),
           is_supplement   = COALESCE((s.payload->>'isSupplement')::boolean, w.is_supplement),
           remark          = COALESCE(s.payload->>'remark', w.remark),
           updated_at      = now()
      FROM sync_stage.live_wms_rjvn__picking s
     WHERE w.rjvn_id::text = s.source_id
       AND (   w.status          IS DISTINCT FROM COALESCE(NULLIF(s.payload->>'status',''), w.status)
            OR w.total_qty       IS DISTINCT FROM COALESCE((s.payload->>'totalQty')::numeric, w.total_qty)
            OR w.approval_time   IS DISTINCT FROM COALESCE((s.payload->>'approvalTime')::timestamptz, w.approval_time)
            OR w.approval_remark IS DISTINCT FROM COALESCE(s.payload->>'approvalRemark', w.approval_remark)
            OR w.mes_issue_no    IS DISTINCT FROM COALESCE(s.payload->>'mesIssueNo', w.mes_issue_no)
            OR w.work_order_no   IS DISTINCT FROM COALESCE(s.payload->>'workOrderNo', w.work_order_no)
            OR w.work_section    IS DISTINCT FROM COALESCE(s.payload->>'workSection', w.work_section)
            OR w.is_supplement   IS DISTINCT FROM COALESCE((s.payload->>'isSupplement')::boolean, w.is_supplement)
            OR w.remark          IS DISTINCT FROM COALESCE(s.payload->>'remark', w.remark))
    RETURNING w.id`, []);
  const missing = await query(`
    SELECT count(*)::int AS n FROM sync_stage.live_wms_rjvn__picking s
     WHERE NOT EXISTS (SELECT 1 FROM wms_picking_orders w WHERE w.rjvn_id::text = s.source_id)`, []);
  return { created: 0, updated: r.rows.length, skipped: missing.rows[0].n };
}

// ── OA instances → oa.flow_instance (create new, align mutable fields) ─────
// applicant_id is the SOURCE org_user id — the existing 260 grafted rows
// already carry those ids (3172…), so new instances keep the same key space.
async function convergeOaInstances(query) {
  const ins = await query(`
    WITH src AS (
      SELECT s.payload->>'instance_no'        AS instance_no,
             fd.id                            AS definition_id,
             s.payload->>'title'              AS title,
             s.payload->>'status'             AS status,
             NULLIF(s.payload->>'applicant_id','')::bigint AS applicant_id,
             s.payload->>'organization'       AS organization,
             (s.payload->>'current_index')::int AS current_index,
             (s.payload->>'submitted_at')::timestamptz AS submitted_at,
             (s.payload->>'finished_at')::timestamptz  AS finished_at,
             (s.payload->>'created_at')::timestamptz   AS created_at,
             COALESCE((s.payload->>'closed_loop')::boolean, false) AS closed_loop
        FROM sync_stage.live_oa_portal__instances s
        JOIN oa.flow_definition fd ON fd.code = s.payload->>'def_code'
       WHERE NOT EXISTS (SELECT 1 FROM oa.flow_instance fi
                          WHERE fi.instance_no = s.payload->>'instance_no')
    )
    INSERT INTO oa.flow_instance (instance_no, definition_id, title, form_data, status, applicant_id,
                                  organization, current_index, submitted_at, finished_at, created_at,
                                  updated_at, closed_loop, biz_system, biz_type, biz_key)
    SELECT instance_no, definition_id, COALESCE(title,''), '{}'::jsonb, status, applicant_id,
           COALESCE(organization,'本公司'), current_index, submitted_at, finished_at,
           COALESCE(created_at, now()), now(), closed_loop, 'oa-portal', 'live-sync', instance_no
      FROM src
    ON CONFLICT (instance_no) DO NOTHING
    RETURNING id`, []);
  const r = await query(`
    UPDATE oa.flow_instance fi
       SET status      = s.payload->>'status',
           current_index = (s.payload->>'current_index')::int,
           finished_at = COALESCE((s.payload->>'finished_at')::timestamptz, fi.finished_at),
           closed_loop = COALESCE((s.payload->>'closed_loop')::boolean, fi.closed_loop),
           title       = COALESCE(s.payload->>'title', fi.title),
           updated_at  = now()
      FROM sync_stage.live_oa_portal__instances s
     WHERE fi.instance_no = s.payload->>'instance_no'
       AND (   fi.status       IS DISTINCT FROM s.payload->>'status'
            OR fi.current_index IS DISTINCT FROM (s.payload->>'current_index')::int
            OR fi.finished_at   IS DISTINCT FROM COALESCE((s.payload->>'finished_at')::timestamptz, fi.finished_at)
            OR fi.closed_loop   IS DISTINCT FROM COALESCE((s.payload->>'closed_loop')::boolean, fi.closed_loop)
            OR fi.title         IS DISTINCT FROM COALESCE(s.payload->>'title', fi.title))
    RETURNING fi.id`, []);
  const missing = await query(`
    SELECT count(*)::int AS n FROM sync_stage.live_oa_portal__instances s
     WHERE NOT EXISTS (SELECT 1 FROM oa.flow_definition fd WHERE fd.code = s.payload->>'def_code')`, []);
  return { created: ins.rows.length, updated: r.rows.length, skipped: missing.rows[0].n };
}

// ── OA flow definitions → oa.flow_definition (align; no create — schema cols
//    are NOT NULL and the live list API does not return them) ────────────────
async function convergeOaFlows(query) {
  const r = await query(`
    UPDATE oa.flow_definition fd
       SET name             = COALESCE(NULLIF(s.payload->>'name',''), fd.name),
           name_vi          = COALESCE(s.payload->>'name_vi', fd.name_vi),
           category         = COALESCE(NULLIF(s.payload->>'category',''), fd.category),
           description      = COALESCE(s.payload->>'description', fd.description),
           icon             = COALESCE(s.payload->>'icon', fd.icon),
           active           = COALESCE((s.payload->>'active')::boolean, fd.active),
           closure_required = COALESCE((s.payload->>'closure_required')::boolean, fd.closure_required),
           hide_in_apply    = COALESCE((s.payload->>'hide_in_apply')::boolean, fd.hide_in_apply),
           updated_at       = now()
      FROM sync_stage.live_oa_portal__flows s
     WHERE fd.code = s.payload->>'code'
       AND (   fd.name             IS DISTINCT FROM COALESCE(NULLIF(s.payload->>'name',''), fd.name)
            OR fd.category         IS DISTINCT FROM COALESCE(NULLIF(s.payload->>'category',''), fd.category)
            OR fd.active           IS DISTINCT FROM COALESCE((s.payload->>'active')::boolean, fd.active)
            OR fd.closure_required IS DISTINCT FROM COALESCE((s.payload->>'closure_required')::boolean, fd.closure_required)
            OR fd.hide_in_apply    IS DISTINCT FROM COALESCE((s.payload->>'hide_in_apply')::boolean, fd.hide_in_apply))
    RETURNING fd.id`, []);
  const missing = await query(`
    SELECT count(*)::int AS n FROM sync_stage.live_oa_portal__flows s
     WHERE NOT EXISTS (SELECT 1 FROM oa.flow_definition fd WHERE fd.code = s.payload->>'code')`, []);
  return { created: 0, updated: r.rows.length, skipped: missing.rows[0].n, note: "new definitions need form_schema/flow_nodes — not in the list API" };
}
