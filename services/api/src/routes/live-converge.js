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

// 399 防写触发器只认会话标志 app.source_sync='on'。摄取必须跑在专用 client
// 的事务里(SET LOCAL 不会泄漏回连接池),整轮单事务提交:半途失败不留
// “改了一半”的 canonical 行。fn 收到的 q 与 server.js 的 query 同形({rows})。
export async function withSourceSyncTx(getClient, fn) {
  const client = await getClient();
  const q = async (sql, params) => { const r = await client.query(sql, params); return { rows: r.rows, rowCount: r.rowCount }; };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.source_sync = 'on'");
    const out = await fn(q);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// provenance 盖章:凡是 live-sync/staging 里能对上的行,标 'wms-rjvn' / 'oa-portal'。
// 在摄取事务内跑(标志已开),幂等:只补 NULL 行。
export async function stampProvenance(q, code) {
  // staging 表由各自任务的 pull 才创建;stamp 可能在别的任务首轮前跑
  // (首轮 partial 的根因)。to_regclass 守卫,缺席即跳过,下轮补上。
  const hasTable = async (t) => (await q(`SELECT to_regclass($1) AS x`, [t])).rows[0].x;
  if (code === "wms-rjvn") {
    if (await hasTable("sync_stage.live_wms_rjvn__iqc")) {
      await q(`UPDATE material_lots m SET data_provenance='wms-rjvn'
                FROM sync_stage.live_wms_rjvn__iqc s
               WHERE s.payload->>'lotNo' = m.lot_no AND m.data_provenance IS NULL`);
      await q(`UPDATE iqc_inspections i SET data_provenance='wms-rjvn'
                FROM sync_stage.live_wms_rjvn__iqc s
               WHERE s.payload->>'inspectionNo' = i.inspection_no AND i.data_provenance IS NULL`);
    }
    await q(`UPDATE inventory_transactions t SET data_provenance='wms-rjvn'
              FROM material_lots m
             WHERE m.id = t.material_lot_id AND m.data_provenance = 'wms-rjvn' AND t.data_provenance IS NULL`);
    if (await hasTable("sync_stage.live_wms_rjvn__picking")) {
      await q(`UPDATE wms_picking_orders w SET data_provenance='wms-rjvn'
                FROM sync_stage.live_wms_rjvn__picking s
               WHERE w.rjvn_id::text = s.source_id AND w.data_provenance IS NULL`);
    }
  } else {
    if (await hasTable("sync_stage.live_oa_portal__instances")) {
      await q(`UPDATE oa.flow_instance fi SET data_provenance='oa-portal'
                FROM sync_stage.live_oa_portal__instances s
               WHERE fi.instance_no = s.payload->>'instance_no' AND fi.data_provenance IS NULL`);
    }
    if (await hasTable("sync_stage.live_oa_portal__flows")) {
      await q(`UPDATE oa.flow_definition fd SET data_provenance='oa-portal'
                FROM sync_stage.live_oa_portal__flows s
               WHERE fd.code = s.payload->>'code' AND fd.data_provenance IS NULL`);
    }
    // OA 文档/审批/组织族只有 ext(id bigint 共享)能对上的,按 ext 盖章;
    // ext 缺席(瞬态模式已 DROP)时这些是 no-op,to_regclass 兜住。
    const stampFromExt = async (tbl, idCol = "id") => {
      const ex = await q(`SELECT to_regclass('ext_oa_src.${tbl}') AS t`);
      if (!ex.rows[0].t) return;
      await q(`UPDATE oa.${tbl} o SET data_provenance='oa-portal'
                 FROM ext_oa_src.${tbl} e
                WHERE e.${idCol}::bigint = o.${idCol} AND o.data_provenance IS NULL`);
    };
    await stampFromExt("flow_instance");
    await stampFromExt("flow_task");
    await stampFromExt("flow_log");
    await stampFromExt("flow_definition");
    await stampFromExt("org_user");
    await stampFromExt("org_department");
    await stampFromExt("doc_system");
    await stampFromExt("attachment");
    await stampFromExt("doc_change_log");
  }
}

/**
 * @param {Function} query pg query helper (server.js pool)
 * @param {string} code wms-rjvn | oa-portal
 * @param {string} task one of CONVERGE_TASKS
 * @returns {Promise<{created:number,updated:number,skipped:number,note?:string}>}
 */
export async function convergeTask(query, code, task) {
  const out = await convergeTaskInner(query, code, task);
  // 399: 每轮摄取后给对得上的行补 provenance(幂等,只补 NULL)。
  await stampProvenance(query, code);
  return out;
}

async function convergeTaskInner(query, code, task) {
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
  if (code === "wms-rjvn" && task === "inventory") {
    const mirror = await convergeInventoryMirror(query);
    // ext_wms_src.* is refreshed by the datasources sync (not this pull);
    // backfilling here every round means a refreshed copy converges without
    // any extra trigger. Insert-only, so the cost is one NOT EXISTS per table.
    const backfill = await convergeExtWmsBackfill(query);
    const gen = await backfillFromExt(query, "ext_wms_src");
    const genCreated = Object.values(gen).reduce((a, x) => a + (x.created || 0), 0);
    const genSkipped = Object.values(gen).reduce((a, x) => a + (x.skipped || 0), 0);
    return {
      created: mirror.created + backfill.created + genCreated,
      updated: mirror.updated,
      skipped: mirror.skipped + backfill.skipped + genSkipped,
      note: `${backfill.note} | gen+${genCreated} skip${genSkipped}`,
    };
  }
  if (code === "oa-portal" && task === "instances") {
    const r = await convergeOaInstances(query);
    const gen = await backfillFromExt(query, "ext_oa_src");
    const genCreated = Object.values(gen).reduce((a, x) => a + (x.created || 0), 0);
    const genUpdated = Object.values(gen).reduce((a, x) => a + (x.updated || 0), 0);
    const genSkipped = Object.values(gen).reduce((a, x) => a + (x.skipped || 0), 0);
    return {
      created: r.created + genCreated,
      updated: r.updated + genUpdated,
      skipped: r.skipped + genSkipped,
      note: `ext-backfill+${genCreated}/~${genUpdated} skip${genSkipped}`,
    };
  }
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

// ── Generic ext_* → business-table row backfill (parity closer) ───────────
// The datasources full-table copies (ext_oa_src.*, ext_wms_src.*) are the
// only complete mirrors of the running systems; the live list APIs expose a
// subset. This walks a declarative table list and inserts rows the business
// table is missing, keyed on the natural match columns (source id where the
// id spaces are shared — OA; (task, started_at, request_id) for WMS logs).
// Columns are the ext∩target intersection; text-typed ext columns (uuid PKs
// land as text in staging) are cast explicitly; composite-domain columns
// (rjvn_user_profile) are skipped, never invented; FK guards make a row with
// a missing master a counted skip instead of an error. OA sequences are
// bumped past mirrored ids so local inserts cannot collide.
const EXT_BACKFILL = [
  // OA — source bigint ids preserved (oa.* already carries the same id space)
  { ext: "ext_oa_src", tgt: "oa", table: "doc_system", idMode: "preserve",
    fk: [`e.created_by IS NULL OR EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.created_by)`,
         `e.owner_dept_id IS NULL OR EXISTS(SELECT 1 FROM oa.org_department d WHERE d.id = e.owner_dept_id)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "attachment", idMode: "preserve",
    fk: [`e.instance_id IS NULL OR EXISTS(SELECT 1 FROM oa.flow_instance i WHERE i.id = e.instance_id)`,
         `e.uploaded_by IS NULL OR EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.uploaded_by)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "doc_code_ledger", idMode: "preserve",
    fk: [`e.doc_id IS NULL OR EXISTS(SELECT 1 FROM oa.doc_system d WHERE d.id = e.doc_id)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "doc_issue_record", idMode: "preserve",
    fk: [`EXISTS(SELECT 1 FROM oa.doc_system d WHERE d.id = e.doc_id)`,
         `e.dept_id IS NULL OR EXISTS(SELECT 1 FROM oa.org_department dd WHERE dd.id = e.dept_id)`,
         `e.holder_id IS NULL OR EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.holder_id)`,
         `e.operator_id IS NULL OR EXISTS(SELECT 1 FROM oa.org_user u2 WHERE u2.id = e.operator_id)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "doc_issue_feed", idMode: "preserve",
    fk: [`e.doc_id IS NULL OR EXISTS(SELECT 1 FROM oa.doc_system d WHERE d.id = e.doc_id)`,
         `e.issued_by IS NULL OR EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.issued_by)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "doc_version_lang", idMode: "preserve",
    fk: [`EXISTS(SELECT 1 FROM oa.doc_system d WHERE d.id = e.doc_id)`,
         `e.file_id IS NULL OR EXISTS(SELECT 1 FROM oa.attachment a WHERE a.id = e.file_id)`,
         `e.sealed_file_id IS NULL OR EXISTS(SELECT 1 FROM oa.attachment a2 WHERE a2.id = e.sealed_file_id)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "sys_doc_version", idMode: "preserve",
    fk: [`EXISTS(SELECT 1 FROM oa.doc_system d WHERE d.id = e.doc_id)`,
         `e.created_by IS NULL OR EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.created_by)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "doc_print_log", idMode: "preserve" },
  { ext: "ext_oa_src", tgt: "oa", table: "doc_review_read", idMode: "preserve",
    fk: [`EXISTS(SELECT 1 FROM oa.flow_instance i WHERE i.id = e.instance_id)`,
         `EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.user_id)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "flow_definition_version", idMode: "preserve",
    fk: [`EXISTS(SELECT 1 FROM oa.flow_definition fd WHERE fd.id = e.definition_id)`,
         `e.created_by IS NULL OR EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.created_by)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "flow_log", idMode: "preserve",
    fk: [`e.actor_id IS NULL OR EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.actor_id)`,
         `e.instance_id IS NULL OR EXISTS(SELECT 1 FROM oa.flow_instance i WHERE i.id = e.instance_id)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "flow_task", idMode: "preserve",
    fk: [`EXISTS(SELECT 1 FROM oa.flow_instance i WHERE i.id = e.instance_id)`,
         `EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.assignee_id)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "notification", idMode: "preserve",
    fk: [`EXISTS(SELECT 1 FROM oa.org_user u WHERE u.id = e.user_id)`] },
  { ext: "ext_oa_src", tgt: "oa", table: "doc_change_log", idMode: "preserve" },
  // WMS operational logs + param mirror — id spaces are NOT shared (source
  // bigint vs mirror uuid); match on the natural key, mint a fresh uuid.
  { ext: "ext_wms_src", tgt: "public", table: "mes_sync_log", tgtTable: "rjvn_mes_sync_log", idMode: "generate",
    match: [`t.task IS NOT DISTINCT FROM e.task`, `t.started_at = e.started_at`, `COALESCE(t.request_id,'') = COALESCE(e.request_id,'')`] },
  { ext: "ext_wms_src", tgt: "public", table: "operation_log", tgtTable: "rjvn_operation_log", idMode: "generate",
    match: [`t.action = e.action`, `t._created_at = e._created_at`, `t.biz_no IS NOT DISTINCT FROM e.biz_no`] },
  { ext: "ext_wms_src", tgt: "public", table: "sys_param", tgtTable: "rjvn_sys_param", idMode: "default",
    match: [`t.param_key = e.param_key`] },
];

export async function backfillFromExt(query, extPrefix) {
  const out = {};
  for (const spec of EXT_BACKFILL) {
    if (spec.ext !== extPrefix) continue;
    const tgtTable = spec.tgtTable ?? spec.table;
    const exists = await query(`SELECT to_regclass($1) AS t`, [`${spec.ext}.${spec.table}`]);
    if (!exists.rows[0].t) continue; // copy not taken yet
    const toReg = await query(`SELECT to_regclass($1) AS t`, [`${spec.tgt}.${tgtTable}`]);
    if (!toReg.rows[0].t) { out[spec.table] = { note: "target missing" }; continue; }
    // column intersection with both sides' types, target order
    const colRows = await query(`
      SELECT e.column_name AS name, e.data_type AS etype, t.data_type AS ttype
        FROM information_schema.columns e
        JOIN information_schema.columns t
          ON t.table_schema = $2 AND t.table_name = $3 AND t.column_name = e.column_name
       WHERE e.table_schema = $1 AND e.table_name = $4
       ORDER BY t.ordinal_position`, [spec.ext, spec.tgt, tgtTable, spec.table]);
    // array-typed target columns (doc_review_read.langs) have no safe text
    // cast from the staging copy — leave them NULL rather than emit `::ARRAY`.
    const usable = colRows.rows.filter((x) => x.ttype !== "USER-DEFINED" && x.ttype !== "ARRAY"
      && !(spec.idMode !== "preserve" && x.name === "id"));
    const expr = (x) => {
      if (x.name === "id" && spec.idMode === "preserve") return `e."id"`;
      if (x.etype === x.ttype) return `e."${x.name}"`;
      if (x.etype === "text") {
        if (x.ttype === "uuid") return `NULLIF(e."${x.name}",'')::uuid`;
        if (x.ttype === "bigint" || x.ttype === "integer") return `NULLIF(e."${x.name}",'')::${x.ttype}`;
        if (x.ttype === "numeric" || x.ttype === "date" || x.ttype === "boolean" || x.ttype === "jsonb") return `NULLIF(e."${x.name}",'')::${x.ttype}`;
        if (x.ttype === "timestamp with time zone") return `NULLIF(e."${x.name}",'')::timestamptz`;
      }
      if (x.ttype === "text" || x.ttype === "timestamp with time zone" && x.etype === "timestamp with time zone") return `e."${x.name}"`;
      return `e."${x.name}"::${x.ttype === "character varying" ? "text" : x.ttype}`;
    };
    const list = usable.map((x) => `"${x.name}"`).join(", ");
    const sel = usable.map(expr).join(", ");
    const idSel = spec.idMode === "generate" ? "gen_random_uuid() AS id, " : "";
    const matchCond = (spec.match ?? [`t.id = e.id${spec.tgt === "public" ? "::text" : ""}`]).join(" AND ");
    // parens are load-bearing: the guards are `x IS NULL OR EXISTS(...)` and
    // without them the OR swallows the NOT EXISTS and re-inserts existing rows.
    const fk = spec.fk?.length ? ` AND (${spec.fk.join(" AND ")})` : "";
    const ins = await query(`
      INSERT INTO "${spec.tgt}"."${tgtTable}" (${spec.idMode === "generate" ? "id, " : ""}${list})
      SELECT ${idSel}${sel}
        FROM "${spec.ext}"."${spec.table}" e
       WHERE NOT EXISTS (SELECT 1 FROM "${spec.tgt}"."${tgtTable}" t WHERE ${matchCond})${fk}
      RETURNING 1`, []);
    let skipped = 0;
    if (spec.fk?.length) {
      const sk = await query(`SELECT count(*)::int AS n FROM "${spec.ext}"."${spec.table}" e
        WHERE NOT EXISTS (SELECT 1 FROM "${spec.tgt}"."${tgtTable}" t WHERE ${matchCond})
          AND NOT (${spec.fk.join(" AND ")})`, []);
      skipped = sk.rows[0].n;
    }
    // mirrored ids can sit above the local sequence — bump it (OA preserve mode)
    if (spec.idMode === "preserve") {
      const seq = await query(`SELECT pg_get_serial_sequence($1,'id') AS s`, [`${spec.tgt}.${tgtTable}`]);
      if (seq.rows[0]?.s) {
        await query(`SELECT setval($1, (SELECT COALESCE(max(id),1) FROM "${spec.tgt}"."${tgtTable}"), true)`, [seq.rows[0].s]).catch(() => undefined);
      }
    }
    out[tgtTable] = { created: ins.rows.length, skipped };
  }
  // key-based alignment (no id column, and NO unique constraint on prefix/key
  // in these two — so UPDATE + NOT-EXISTS INSERT, never ON CONFLICT)
  if (extPrefix === "ext_oa_src") {
    const cs = await query(`SELECT to_regclass('ext_oa_src.doc_code_seq') t`, []);
    if (cs.rows[0].t) {
      await query(`
        UPDATE oa.doc_code_seq t SET max_seq = e.max_seq, updated_at = e.updated_at
          FROM ext_oa_src.doc_code_seq e
         WHERE t.prefix = e.prefix AND t.max_seq < e.max_seq`, []);
      const ins = await query(`
        INSERT INTO oa.doc_code_seq (prefix, max_seq, updated_at)
        SELECT e.prefix, e.max_seq, e.updated_at FROM ext_oa_src.doc_code_seq e
         WHERE NOT EXISTS (SELECT 1 FROM oa.doc_code_seq t WHERE t.prefix = e.prefix)
        RETURNING prefix`, []);
      out.doc_code_seq = { created: ins.rows.length, skipped: 0 };
    }
    const sc = await query(`SELECT to_regclass('ext_oa_src.sys_config') t`, []);
    if (sc.rows[0].t) {
      await query(`
        UPDATE oa.sys_config t SET value = e.value, label = e.label, updated_at = e.updated_at
          FROM ext_oa_src.sys_config e
         WHERE t.key = e.key AND t.value IS DISTINCT FROM e.value`, []);
      const ins = await query(`
        INSERT INTO oa.sys_config (key, value, label, updated_at)
        SELECT e.key, e.value, e.label, e.updated_at FROM ext_oa_src.sys_config e
         WHERE NOT EXISTS (SELECT 1 FROM oa.sys_config t WHERE t.key = e.key)
        RETURNING key`, []);
      out.sys_config = { created: ins.rows.length, skipped: 0 };
    }
  }
  return out;
}

// ── ext_wms_src backfill → receipt / iqc_lot_receipt / inventory_transaction
// The datasources full-table copy (ext_wms_src.*) is the only complete mirror
// of the running WMS — the live API list endpoints do not expose receipts or
// transactions. This closes the three business-table DIFFs measured
// 2026-11-22 (docs/live-source-parity-2026-11-22.md): receipt_order 773/924,
// iqc_lot_receipt 773/917, inventory_transaction 777/935. Insert-only keyed
// on source uuid; rows whose FK masters are not in the mirror are skipped and
// counted, never guessed. ext columns are text (staging is for reading), so
// every uuid/numeric/date binding casts explicitly. keeper/_by columns are the
// composite domain rjvn_user_profile — left NULL. Runs every converge round;
// when ext_wms_src is refreshed (datasources sync), new rows land next round.
export async function convergeExtWmsBackfill(query) {
  // Fresh installs never ran the datasources sync — no ext copy, nothing to
  // backfill. Report it instead of throwing and marking the round partial.
  const ext = await query(`SELECT to_regclass('ext_wms_src.receipt_order') AS t`, []);
  if (!ext.rows[0].t) return { created: 0, updated: 0, skipped: 0, note: "ext-backfill: ext_wms_src absent" };
  // 1) receipt_order (parent of iqc_lot_receipt FK — must go first)
  const ro = await query(`
    INSERT INTO rjvn_receipt_order (id, receipt_no, receipt_date, supplier_id, material_id,
                                    quantity, unit, production_date, batch_no, serial_no,
                                    location_id, qr_content, remark, status, _created_at, _updated_at)
    SELECT e.id::uuid, e.receipt_no, e.receipt_date,
           NULLIF(e.supplier_id,'')::uuid, e.material_id::uuid,
           e.quantity, e.unit, e.production_date, e.batch_no, e.serial_no,
           NULLIF(e.location_id,'')::uuid, e.qr_content, e.remark, e.status,
           COALESCE(e._created_at, now()), now()
      FROM ext_wms_src.receipt_order e
     WHERE NOT EXISTS (SELECT 1 FROM rjvn_receipt_order m WHERE m.id::text = e.id)
       AND e.receipt_no IS NOT NULL AND e.receipt_date IS NOT NULL
       AND EXISTS (SELECT 1 FROM rjvn_material mm WHERE mm.id::text = e.material_id)
       AND (NULLIF(e.location_id,'') IS NULL
            OR EXISTS (SELECT 1 FROM rjvn_warehouse_location l WHERE l.id::text = e.location_id))
    RETURNING id`, []);
  const roSkipped = await query(`
    SELECT count(*)::int AS n FROM ext_wms_src.receipt_order e
     WHERE NOT EXISTS (SELECT 1 FROM rjvn_receipt_order m WHERE m.id::text = e.id)
       AND NOT (e.receipt_no IS NOT NULL AND e.receipt_date IS NOT NULL
         AND EXISTS (SELECT 1 FROM rjvn_material mm WHERE mm.id::text = e.material_id)
         AND (NULLIF(e.location_id,'') IS NULL
              OR EXISTS (SELECT 1 FROM rjvn_warehouse_location l WHERE l.id::text = e.location_id)))`, []);

  // 2) iqc_lot_receipt (FKs to rjvn_iqc_lot + rjvn_receipt_order — both now filled)
  const lr = await query(`
    INSERT INTO rjvn_iqc_lot_receipt (id, lot_id, receipt_id, _created_at)
    SELECT e.id::uuid, e.lot_id::uuid, e.receipt_id::uuid, COALESCE(e._created_at, now())
      FROM ext_wms_src.iqc_lot_receipt e
     WHERE NOT EXISTS (SELECT 1 FROM rjvn_iqc_lot_receipt m WHERE m.id::text = e.id)
       AND EXISTS (SELECT 1 FROM rjvn_iqc_lot l WHERE l.id::text = e.lot_id)
       AND EXISTS (SELECT 1 FROM rjvn_receipt_order r WHERE r.id::text = e.receipt_id)
    RETURNING id`, []);
  const lrSkipped = await query(`
    SELECT count(*)::int AS n FROM ext_wms_src.iqc_lot_receipt e
     WHERE NOT EXISTS (SELECT 1 FROM rjvn_iqc_lot_receipt m WHERE m.id::text = e.id)
       AND NOT (EXISTS (SELECT 1 FROM rjvn_iqc_lot l WHERE l.id::text = e.lot_id)
         AND EXISTS (SELECT 1 FROM rjvn_receipt_order r WHERE r.id::text = e.receipt_id))`, []);

  // 3) inventory_transaction (no FKs; NOT NULL material_id, location_id, tx_type)
  const it = await query(`
    INSERT INTO rjvn_inventory_transaction (id, material_id, location_id, batch_no, label_no,
                                            stock_status, tx_type, tx_no, qty, balance_after, unit,
                                            reference_no, remark, _created_at, _updated_at)
    SELECT e.id::uuid, e.material_id::uuid, e.location_id::uuid, e.batch_no, e.label_no,
           e.stock_status, e.tx_type, e.tx_no, e.qty, e.balance_after, e.unit,
           e.reference_no, e.remark, COALESCE(e._created_at, now()), now()
      FROM ext_wms_src.inventory_transaction e
     WHERE NOT EXISTS (SELECT 1 FROM rjvn_inventory_transaction m WHERE m.id::text = e.id)
       AND NULLIF(e.material_id,'') IS NOT NULL
       AND NULLIF(e.location_id,'') IS NOT NULL
       AND e.tx_type IS NOT NULL
    RETURNING id`, []);
  const itSkipped = await query(`
    SELECT count(*)::int AS n FROM ext_wms_src.inventory_transaction e
     WHERE NOT EXISTS (SELECT 1 FROM rjvn_inventory_transaction m WHERE m.id::text = e.id)
       AND NOT (NULLIF(e.material_id,'') IS NOT NULL
         AND NULLIF(e.location_id,'') IS NOT NULL AND e.tx_type IS NOT NULL)`, []);

  return {
    created: ro.rows.length + lr.rows.length + it.rows.length,
    updated: 0,
    skipped: roSkipped.rows[0].n + lrSkipped.rows[0].n + itSkipped.rows[0].n,
    note: `ext-backfill receipt+${ro.rows.length} lot_receipt+${lr.rows.length} inv_tx+${it.rows.length}`,
  };
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
