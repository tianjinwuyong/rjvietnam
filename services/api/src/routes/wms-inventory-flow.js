// ============================================================================
// WMS 库存/领料/发料/交接主流程（34 路由）—— 从 server.js 整段搬迁
// （refactor-plan-2026-11-21 阶段3轮2）。原位置：server.js 18848-20405（app 级鉴权
// 闸门之后，requirePermission 自带 authenticateJWT 语义不变）。依赖经
// registerWmsInventoryFlowRoutes(app, deps) 注入；buildWmsPickOrder / IQC_ALLOW_MAP
// 随块迁入；resolveOperatorId 迁至 src/wms-shared.js（server.js 另有 2 处调用）。
// 注意：块内含并行 lane 在途的 migration-332 手工冻结过滤（3 处 SQL，未提交，
// 随块搬迁、归属见 commit 说明）。
// ============================================================================
import { randomUUID } from "node:crypto";
import { envelope, listEnvelope, mutateEnvelope, errorEnvelope } from "../shared/helpers.js";
import { resolveOperatorId } from "../wms-shared.js";

export function registerWmsInventoryFlowRoutes(app, { query, pgPool, requirePermission, detachRejectedLotFromPallet, appendClosureAudit }) {

// ── WMS Pick Orders (generated on-the-fly from BOM + WO) ──────────────────

async function buildWmsPickOrder(wo) {
  const bomRes = await query(
    "SELECT id FROM boms WHERE product_id = $1 AND status = 'active' LIMIT 1",
    [wo.product_id]
  );
  if (bomRes.rows.length === 0) {
    return {
      id: `po-${wo.code}`, orderNo: `PO-${wo.code}`, workOrderCode: wo.code,
      lineCode: wo.line_code, status: "pending", operator: null,
      createdAt: wo.created_at ?? new Date().toISOString(), completedAt: null, items: [],
    };
  }

  const bomId = bomRes.rows[0].id;
  const blRes = await query(
    `SELECT bl.id, bl.material_id, bl.qty_per, bl.loss_rate,
            m.code as material_code, m.name_zh, m.name_en, m.name_vi,
            mapping.ruijing_code,
            fifo.lot_no, fifo.location_code, roll.material_sn,
            COALESCE(tx.picked_qty, 0) AS picked_qty,
            COALESCE(tx.returned_qty, 0) AS returned_qty,
            COALESCE(tx.scrapped_qty, 0) AS scrapped_qty,
            tx.latest_fetch_time, tx.signed_by
     FROM bom_lines bl
     JOIN materials m ON m.id = bl.material_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(NULLIF(lm.ruijing_material_code,''), NULLIF(lm_rev.vietnam_material_code,'')) AS ruijing_code
       FROM (SELECT 1) one
       LEFT JOIN wms_material_label_master lm ON lm.vietnam_material_code = m.code
       LEFT JOIN wms_material_label_master lm_rev ON lm_rev.ruijing_material_code = m.code
       LIMIT 1
     ) mapping ON true
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
          -- 手工冻结（migration 332）：冻结批次不进「下一个该拿哪批」的建议
          AND NOT COALESCE(ml.locked, false)
        ORDER BY ml.received_at ASC NULLS LAST, ml.id ASC
        LIMIT 1
      ) fifo ON true
     LEFT JOIN LATERAL (
       SELECT r.material_sn
       FROM wms_material_roll_labels r
       WHERE r.material_code = m.code AND r.lot_no = fifo.lot_no
         AND r.lifecycle_status <> 'RETIRED'
       ORDER BY r.created_at DESC LIMIT 1
     ) roll ON true
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(it.qty) FILTER (WHERE it.action = 'PICK'), 0) AS picked_qty,
         COALESCE(SUM(it.qty) FILTER (WHERE it.action = 'RETURN_FROM_LINE'), 0) AS returned_qty,
         COALESCE(SUM(it.qty) FILTER (WHERE it.action IN ('SCRAP', 'IQC_SCRAP')), 0) AS scrapped_qty,
         MAX(it.occurred_at) FILTER (WHERE it.action = 'PICK') AS latest_fetch_time,
         (ARRAY_AGG(u.username ORDER BY it.occurred_at DESC) FILTER (WHERE it.action = 'PICK'))[1] AS signed_by
       FROM inventory_transactions it
       JOIN material_lots tx_lot ON tx_lot.id = it.material_lot_id
       LEFT JOIN users u ON u.id = it.operator_id
       WHERE it.work_order_id = $2 AND tx_lot.material_id = bl.material_id
         AND it.tx_status = 'posted'
     ) tx ON true
     WHERE bl.bom_id = $1
     ORDER BY bl.id`,
    [bomId, wo.id]
  );
  const plannedQty = Number(wo.planned_qty);
  const items = blRes.rows.map((bl) => ({
    id: `${bomId}-${bl.id}`, pickOrderId: `po-${wo.code}`,
    materialCode: bl.material_code,
    ruijingCode: bl.ruijing_code || null,
    materialName: { name_zh: bl.name_zh, name_en: bl.name_en, name_vi: bl.name_vi },
    requiredQty: Math.ceil(Number(bl.qty_per) * plannedQty * (1 + Number(bl.loss_rate ?? 0))),
    pickedQty: Number(bl.picked_qty), lotNo: bl.lot_no, locationCode: bl.location_code,
    materialSn: bl.material_sn, returnedQty: Number(bl.returned_qty),
    scrappedQty: Number(bl.scrapped_qty), latestFetchTime: bl.latest_fetch_time, signedBy: bl.signed_by,
    status: Number(bl.picked_qty) >= Math.ceil(Number(bl.qty_per) * plannedQty * (1 + Number(bl.loss_rate ?? 0))) ? "picked" : "pending",
  }));
  return {
    id: `po-${wo.code}`, orderNo: `PO-${wo.code}`, workOrderCode: wo.code,
    lineCode: wo.line_code, status: "pending", operator: null,
    createdAt: wo.created_at ?? new Date().toISOString(), completedAt: null, items,
  };
}

// Valid IQC status transitions per WMS workflow
const IQC_ALLOW_MAP = {
  ISSUE_TO_LINE:    ["released"],
  CONSUME:          ["released"],
  PUT_AWAY:         ["released"],
  RESERVE:          ["released"],
  PICK:             ["released"],
  RETURN_FROM_LINE: ["released"],
  TRANSFER:         ["released"],
  SCRAP:            ["released"],
  RECEIVE:          ["pending"],
  IQC_RELEASE:      ["pending", "hold"],
  IQC_HOLD:         ["pending"],
  IQC_REJECT:       ["pending", "hold"],
};

app.get("/wms/material-lots", async (req, res) => {
  try {
    const { lotNo, labelId, iqcStatus, q, msdOnly, limit = 50, offset = 0 } = req.query;
    const conditions = [`COALESCE(ml.lot_status,'open') <> 'voided'`];
    const params = [];
    let idx = 1;
    if (lotNo) { conditions.push(`ml.lot_no = $${idx++}`); params.push(lotNo); }
    if (labelId) { conditions.push(`ml.label_id = $${idx++}`); params.push(labelId); }
    if (iqcStatus) { conditions.push(`ml.iqc_status = $${idx++}`); params.push(iqcStatus); }
    if (String(msdOnly).toLowerCase() === "true") conditions.push(`NULLIF(TRIM(m.msd_level), '') IS NOT NULL AND UPPER(TRIM(m.msd_level)) NOT IN ('N/A', 'NA', 'NONE', '0')`);
    if (q) { conditions.push(`(ml.lot_no ILIKE $${idx} OR ml.label_id ILIKE $${idx} OR m.code ILIKE $${idx})`); params.push(`%${q}%`); idx++; }
    const joins = "JOIN materials m ON m.id = ml.material_id LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id LEFT JOIN suppliers s ON s.id = ml.supplier_id LEFT JOIN wms_material_label_master lm ON lm.ruijing_material_code = m.code";
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const countRes = await query(`SELECT count(*)::int AS total FROM material_lots ml ${joins} ${where}`, params);
    const data = await query(
       `SELECT ml.id, ml.lot_no AS "lotNo", ml.label_id AS "labelId", ml.label_id AS "rollQr", ml.received_qty AS qty,
               (SELECT COALESCE(SUM(CASE WHEN it.action IN ('RECEIVE','RETURN','LINE_RETURN','RETURN_TO_WAREHOUSE','ADJUST_IN') THEN it.qty
                                          WHEN it.action IN ('ISSUE_TO_LINE','CONSUME','SCRAP','IQC_SCRAP','ADJUST_OUT') THEN -it.qty ELSE 0 END),0)
                  FROM inventory_transactions it WHERE it.material_lot_id = ml.id AND it.tx_status='posted' AND NOT COALESCE(it.voided,false)) AS "onHand",
               GREATEST((SELECT COALESCE(SUM(CASE WHEN it.action IN ('RECEIVE','RETURN','LINE_RETURN','RETURN_TO_WAREHOUSE','ADJUST_IN') THEN it.qty
                                          WHEN it.action IN ('ISSUE_TO_LINE','CONSUME','SCRAP','IQC_SCRAP','ADJUST_OUT') THEN -it.qty ELSE 0 END),0)
                  FROM inventory_transactions it WHERE it.material_lot_id = ml.id AND it.tx_status='posted' AND NOT COALESCE(it.voided,false)) - COALESCE(ml.reserved_qty, 0), 0) AS "availableQty",
               COALESCE(ml.reserved_qty, 0) AS "reservedQty", ml.iqc_status AS "iqcStatus",
               COALESCE(ml.low_stock_level, 0) AS "lowStockLevel",
               m.code AS "materialCode",
              COALESCE(NULLIF(m.vietnam_code, ''), NULLIF(lm.vietnam_material_code, ''), '') AS "vietnamCode",
              COALESCE(NULLIF(NULLIF(m.name_zh, ''), m.code), NULLIF(NULLIF(m.name_en, ''), m.code), NULLIF(lm.specification, ''), m.code) AS "name_zh",
              COALESCE(NULLIF(NULLIF(m.name_en, ''), m.code), NULLIF(lm.specification, ''), m.code) AS "name_en",
              m.name_vi,
              m.uom, m.msd_level AS "msdLevel", m.shelf_life_days AS "shelfLifeDays",
              sl.code AS "locationCode",
              COALESCE(sl.qr_code, (SELECT b.location_qr FROM wms_receiving_pallet_box_bindings b WHERE UPPER(b.lot_no)=UPPER(ml.lot_no) ORDER BY b.bound_at DESC LIMIT 1)) AS "locationQr",
              s.code AS "supplierCode", s.name_zh AS "supplierName",
              ml.opened_at AS "openedAt", ml.opened_shelf_life_days AS "openedShelfLifeDays",
              ml.manufacturing_date AS "manufacturingDate",
              ml.expiry_date AS "expiryDate",
              ml.created_at AS "receivedDate",
              ml.lot_status AS "lotStatus", ml.lifecycle_status AS "lifecycleStatus",
              -- 手工冻结（migration 332）：批次列表要能看出「这行被谁按住了」
              COALESCE(ml.locked, false) AS locked, ml.lock_reason AS "lockReason",
              ml.locked_at AS "lockedAt",
              ml.po_no AS "poNo",
              (SELECT b.pallet_qr FROM wms_receiving_pallet_box_bindings b WHERE UPPER(b.lot_no)=UPPER(ml.lot_no) ORDER BY b.bound_at DESC LIMIT 1) AS "palletQr",
              (SELECT b.box_qr FROM wms_receiving_pallet_box_bindings b WHERE UPPER(b.lot_no)=UPPER(ml.lot_no) ORDER BY b.bound_at DESC LIMIT 1) AS "boxQr",
              ml.reserved_qty AS "reservedQty"
       FROM material_lots ml ${joins} ${where} ORDER BY ml.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, Number(limit), Number(offset)],
    );
    res.json(listEnvelope(data.rows, countRes.rows[0]?.total ?? 0));
  } catch (err) {
    console.error("GET /wms/material-lots:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

app.patch("/wms/material-lots/:id/low-stock-level", requirePermission("wms.execute"), async (req, res) => {
  try {
    const lotId = Number(req.params.id), level = Number(req.body?.lowStockLevel);
    if (!lotId) return res.status(400).json(errorEnvelope("MATERIAL_LOT_REQUIRED", "valid material lot id is required"));
    if (!Number.isFinite(level) || level < 0)
      return res.status(400).json(errorEnvelope("LOW_STOCK_LEVEL_INVALID", "lowStockLevel must be a non-negative number"));
    const r = await query(`UPDATE material_lots SET low_stock_level = $2 WHERE id = $1 RETURNING id, low_stock_level AS "lowStockLevel"`, [lotId, level]);
    if (r.rows.length === 0) return res.status(404).json(errorEnvelope("MATERIAL_LOT_NOT_FOUND", "material lot not found"));
    res.json(mutateEnvelope(r.rows[0]));
  } catch (err) {
    res.status(500).json(errorEnvelope("LOW_STOCK_LEVEL_FAILED", err.message));
  }
});

app.get("/wms/storage-locations", async (req, res) => {
  try {
    const { status, q, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (status) { conditions.push(`sl.status = $${idx++}`); params.push(status); }
    if (q) { conditions.push(`(sl.code ILIKE $${idx} OR sl.name_zh ILIKE $${idx})`); params.push(`%${q}%`); idx++; }
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const data = await query(
      `SELECT sl.id, sl.code, sl.qr_code AS "qrCode", sl.area, sl.status, sl.location_type AS "locationType",
              sl.name_zh, sl.name_en, sl.name_vi, sl.warehouse_id AS "warehouseId",
              sl.zone_id AS "zoneId", sl.capacity_qty AS "capacityQty", sl.locked_reason AS "lockedReason",
              sl.length_cm AS "lengthCm", sl.width_cm AS "widthCm", sl.height_cm AS "heightCm",
              sl.allow_receiving AS "allowReceiving", sl.allow_transfer AS "allowTransfer", sl.allow_putaway AS "allowPutaway",
              sl.x_coord AS "xCoord", sl.y_coord AS "yCoord", sl.coordinate_system AS "coordinateSystem",
              sl.aisle_code AS "aisleCode", sl.rack_code AS "rackCode", sl.level_code AS "levelCode", sl.bin_code AS "binCode",
              -- temperature/humidity limits live on the ZONE, not on the location:
              -- they are properties of the zone's storage envelope (wms_zones).
              -- Reading them off the location referenced columns that no
              -- migration ever created, so this endpoint failed with
              -- "column sl.temperature_min does not exist" in every environment.
              z.temperature_min AS "temperatureMin", z.temperature_max AS "temperatureMax",
              z.humidity_min AS "humidityMin", z.humidity_max AS "humidityMax",
              sl.msd_allowed AS "msdAllowed", sl.max_pallets AS "maxPallets",
              COALESCE((SELECT json_agg(json_build_object('materialId', r.material_id, 'ruleType', r.rule_type, 'reason', r.reason) ORDER BY r.rule_type, r.material_id)
                        FROM wms_location_material_rules r WHERE r.location_id=sl.id), '[]'::json) AS "materialRules",
              w.code AS "warehouseCode", w.warehouse_type AS "warehouseType", z.code AS "zoneCode"
       FROM storage_locations sl
       LEFT JOIN wms_warehouses w ON w.id=sl.warehouse_id
       LEFT JOIN wms_zones z ON z.id=sl.zone_id
       ${where} ORDER BY sl.code LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, Number(limit), Number(offset)],
    );
    res.json(listEnvelope(data.rows));
  } catch (err) {
    console.error("GET /wms/storage-locations:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

app.get("/wms/storage-locations/resolve", requirePermission("wms.view"), async (req, res) => {
  try {
    const qr = String(req.query.qr || "").trim().toUpperCase();
    if (!qr) return res.status(400).json(errorEnvelope("LOCATION_QR_REQUIRED", "location QR is required"));
    let row = (await query(
      `SELECT sl.id,sl.code,sl.qr_code AS "qrCode",sl.area,sl.status,
              sl.name_zh AS "nameZh",sl.name_en AS "nameEn",sl.name_vi AS "nameVi",
              sl.capacity_qty AS capacity,sl.allow_receiving AS "allowReceiving",
              COALESCE(SUM(ml.received_qty),0)::numeric AS occupied
       FROM storage_locations sl
       LEFT JOIN material_lots ml ON ml.storage_location_id=sl.id
       WHERE UPPER(sl.qr_code)=$1 OR UPPER(sl.code)=$1
       GROUP BY sl.id`, [qr])).rows[0];
    if (!row) row = (await query(
      `SELECT NULL::bigint AS id,position_key AS code,qr_code AS "qrCode",
              split_part(qr_code,'-R',1) AS area,'active' AS status,
              position_name AS "nameZh",NULL::text AS "nameEn",NULL::text AS "nameVi",
              1::numeric AS capacity,TRUE AS "allowReceiving",
              CASE WHEN EXISTS(SELECT 1 FROM wms_receiving_pallet_box_bindings b WHERE UPPER(b.location_qr)=UPPER(q.qr_code)) THEN 1 ELSE 0 END::numeric AS occupied
       FROM wms_canvas_position_qrs q
       WHERE q.status='ACTIVE' AND UPPER(q.qr_code)=$1
         AND q.position_type IN ('PALLET','PALLET_GRID') LIMIT 1`, [qr])).rows[0];
    if (!row) return res.status(404).json(errorEnvelope("LOCATION_QR_NOT_FOUND", "storage location QR is not registered in WMS"));
    if (String(row.status).toLowerCase() !== "active" || row.allowReceiving === false) {
      return res.status(409).json(errorEnvelope("LOCATION_NOT_RECEIVABLE", "storage location is inactive or does not allow receiving"));
    }
    res.json({ data: row });
  } catch (error) {
    res.status(500).json(errorEnvelope("LOCATION_QR_RESOLVE_FAILED", error.message));
  }
});

app.get("/api/wms/location-map", async (req, res) => {
  try {
    const rows = await query(`
      SELECT sl.area, sl.code, sl.qr_code AS "qrCode", sl.allow_receiving AS "allowReceiving"
      FROM storage_locations sl
      WHERE sl.status = 'active' AND sl.allow_receiving = true
      ORDER BY sl.area, sl.code
    `);
    const map = rows.rows.reduce((acc, r) => {
      if (!acc[r.area]) acc[r.area] = [];
      acc[r.area].push({ code: r.code, qrCode: r.qrCode });
      return acc;
    }, {});
    res.json({ ok: true, data: map });
  } catch (err) {
    res.status(500).json(errorEnvelope("LOCATION_MAP_FAILED", err.message));
  }
});

app.get("/api/wms/areas", async (req, res) => {
  try {
    const rows = await query(`
      SELECT sl.area,
             COUNT(*) FILTER (WHERE sl.status='active' AND sl.allow_receiving=true) AS "availableCount",
             COUNT(*) AS "totalCount"
      FROM storage_locations sl
      GROUP BY sl.area
      ORDER BY sl.area
    `);
    res.json({ ok: true, data: rows.rows });
  } catch (err) {
    res.status(500).json(errorEnvelope("AREAS_FAILED", err.message));
  }
});

app.get("/wms/stock", async (req, res) => {
  try {
    const { materialCode, iqcStatus, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (materialCode) { conditions.push(`m.code = $${idx++}`); params.push(materialCode); }
    if (iqcStatus) { conditions.push(`ml.iqc_status = $${idx++}`); params.push(iqcStatus); }
    const joins = "JOIN materials m ON m.id = ml.material_id LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id";
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const data = await query(
      `SELECT m.code AS "materialCode", m.name_zh, m.name_en, m.name_vi,
              ml.iqc_status AS "iqcStatus",
              COALESCE(SUM(CASE
                WHEN it.action IN ('RECEIVE','RETURN','LINE_RETURN','RETURN_TO_WAREHOUSE','ADJUST_IN') THEN it.qty
                WHEN it.action IN ('ISSUE_TO_LINE','CONSUME','SCRAP','IQC_SCRAP','ADJUST_OUT') THEN -it.qty
                ELSE 0 END),0)::int AS qty,
              GREATEST(COALESCE(SUM(CASE
                WHEN it.action IN ('RECEIVE','RETURN','LINE_RETURN','RETURN_TO_WAREHOUSE','ADJUST_IN') THEN it.qty
                WHEN it.action IN ('ISSUE_TO_LINE','CONSUME','SCRAP','IQC_SCRAP','ADJUST_OUT') THEN -it.qty
                ELSE 0 END),0) - SUM(COALESCE(ml.reserved_qty,0)), 0)::int AS "availableQty",
              SUM(COALESCE(ml.reserved_qty, 0))::int AS "reservedQty",
              sl.code AS "locationCode"
       FROM material_lots ml ${joins}
       LEFT JOIN inventory_transactions it ON it.material_lot_id = ml.id AND it.tx_status = 'posted'
       ${where}
       GROUP BY m.code, m.name_zh, m.name_en, m.name_vi, ml.iqc_status, sl.code
       ORDER BY m.code LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, Number(limit), Number(offset)],
    );
    res.json(listEnvelope(data.rows));
  } catch (err) {
    console.error("GET /wms/stock:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

app.get("/wms/inventory-transactions", async (req, res) => {
  try {
    const { action, workOrderCode, fromDate, toDate, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (action) { conditions.push(`it.action = $${idx++}`); params.push(action); }
    if (workOrderCode) { conditions.push(`wo.code = $${idx++}`); params.push(workOrderCode); }
    if (fromDate) { conditions.push(`it.occurred_at >= $${idx++}`); params.push(fromDate); }
    if (toDate) { conditions.push(`it.occurred_at <= $${idx++}`); params.push(toDate); }
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const data = await query(
      `SELECT it.id, it.tx_no AS "txNo", it.action, it.qty, it.tx_status AS "txStatus",
              m.code AS "materialCode", ml.lot_no AS "lotNo",
              fl.code AS "fromLocation", tl.code AS "toLocation", u.username AS operator,
              it.reference_type AS "referenceType", it.reference_no AS "referenceNo", wo.code AS "workOrderCode",
              it.occurred_at AS "occurredAt",
              COALESCE(json_agg(json_build_object('lotNo', ml.lot_no)) FILTER (WHERE ml.id IS NOT NULL), '[]') AS lots
       FROM inventory_transactions it
       LEFT JOIN material_lots ml ON ml.id = it.material_lot_id
       LEFT JOIN materials m ON m.id = ml.material_id
       LEFT JOIN storage_locations fl ON fl.id = it.from_location_id
       LEFT JOIN storage_locations tl ON tl.id = it.to_location_id
       LEFT JOIN users u ON u.id = it.operator_id
       LEFT JOIN work_orders wo ON wo.id = it.work_order_id
       ${where}
       GROUP BY it.id, it.tx_no, it.action, it.qty, it.tx_status, m.code, ml.lot_no,
                fl.code, tl.code, u.username, it.reference_type, it.reference_no, wo.code, it.occurred_at
       ORDER BY it.occurred_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, Number(limit), Number(offset)],
    );
    res.json(listEnvelope(data.rows));
  } catch (err) {
    console.error("GET /wms/inventory-transactions:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// Actual consumption is recorded only by posted CONSUME events. Picking and
// line issue are movements and therefore remain visible as unconsumed stock.
app.get("/wms/material-consumption-summary", requirePermission("wms.view"), async (req, res) => {
  try {
    const { q = "", fromDate, toDate, limit = 200 } = req.query;
    const dates = [], predicates = ["it.action='CONSUME'", "it.tx_status='posted'"];
    if (fromDate) { dates.push(fromDate); predicates.push(`it.occurred_at >= $${dates.length}`); }
    if (toDate) { dates.push(toDate); predicates.push(`it.occurred_at <= $${dates.length}`); }
    const search = `%${String(q).trim()}%`, maxRows = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
    const consumptionCte = `SELECT ml.material_id,SUM(it.qty)::float8 consumed_qty,COUNT(*)::int consumption_count,
      MAX(it.occurred_at) last_consumed_at FROM inventory_transactions it JOIN material_lots ml ON ml.id=it.material_lot_id
      WHERE ${predicates.join(" AND ")} GROUP BY ml.material_id`;
    const items = await query(`WITH consumed AS (${consumptionCte}), stock AS (
        SELECT material_id,SUM(GREATEST(received_qty,0))::float8 total_left_qty,
          SUM(GREATEST(COALESCE(reserved_qty,0),0))::float8 line_side_qty,
          SUM(GREATEST(received_qty-COALESCE(reserved_qty,0),0))::float8 warehouse_qty
        FROM material_lots GROUP BY material_id)
      SELECT m.id AS "materialId",m.code AS "materialCode",m.name_zh AS "nameZh",m.name_en AS "nameEn",m.name_vi AS "nameVi",m.uom,
        COALESCE(c.consumed_qty,0)::float8 AS "consumedQty",COALESCE(s.total_left_qty,0)::float8 AS "totalLeftQty",
        COALESCE(s.warehouse_qty,0)::float8 AS "warehouseQty",COALESCE(s.line_side_qty,0)::float8 AS "lineSideQty",
        COALESCE(c.consumption_count,0)::int AS "consumptionCount",c.last_consumed_at AS "lastConsumedAt"
      FROM materials m LEFT JOIN consumed c ON c.material_id=m.id LEFT JOIN stock s ON s.material_id=m.id
      WHERE ($${dates.length + 1}='' OR m.code ILIKE $${dates.length + 2} OR m.name_zh ILIKE $${dates.length + 2}
        OR m.name_en ILIKE $${dates.length + 2} OR m.name_vi ILIKE $${dates.length + 2})
        AND (COALESCE(c.consumed_qty,0)>0 OR COALESCE(s.total_left_qty,0)>0)
      ORDER BY COALESCE(c.consumed_qty,0) DESC,m.code LIMIT $${dates.length + 3}`,
      [...dates, String(q).trim(), search, maxRows]);
    const records = await query(`SELECT it.id,it.tx_no AS "txNo",m.code AS "materialCode",m.name_zh AS "nameZh",m.name_en AS "nameEn",m.name_vi AS "nameVi",
        ml.lot_no AS "lotNo",it.qty::float8,m.uom,wo.code AS "workOrderCode",it.reference_no AS "referenceNo",
        COALESCE(fp.line_code,tl.code,fl.code) AS station,
        u.username AS operator,it.occurred_at AS "occurredAt"
      FROM inventory_transactions it JOIN material_lots ml ON ml.id=it.material_lot_id JOIN materials m ON m.id=ml.material_id
      LEFT JOIN work_orders wo ON wo.id=it.work_order_id LEFT JOIN users u ON u.id=it.operator_id
      LEFT JOIN wms_fetch_packages fp ON it.reference_type='FETCH_PACKAGE' AND fp.qr_value=it.reference_no
      LEFT JOIN storage_locations fl ON fl.id=it.from_location_id LEFT JOIN storage_locations tl ON tl.id=it.to_location_id
      WHERE ${predicates.join(" AND ")} AND ($${dates.length + 1}='' OR m.code ILIKE $${dates.length + 2}
        OR ml.lot_no ILIKE $${dates.length + 2} OR wo.code ILIKE $${dates.length + 2})
      ORDER BY it.occurred_at DESC LIMIT $${dates.length + 3}`,[...dates,String(q).trim(),search,maxRows]);
    const summary = items.rows.reduce((total, row) => ({ consumedQty:total.consumedQty+Number(row.consumedQty),
      totalLeftQty:total.totalLeftQty+Number(row.totalLeftQty),warehouseQty:total.warehouseQty+Number(row.warehouseQty),
      lineSideQty:total.lineSideQty+Number(row.lineSideQty),materialCount:total.materialCount+1,
      consumptionCount:total.consumptionCount+Number(row.consumptionCount) }),
      {consumedQty:0,totalLeftQty:0,warehouseQty:0,lineSideQty:0,materialCount:0,consumptionCount:0});
    res.json(mutateEnvelope({summary,items:items.rows,records:records.rows}));
  } catch (err) {
    console.error("GET /wms/material-consumption-summary:", err.message);
    res.status(500).json(errorEnvelope("MATERIAL_CONSUMPTION_SUMMARY_FAILED", err.message));
  }
});

// ── WMS Pick Orders (generated on-the-fly from BOM + WO) ──────────────────

app.get("/wms/pick-orders", async (req, res) => {
  try {
    const workOrderCode = String(req.query.workOrderCode ?? "").trim();

    const woRes = await query(
      `SELECT w.id, w.code, w.planned_qty, w.completed_qty, w.status,
              w.created_at,
              p.id as product_id, p.code as product_code, p.name_zh as product_name_zh, p.name_en as product_name_en,
              pl.internal_code as line_code
       FROM work_orders w
       JOIN products p ON p.id = w.product_id
       JOIN production_lines pl ON pl.id = w.line_id
       WHERE ($1 = '' AND w.status IN ('released', 'running')) OR w.code = $1
       ORDER BY w.created_at ASC
       LIMIT 50`,
      [workOrderCode]
    );
    if (woRes.rows.length === 0) {
      if (workOrderCode) return res.status(404).json(errorEnvelope("NOT_FOUND", `Work order '${workOrderCode}' not found`));
      return res.json(listEnvelope([], 0));
    }

    // Material issue is driven by the collect list: the line picker may only
    // take materials the warehouse has ALREADY collected (status=COLLECTED).
    // For WOs with a collect order, items come from those collected lines —
    // never from the whole BOM. WOs without a collect order keep the legacy
    // BOM+FIFO projection so older screens still work.
    const withCollect = (await query(
      `SELECT w.code,
              c.id AS "collectOrderId", c.collect_no AS "collectNo",
              c.work_order_id AS "workOrderId", c.line_code AS "lineCode"
         FROM work_orders w
         JOIN wms_collect_orders c ON c.work_order_code = w.code AND c.status <> 'CANCELLED'
        WHERE w.code = ANY($1::varchar[])
        ORDER BY c.id DESC`, [woRes.rows.map((w) => w.code)]
    )).rows;
    const collectByWo = new Map();
    for (const row of withCollect) {
      if (!collectByWo.has(row.code)) collectByWo.set(row.code, row);
    }

    const pickOrders = [];
    for (const wo of woRes.rows) {
      const collect = collectByWo.get(wo.code);
      if (collect) {
        // Only lines the warehouse already collected (and not yet issued).
        // pickedQty comes from the ledger: posted (non-void) PICK transactions
        // for this WO on the line's lot, allocated across duplicate-lot lines
        // in line_no order so each line shows its own share, capped at required.
        const rows = (await query(
          `SELECT l.id, l.line_no AS "lineNo", l.material_code AS "materialCode",
                  l.material_name AS "materialName", l.ruijing_code AS "ruijingCode",
                  l.lot_no AS "lotNo", l.location_code AS "locationCode",
                  l.location_qr AS "locationQr", l.required_qty AS "requiredQty",
                  l.status, l.process_domain AS "processDomain",
                  GREATEST(0, LEAST(l.required_qty,
                    COALESCE(p.picked_lot, 0)
                    - COALESCE(SUM(l.required_qty) OVER (PARTITION BY UPPER(COALESCE(l.lot_no, '')) ORDER BY l.line_no
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
                  )) AS "pickedQty"
             FROM wms_collect_order_lines l
             LEFT JOIN LATERAL (
               SELECT SUM(t.qty) AS picked_lot
                 FROM inventory_transactions t
                 JOIN material_lots ml ON ml.id = t.material_lot_id
                WHERE t.work_order_id = $2 AND t.action = 'PICK' AND NOT t.voided
                  AND UPPER(ml.lot_no) = UPPER(l.lot_no)
             ) p ON TRUE
            WHERE l.collect_order_id = $1 AND l.status = 'COLLECTED'
            ORDER BY l.line_no`, [collect.collectOrderId, wo.id]
        )).rows;
        const items = rows.map((l) => {
          const name = l.materialName || {};
          return {
            id: `cl-${l.id}`, pickOrderId: `po-${wo.code}`,
            materialCode: l.materialCode,
            ruijingCode: l.ruijingCode || null,
            materialName: { name_zh: name.zh || "", name_en: name.en || "", name_vi: name.vi || "" },
            requiredQty: Number(l.requiredQty),
            pickedQty: Number(l.pickedQty ?? 0),
            lotNo: l.lotNo || null,
            locationCode: l.locationCode || null,
            locationQr: l.locationQr || null,
            materialSn: null,
            processDomain: l.processDomain || null,
            status: "collected_ready",
          };
        });
        pickOrders.push({
          id: `po-${wo.code}`, orderNo: `PO-${wo.code}`, workOrderCode: wo.code,
          lineCode: collect.lineCode, status: "ready", operator: null,
          createdAt: wo.created_at ?? new Date().toISOString(), completedAt: null,
          items,
          collectNo: collect.collectNo,
        });
      } else {
        pickOrders.push(await buildWmsPickOrder(wo));
      }
    }
    res.json(listEnvelope(pickOrders, pickOrders.length));
  } catch (err) {
    console.error("GET /wms/pick-orders:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PDA pick acceptance: the line operator/manager reviews a WMS pick list (PO),
// checks each material line, and signs to accept. This is the WMS outbound
// posting point — it deducts material_lots.received_qty and writes an
// ISSUE_TO_LINE inventory transaction per line, then records one immutable
// wms_pick_acceptance audit row (signature). Atomic in a single transaction.
app.post("/wms/pick-orders/:workOrderCode/accept", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const woCode = String(req.params.workOrderCode || "").trim();
    const p = req.body?.payload ?? req.body ?? {};
    const operator = String(p.operator || "").trim();
    const signatureHash = String(p.signatureHash || "").trim();
    const evidenceQr = p.evidenceQr ? String(p.evidenceQr).trim() : null;
    const notes = p.notes ? String(p.notes).trim() : null;
    const items = Array.isArray(p.items) ? p.items : [];
    if (!woCode) return res.status(400).json(errorEnvelope("VALIDATION", "workOrderCode required"));
    if (!operator) return res.status(400).json(errorEnvelope("VALIDATION", "operator required"));
    if (!signatureHash || signatureHash.length < 16) return res.status(400).json(errorEnvelope("VALIDATION", "signatureHash required (≥16 chars)"));
    if (!items.length) return res.status(400).json(errorEnvelope("VALIDATION", "items array required"));

    await client.query("BEGIN");
    const wo = (await client.query("SELECT id, code FROM work_orders WHERE code=$1 FOR UPDATE", [woCode])).rows[0];
    if (!wo) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("NOT_FOUND", "Work order not found")); }
    const operatorId = await resolveOperatorId(operator);

    // Normalize + validate every line before writing anything.
    const normalized = [];
    for (const it of items) {
      const lotNo = String(it.lotNo || "").trim();
      const qty = Number(it.qty);
      if (!lotNo) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "each item requires lotNo")); }
      if (!Number.isFinite(qty) || qty <= 0) { await client.query("ROLLBACK"); return res.status(400).json(errorEnvelope("VALIDATION", "each item requires positive qty")); }
      normalized.push({ materialCode: it.materialCode ? String(it.materialCode).trim() : null, lotNo, qty });
    }

    const acc = (await client.query(
      `INSERT INTO wms_pick_acceptance
         (wo_code, work_order_id, operator, operator_id, signature_hash, evidence_qr, item_count, items, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       RETURNING id, accepted_at`,
      [wo.code, wo.id, operator, operatorId, signatureHash.slice(0, 128), evidenceQr ? evidenceQr.slice(0, 240) : null,
       normalized.length, JSON.stringify(normalized), notes]
    )).rows[0];

    const posted = [];
    for (const line of normalized) {
      const lot = (await client.query(
        `SELECT ml.id, ml.material_id, ml.received_qty, COALESCE(ml.reserved_qty,0) reserved_qty,
                ml.iqc_status, ml.lot_status, m.code AS material_code
           FROM material_lots ml JOIN materials m ON m.id = ml.material_id
          WHERE ml.lot_no=$1 FOR UPDATE`,
        [line.lotNo]
      )).rows[0];
      if (!lot) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("LOT_NOT_FOUND", `Lot not found: ${line.lotNo}`)); }
      if (lot.iqc_status !== "released" || lot.lot_status !== "open") {
        await client.query("ROLLBACK");
        return res.status(409).json(errorEnvelope("LOT_BLOCKED", `Lot ${line.lotNo} must be open and IQC released (iqc=${lot.iqc_status}, status=${lot.lot_status})`));
      }
      if (line.qty > Number(lot.received_qty)) {
        await client.query("ROLLBACK");
        return res.status(409).json(errorEnvelope("INSUFFICIENT_QTY", `Only ${lot.received_qty} on-hand for lot ${line.lotNo}`));
      }
      await client.query(`UPDATE material_lots SET received_qty = GREATEST(received_qty - $1, 0), updated_at=NOW() WHERE id=$2`, [line.qty, lot.id]);
      const tx = (await client.query(
        `INSERT INTO inventory_transactions
           (tx_no, action, material_lot_id, work_order_id, qty, operator_id, tx_status, reference_type, reference_no)
         VALUES ($1,'ISSUE_TO_LINE',$2,$3,$4,$5,'posted','PICK_ACCEPTANCE',$6) RETURNING id`,
        [`PA_${acc.id}_${Date.now()}`, lot.id, wo.id, line.qty, operatorId, String(acc.id)]
      )).rows[0];
      posted.push({ lotNo: line.lotNo, materialCode: lot.material_code, qty: line.qty, txId: tx.id });
    }

    // Two-stage collect status: accepted by the line -> mark collect lines ISSUED.
    for (const line of normalized) {
      await client.query(
        `UPDATE wms_collect_order_lines SET status='ISSUED', updated_at=NOW()
          WHERE UPPER(lot_no)=UPPER($1) AND status IN ('PENDING','COLLECTED')
            AND collect_order_id IN (SELECT id FROM wms_collect_orders WHERE work_order_code=$2 AND status <> 'CANCELLED')`,
        [line.lotNo, wo.code]
      );
    }
    await client.query(
      `UPDATE wms_collect_orders SET status='ISSUED', updated_at=NOW() WHERE work_order_code=$1
        AND status IN ('OPEN','PARTIAL','COLLECTED')
        AND NOT EXISTS (SELECT 1 FROM wms_collect_order_lines l WHERE l.collect_order_id=wms_collect_orders.id AND l.status IN ('PENDING','COLLECTED'))`,
      [wo.code]
    );

    await client.query("COMMIT");
    res.status(201).json({ success: true, data: { acceptanceId: acc.id, workOrderCode: wo.code, operator, acceptedAt: acc.accepted_at, deducted: posted } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/pick-orders/:wo/accept:", err.message);
    res.status(500).json(errorEnvelope("PICK_ACCEPT_FAILED", err.message));
  } finally { client.release(); }
});

// Read-only history of pick acceptances for a work order.
app.get("/wms/pick-orders/:workOrderCode/acceptance-history", requirePermission("wms.view"), async (req, res) => {
  try {
    const rows = (await query(
      `SELECT id, wo_code, operator, item_count, signature_hash, evidence_qr, notes, accepted_at
         FROM wms_pick_acceptance WHERE wo_code=$1 ORDER BY accepted_at DESC, id DESC`,
      [String(req.params.workOrderCode || "").trim()]
    )).rows;
    res.json({ success: true, data: { items: rows } });
  } catch (err) {
    console.error("GET /wms/pick-orders/:wo/acceptance-history:", err.message);
    res.status(500).json(errorEnvelope("PICK_ACCEPTANCE_HISTORY_FAILED", err.message));
  }
});

app.post("/wms/transactions", requirePermission("wms.execute"), async (req, res) => {
  try {
    const raw = req.body?.payload ?? req.body ?? {};
    const action     = req.body?.action ?? raw.action;
    const lotNo     = raw.lotNo;
    const qty        = Number(raw.qty);
    const operator   = req.user?.username ?? raw.operator ?? raw.operatorUsername ?? "admin";
    const workOrderCode = raw.workOrderCode;
    const fetchPackageQr = String(raw.fetchPackageQr || "").trim();

    if (!action)  return res.status(400).json(errorEnvelope("VALIDATION", "action required"));
    if (!Number.isFinite(qty) || qty === 0 || (action !== "ADJUST" && qty < 0)) {
      return res.status(400).json(errorEnvelope("VALIDATION", action === "ADJUST" ? "adjustment qty must be non-zero" : "qty must be > 0"));
    }

    // Resolve operator
    const opR = /^\d+$/.test(String(operator))
      ? await query("SELECT id FROM users WHERE id = $1", [operator])
      : await query("SELECT id FROM users WHERE username = $1", [operator]);
    const operatorId = opR.rows[0]?.id ?? 10; // fallback to admin (id=10)

    // Resolve material lot
    if (!lotNo && !raw.materialLotId) {
      return res.status(400).json(errorEnvelope("VALIDATION", "lotNo or materialLotId required"));
    }
    await query("SELECT * FROM wms_refresh_material_lifecycle()");
    const lot = lotNo
      ? (await query("SELECT id, lot_no, received_qty, reserved_qty, iqc_status, lifecycle_status FROM material_lots WHERE lot_no = $1", [lotNo])).rows[0]
      : (await query("SELECT id, lot_no, received_qty, reserved_qty, iqc_status, lifecycle_status FROM material_lots WHERE id = $1", [raw.materialLotId])).rows[0];

    if (!lot) return res.status(404).json(errorEnvelope("NOT_FOUND", "Material lot not found"));
    const lifetimeControlledActions = new Set(["ISSUE_TO_LINE", "PUT_AWAY", "RESERVE", "PICK", "TRANSFER"]);
    if (lifetimeControlledActions.has(action) && lot.lifecycle_status === "EXPIRED_ISOLATED") {
      return res.status(409).json(errorEnvelope("MATERIAL_EXPIRED", `Lot '${lot.lot_no}' is expired and isolated`));
    }

    // Validate IQC status allows this action
    const allowedStatuses = IQC_ALLOW_MAP[action];
    if (allowedStatuses && !allowedStatuses.includes(lot.iqc_status)) {
      return res.status(409).json(errorEnvelope(
        "IQC_STATUS_BLOCKED",
        `Lot '${lot.lot_no}' IQC status is '${lot.iqc_status}', action '${action}' requires one of: ${allowedStatuses.join(", ")}`
      ));
    }

    // Validate qty
    if (action === "ISSUE_TO_LINE" && qty > (Number(lot.received_qty) - Number(lot.reserved_qty))) {
      return res.status(409).json(errorEnvelope("INSUFFICIENT_QTY", `Lot '${lot.lot_no}' only has ${Number(lot.received_qty) - Number(lot.reserved_qty)} available units`));
    }
    if (action === "CONSUME" && qty > Number(lot.reserved_qty)) {
      return res.status(409).json(errorEnvelope("INSUFFICIENT_ISSUED_QTY", `Lot '${lot.lot_no}' only has ${Number(lot.reserved_qty)} issued units available to consume`));
    }
    let fetchPackage = null;
    if (action === "CONSUME") {
      if (!fetchPackageQr) return res.status(400).json(errorEnvelope("FETCH_PACKAGE_REQUIRED", "Scan the fetching package QR before consumption"));
      fetchPackage=(await query(`SELECT * FROM wms_fetch_packages WHERE qr_value=$1 OR package_no=$1`,[fetchPackageQr])).rows[0];
      if(!fetchPackage||!["RECEIVED","CONSUMING"].includes(fetchPackage.status))
        return res.status(409).json(errorEnvelope("FETCH_PACKAGE_NOT_RECEIVED", "The fetching package must complete PDA handover before consumption"));
      if(workOrderCode&&fetchPackage.work_order_code&&workOrderCode!==fetchPackage.work_order_code)
        return res.status(409).json(errorEnvelope("FETCH_PACKAGE_WORK_ORDER_MISMATCH", "Fetching package does not belong to this work order"));
    }

    // Resolve work order
    let workOrderId = null;
    if (workOrderCode) {
      const woR = await query("SELECT id FROM work_orders WHERE code = $1", [workOrderCode]);
      workOrderId = woR.rows[0]?.id ?? null;
    }

    // Resolve location IDs
    const fromLocationCode = raw.fromLocationCode ?? raw.fromLocation;
    const toLocationCode = raw.toLocationCode ?? raw.toLocation;
    const fromLocId = fromLocationCode
      ? (await query("SELECT id FROM storage_locations WHERE code = $1", [fromLocationCode])).rows[0]?.id : null;
    const toLocId = toLocationCode
      ? (await query("SELECT id FROM storage_locations WHERE code = $1", [toLocationCode])).rows[0]?.id : null;
    if (action === "TRANSFER" && !toLocId) {
      return res.status(422).json(errorEnvelope("LOCATION_REQUIRED", "valid toLocation is required"));
    }
    if (action === "ADJUST" && Number(lot.received_qty) + qty < 0) {
      return res.status(409).json(errorEnvelope("INSUFFICIENT_QTY", "adjustment would make inventory negative"));
    }

    // Insert transaction
    const result = await query(
      `INSERT INTO inventory_transactions
         (tx_no, action, material_lot_id, work_order_id, qty, from_location_id, to_location_id, operator_id, tx_status,reference_type,reference_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted',$9,$10) RETURNING id`,
      [`TXN_${Date.now()}`, action, lot.id, workOrderId, qty, fromLocId, toLocId, operatorId,fetchPackage?'FETCH_PACKAGE':null,fetchPackage?.qr_value||null],
    );

    // Update lot qty / reserved_qty based on action
    if (action === "ISSUE_TO_LINE") {
      await query(
        "UPDATE material_lots SET reserved_qty = reserved_qty + $1 WHERE id = $2",
        [qty, lot.id]
      );
    } else if (action === "CONSUME") {
      await query(
        "UPDATE material_lots SET received_qty = received_qty - $1, reserved_qty = GREATEST(0, reserved_qty - $1) WHERE id = $2",
        [qty, lot.id]
      );
      await query(`UPDATE wms_fetch_packages SET status='CONSUMING',updated_at=now() WHERE id=$1 AND status='RECEIVED'`,[fetchPackage.id]);
      await query(`INSERT INTO wms_fetch_package_events(fetch_package_id,event_type,actor,station_code,detail) VALUES($1,'CONSUMED',$2,$3,$4::jsonb)`,
        [fetchPackage.id,String(operator),String(raw.stationCode||raw.reason||'').replace(/^STATION:/,''),JSON.stringify({transactionId:result.rows[0].id,materialLotId:lot.id,lotNo:lot.lot_no,workOrderCode,qty})]);
    } else if (action === "RETURN_FROM_LINE") {
      await query(
        "UPDATE material_lots SET reserved_qty = GREATEST(0, reserved_qty - $1) WHERE id = $2",
        [qty, lot.id]
      );
    } else if (action === "PICK") {
      await query(
        "UPDATE material_lots SET reserved_qty = GREATEST(0, reserved_qty - $1) WHERE id = $2",
        [qty, lot.id]
      );
    } else if (action === "SCRAP") {
      await query(
        "UPDATE material_lots SET received_qty = received_qty - $1, iqc_status = 'rejected' WHERE id = $2",
        [qty, lot.id]
      );
    } else if (action === "IQC_HOLD") {
      // IQC hold: mark lot as hold (failed IQC inspection)
      await query(
        "UPDATE material_lots SET iqc_status = 'hold' WHERE id = $1",
        [lot.id]
      );
    } else if (action === "IQC_REJECT") {
      // IQC rejection: mark lot as rejected without deducting qty (lot will be returned or scrapped later)
      await query(
        "UPDATE material_lots SET iqc_status = 'rejected' WHERE id = $1",
        [lot.id]
      );
      await detachRejectedLotFromPallet({ query: (...args) => query(...args) }, lot.lot_no, { user: { username: operator } }, "WMS_TRANSACTION");
    } else if (action === "IQC_RELEASE") {
      // IQC release: mark lot as released — it can now be put away or issued to line
      await query(
        "UPDATE material_lots SET iqc_status = 'released' WHERE id = $1",
        [lot.id]
      );
    } else if (action === "PUT_AWAY") {
      // PUT_AWAY moves stock only; IQC_RELEASE is a separate quality decision.
      let storageLocationId = null;
      if (toLocationCode) {
        const locR = await query("SELECT id FROM storage_locations WHERE code = $1", [toLocationCode]);
        storageLocationId = locR.rows[0]?.id ?? null;
      }
      await query(
        "UPDATE material_lots SET storage_location_id = COALESCE($1, storage_location_id) WHERE id = $2",
        [storageLocationId, lot.id]
      );
    } else if (action === "TRANSFER") {
      await query("UPDATE material_lots SET storage_location_id = $1 WHERE id = $2", [toLocId, lot.id]);
    } else if (action === "ADJUST") {
      const resultingQty = Number(lot.received_qty) + qty;
      await query("UPDATE material_lots SET received_qty = $1 WHERE id = $2", [resultingQty, lot.id]);
    }

    res.status(201).json(mutateEnvelope({
      id: result.rows[0].id,
      action,
      lotNo: lot.lot_no,
      qty,
    }));
  } catch (err) {
    console.error("POST /wms/transactions:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// ── WMS High-Level Operations ─────────────────────────────────────────────────

app.post("/wms/issue-to-line", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { lotNo, workOrderCode, qty, operator, reservationId } = req.body?.payload ?? req.body ?? {};
    const issueQty = Number(qty);
    if (!lotNo || !workOrderCode || !reservationId || !Number.isFinite(issueQty) || issueQty <= 0) {
      return res.status(400).json(errorEnvelope("VALIDATION", "lotNo, workOrderCode, reservationId and qty required"));
    }
    await client.query("BEGIN");
    const lot = await client.query(`SELECT ml.id,ml.material_id,ml.received_qty,COALESCE(ml.reserved_qty,0) reserved_qty,
      ml.iqc_status,ml.expiry_date,ml.opened_at,ml.opened_shelf_life_days FROM material_lots ml WHERE ml.lot_no=$1 FOR UPDATE`, [lotNo]);
    const wo = await client.query("SELECT id,bom_id,status FROM work_orders WHERE code=$1 FOR UPDATE", [workOrderCode]);
    if (!lot.rows[0] || !wo.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json(errorEnvelope("NOT_FOUND", !lot.rows[0] ? "Lot not found" : "Work order not found"));
    }
    if (!["released", "running"].includes(String(wo.rows[0].status))) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("WORK_ORDER_BLOCKED", "Work order must be released or running"));
    }
    if (lot.rows[0].iqc_status !== "released") {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("IQC_STATUS_BLOCKED", `Lot must be 'released' to issue to line, current: '${lot.rows[0].iqc_status}'`));
    }
    const effectiveExpiry=lot.rows[0].opened_at&&lot.rows[0].opened_shelf_life_days!=null
      ? new Date(new Date(lot.rows[0].opened_at).getTime()+Number(lot.rows[0].opened_shelf_life_days)*86400000)
      : lot.rows[0].expiry_date?new Date(lot.rows[0].expiry_date):null;
    if(effectiveExpiry&&effectiveExpiry.getTime()<new Date(new Date().toDateString()).getTime()){
      await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("MATERIAL_EXPIRED","Expired material cannot be issued"));
    }
    const bomMatch = await client.query(`SELECT 1 FROM bom_lines WHERE bom_id=$1 AND material_id=$2`, [wo.rows[0].bom_id, lot.rows[0].material_id]);
    if (!bomMatch.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("WRONG_WORK_ORDER_MATERIAL", "Material is not present in the frozen work-order BOM"));
    }
    const reservation=(await client.query(`SELECT id,reserved_qty,status FROM material_lot_reservations
      WHERE id=$1 AND material_lot_id=$2 AND work_order_id=$3 FOR UPDATE`,[reservationId,lot.rows[0].id,wo.rows[0].id])).rows[0];
    if(!reservation||reservation.status!=="fulfilled"||issueQty!==Number(reservation.reserved_qty)){
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("PICK_CONFIRMATION_REQUIRED","A matching fulfilled reservation with exact quantity is required"));
    }
    const alreadyIssued=(await client.query(`SELECT 1 FROM inventory_transactions WHERE action='ISSUE_TO_LINE'
      AND reference_type='LOT_RESERVATION' AND reference_no=$1 AND tx_status='posted'`,[String(reservationId)])).rows[0];
    if(alreadyIssued){await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("DUPLICATE_ISSUE","Reservation was already issued"));}
    const available = Number(lot.rows[0].received_qty);
    if (issueQty > available) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("INSUFFICIENT_QTY", `Only ${available} available for lot '${lotNo}'`));
    }

    const operatorId = await resolveOperatorId(operator);
    const tx = await client.query(
      `INSERT INTO inventory_transactions
         (tx_no, action, material_lot_id, work_order_id, qty, operator_id, tx_status,reference_type,reference_no)
       VALUES ($1,'ISSUE_TO_LINE',$2,$3,$4,$5,'posted','LOT_RESERVATION',$6) RETURNING id, tx_no`,
      [`TXN_${Date.now()}`, lot.rows[0].id, wo.rows[0].id, issueQty, operatorId,String(reservationId)],
    );
    await client.query(`UPDATE material_lots SET received_qty=received_qty-$1,
      reserved_qty=GREATEST(0,reserved_qty-$1) WHERE id=$2`, [issueQty, lot.rows[0].id]);
    // Two-stage collect status: the line took the material -> mark collect lines ISSUED.
    await client.query(
      `UPDATE wms_collect_order_lines SET status='ISSUED', updated_at=NOW()
        WHERE UPPER(lot_no)=UPPER($1) AND status IN ('PENDING','COLLECTED')
          AND collect_order_id IN (SELECT id FROM wms_collect_orders WHERE work_order_code=$2 AND status <> 'CANCELLED')`,
      [lotNo, workOrderCode]
    );
    await client.query(
      `UPDATE wms_collect_orders SET status='ISSUED', updated_at=NOW() WHERE work_order_code=$1
        AND status IN ('OPEN','PARTIAL','COLLECTED')
        AND NOT EXISTS (SELECT 1 FROM wms_collect_order_lines l WHERE l.collect_order_id=wms_collect_orders.id AND l.status IN ('PENDING','COLLECTED'))`,
      [workOrderCode]
    );
    await client.query("COMMIT");
    res.status(201).json(mutateEnvelope({ id: tx.rows[0].id, txNo: tx.rows[0].tx_no, lotNo, workOrderCode, qty: issueQty }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/issue-to-line:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  } finally { client.release(); }
});

app.post("/wms/reservations", requirePermission("wms.execute"), async (req,res)=>{
  const client=await pgPool.connect();
  try{
    const p=req.body?.payload??req.body??{},qty=Number(p.qty);
    if(!p.lotNo||!p.workOrderCode||!(qty>0))return res.status(400).json(errorEnvelope("VALIDATION","lotNo, workOrderCode and positive qty required"));
    await client.query("BEGIN");
    const lot=(await client.query(`SELECT ml.id,ml.material_id,ml.received_qty,COALESCE(ml.reserved_qty,0) reserved_qty,ml.iqc_status,ml.lot_status,
      ml.expiry_date,ml.opened_at,ml.opened_shelf_life_days
      FROM material_lots ml WHERE ml.lot_no=$1 FOR UPDATE`,[p.lotNo])).rows[0];
    const wo=(await client.query("SELECT id,bom_id,status FROM work_orders WHERE code=$1",[p.workOrderCode])).rows[0];
    if(!lot||!wo){await client.query("ROLLBACK");return res.status(404).json(errorEnvelope("NOT_FOUND",!lot?"Lot not found":"Work order not found"));}
    if(lot.iqc_status!=="released"||lot.lot_status!=="open"){await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("LOT_BLOCKED","Lot must be open and IQC released"));}
    const effectiveExpiry=lot.opened_at&&lot.opened_shelf_life_days!=null
      ? new Date(new Date(lot.opened_at).getTime()+Number(lot.opened_shelf_life_days)*86400000)
      : lot.expiry_date?new Date(lot.expiry_date):null;
    if(effectiveExpiry&&effectiveExpiry.getTime()<new Date(new Date().toDateString()).getTime()){
      await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("MATERIAL_EXPIRED","Expired material cannot be reserved"));
    }
    if(!["released","running"].includes(String(wo.status))){await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("WORK_ORDER_BLOCKED","Work order must be released or running"));}
    const member=(await client.query("SELECT 1 FROM work_order_bom_requirements WHERE work_order_id=$1 AND material_id=$2",[wo.id,lot.material_id])).rows[0]
      ||(await client.query("SELECT 1 FROM bom_lines WHERE bom_id=$1 AND material_id=$2",[wo.bom_id,lot.material_id])).rows[0];
    if(!member){await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("WRONG_WORK_ORDER_MATERIAL","Material is not in the work-order BOM"));}
    const available=Number(lot.received_qty)-Number(lot.reserved_qty);
    if(qty>available){await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("INSUFFICIENT_QTY",`Only ${available} units are available`));}
    const operatorId=await resolveOperatorId(p.operator??"admin");
    const reservation=(await client.query(`INSERT INTO material_lot_reservations(material_lot_id,work_order_id,reserved_qty,status,reserved_by,expires_at)
      VALUES($1,$2,$3,'active',$4,$5) RETURNING id`,[lot.id,wo.id,qty,operatorId,p.expiresAt??null])).rows[0];
    await client.query("UPDATE material_lots SET reserved_qty=reserved_qty+$1 WHERE id=$2",[qty,lot.id]);
    await client.query(`INSERT INTO inventory_transactions(tx_no,action,material_lot_id,work_order_id,qty,operator_id,tx_status,reference_type,reference_no)
      VALUES($1,'RESERVE',$2,$3,$4,$5,'posted','LOT_RESERVATION',$6)`,[`RSV_${Date.now()}`,lot.id,wo.id,qty,operatorId,String(reservation.id)]);
    await client.query("COMMIT");res.status(201).json(mutateEnvelope({id:reservation.id,lotNo:p.lotNo,workOrderCode:p.workOrderCode,qty}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("RESERVATION_REJECTED",error.message));}
  finally{client.release();}
});

app.post("/wms/reservations/:id/pick",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT * FROM wms_refresh_material_lifecycle()");
    const reservation=(await client.query(`SELECT r.*,ml.lot_no,ml.lifecycle_status,wms_effective_lot_expiry(ml.id) effective_expiry FROM material_lot_reservations r JOIN material_lots ml ON ml.id=r.material_lot_id
      WHERE r.id=$1 FOR UPDATE OF r,ml`,[req.params.id])).rows[0];
    if(!reservation){await client.query("ROLLBACK");return res.status(404).json(errorEnvelope("NOT_FOUND","Reservation not found"));}
    if(reservation.status!=="active"){await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("INVALID_STATE","Only active reservation can be picked"));}
    if(reservation.lifecycle_status==='EXPIRED_ISOLATED'||(reservation.effective_expiry&&new Date(reservation.effective_expiry)<new Date())){
      await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("MATERIAL_EXPIRED","Expired or isolated material cannot be picked"));
    }
    const operatorId=await resolveOperatorId((req.body?.payload??req.body??{}).operator??"admin");
    await client.query("UPDATE material_lot_reservations SET status='fulfilled',fulfilled_at=now() WHERE id=$1",[reservation.id]);
    await client.query(`INSERT INTO inventory_transactions(tx_no,action,material_lot_id,work_order_id,qty,operator_id,tx_status,reference_type,reference_no)
      VALUES($1,'PICK',$2,$3,$4,$5,'posted','LOT_RESERVATION',$6)`,[`PICK_${Date.now()}`,reservation.material_lot_id,reservation.work_order_id,reservation.reserved_qty,operatorId,String(reservation.id)]);
    await client.query("COMMIT");res.status(201).json(mutateEnvelope({reservationId:reservation.id,lotNo:reservation.lot_no,qty:Number(reservation.reserved_qty)}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PICK_REJECTED",error.message));}finally{client.release();}
});

app.post("/wms/line-issues/:transactionId/acknowledge",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();
  try{
    const p=req.body?.payload??req.body??{};if(!p.receiver)return res.status(400).json(errorEnvelope("VALIDATION","receiver required"));
    await client.query("BEGIN");
    const issue=(await client.query(`SELECT id,work_order_id,material_lot_id,qty FROM inventory_transactions
      WHERE id=$1 AND action='ISSUE_TO_LINE' AND tx_status='posted' FOR UPDATE`,[req.params.transactionId])).rows[0];
    if(!issue){await client.query("ROLLBACK");return res.status(404).json(errorEnvelope("NOT_FOUND","Posted line issue not found"));}
    const operatorId=await resolveOperatorId(p.receiver);
    const ack=(await client.query(`INSERT INTO line_issue_acknowledgements
      (issue_transaction_id,work_order_id,material_lot_id,acknowledged_qty,acknowledged_by,receiver_name,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,acknowledged_at`,[issue.id,issue.work_order_id,issue.material_lot_id,issue.qty,operatorId,p.receiver,p.notes??null])).rows[0];
    await client.query("COMMIT");res.status(201).json(mutateEnvelope({id:ack.id,issueTransactionId:issue.id,qty:Number(issue.qty),acknowledgedAt:ack.acknowledged_at}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("ISSUE_ACK_REJECTED",error.message));}finally{client.release();}
});

// List ISSUE_TO_LINE transactions for a work order that have not yet been
// signed off in wms_wo_handover. Used by the warehouse → line handover page.
app.get("/wms/work-orders/:workOrderCode/handover-pending", requirePermission("wms.view"), async (req, res) => {
  try {
    const wo = (await query("SELECT id, code FROM work_orders WHERE code=$1", [req.params.workOrderCode])).rows[0];
    if (!wo) return res.status(404).json(errorEnvelope("NOT_FOUND", "Work order not found"));
    const rows = (await query(
      `SELECT it.id AS "issueTxId",
              it.tx_no AS "txNo",
              it.occurred_at AS "occurredAt",
              ml.lot_no AS "lotNo",
              m.code AS "materialCode",
              m.name_zh AS "materialName",
              it.qty::numeric AS qty,
              m.uom,
              (it.reference_no)::bigint AS "reservationId",
              fu.username AS "operatorFrom"
         FROM inventory_transactions it
         JOIN material_lots ml ON ml.id = it.material_lot_id
         JOIN materials m ON m.id = ml.material_id
         LEFT JOIN users fu ON fu.id = it.operator_id
        WHERE it.work_order_id = $1
          AND it.action = 'ISSUE_TO_LINE'
          AND it.tx_status = 'posted'
          AND NOT EXISTS (
            SELECT 1 FROM wms_wo_handover h WHERE h.issue_tx_id = it.id
          )
        ORDER BY it.occurred_at DESC, it.id DESC`,
      [wo.id]
    )).rows;
    res.json({ success: true, data: { workOrderCode: wo.code, items: rows } });
  } catch (err) {
    console.error("GET /wms/work-orders/:wo/handover-pending:", err.message);
    res.status(500).json(errorEnvelope("HANDOVER_PENDING_FAILED", err.message));
  }
});

// Two-side handover: warehouse operator hands material to the line operator.
// One row per line-issue transaction. Pure metadata — never mutates
// inventory_transactions or material_lots.
app.post("/wms/work-orders/:workOrderCode/handover", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const woCode = req.params.workOrderCode;
    const p = req.body?.payload ?? req.body ?? {};
    const operatorTo = String(p.operatorTo ?? "").trim();
    const signatureHash = String(p.signatureHash ?? "").trim();
    const evidenceQr = p.evidenceQr ? String(p.evidenceQr).trim() : null;
    const notes = p.notes ? String(p.notes).trim() : null;
    const items = Array.isArray(p.items) ? p.items : [];
    if (!operatorTo) return res.status(400).json(errorEnvelope("VALIDATION", "operatorTo required"));
    if (!signatureHash || signatureHash.length < 16) return res.status(400).json(errorEnvelope("VALIDATION", "signatureHash required (≥16 chars)"));
    if (!items.length) return res.status(400).json(errorEnvelope("VALIDATION", "items array required"));
    await client.query("BEGIN");
    const wo = (await client.query("SELECT id, code FROM work_orders WHERE code=$1 FOR UPDATE", [woCode])).rows[0];
    if (!wo) { await client.query("ROLLBACK"); return res.status(404).json(errorEnvelope("NOT_FOUND", "Work order not found")); }
    const operatorToId = await resolveOperatorId(operatorTo);
    const inserted = [];
    for (const item of items) {
      const issueTxId = Number(item.issueTxId ?? item.issue_tx_id);
      if (!Number.isFinite(issueTxId) || issueTxId <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json(errorEnvelope("VALIDATION", "each item requires issueTxId"));
      }
      const tx = (await client.query(
        `SELECT it.id, it.qty, it.work_order_id, it.material_lot_id, ml.lot_no, m.code AS material_code, m.uom,
                fu.username AS operator_from
           FROM inventory_transactions it
           JOIN material_lots ml ON ml.id = it.material_lot_id
           JOIN materials m ON m.id = ml.material_id
           LEFT JOIN users fu ON fu.id = it.operator_id
          WHERE it.id=$1 AND it.work_order_id=$2 AND it.action='ISSUE_TO_LINE' AND it.tx_status='posted'`,
        [issueTxId, wo.id]
      )).rows[0];
      if (!tx) {
        await client.query("ROLLBACK");
        return res.status(404).json(errorEnvelope("NOT_FOUND", `Issue tx ${issueTxId} not in this work order`));
      }
      const dup = (await client.query("SELECT 1 FROM wms_wo_handover WHERE issue_tx_id=$1", [issueTxId])).rows[0];
      if (dup) { await client.query("ROLLBACK"); return res.status(409).json(errorEnvelope("DUPLICATE_HANDOVER", `Issue tx ${issueTxId} already handed over`)); }
      const operatorFromId = item.operatorFromId ? Number(item.operatorFromId) : null;
      const row = (await client.query(
        `INSERT INTO wms_wo_handover
           (wo_code, work_order_id, issue_tx_id, reservation_id,
            material_lot_id, lot_no, material_code, qty, uom,
            operator_from_id, operator_from, operator_to_id, operator_to,
            signature_hash, evidence_qr, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id, wo_code, issue_tx_id, lot_no, qty::numeric AS qty, uom,
                   operator_from, operator_to, operator_to_ack_at, signature_hash`,
        [
          wo.code, wo.id, tx.id,
          item.reservationId ? Number(item.reservationId) : null,
          tx.material_lot_id, tx.lot_no, tx.material_code, tx.qty, tx.uom,
          operatorFromId,
          tx.operator_from ?? "warehouse",
          operatorToId, operatorTo,
          signatureHash, evidenceQr, notes,
        ]
      )).rows[0];
      inserted.push(row);
    }
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: { workOrderCode: wo.code, signedCount: inserted.length, items: inserted } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/work-orders/:wo/handover:", err.message);
    res.status(500).json(errorEnvelope("HANDOVER_FAILED", err.message));
  } finally { client.release(); }
});

// Read-only history of handover signatures for a work order.
app.get("/wms/work-orders/:workOrderCode/handover-history", requirePermission("wms.view"), async (req, res) => {
  try {
    const wo = (await query("SELECT id, code FROM work_orders WHERE code=$1", [req.params.workOrderCode])).rows[0];
    if (!wo) return res.status(404).json(errorEnvelope("NOT_FOUND", "Work order not found"));
    const rows = (await query(
      `SELECT h.id, h.wo_code, h.issue_tx_id, h.lot_no, h.material_code, h.qty::numeric AS qty, h.uom,
              h.operator_from, h.operator_to, h.operator_to_ack_at, h.signature_hash, h.evidence_qr, h.notes
         FROM wms_wo_handover h
        WHERE h.wo_code = $1
        ORDER BY h.operator_to_ack_at DESC, h.id DESC`,
      [wo.code]
    )).rows;
    res.json({ success: true, data: { workOrderCode: wo.code, items: rows } });
  } catch (err) {
    console.error("GET /wms/work-orders/:wo/handover-history:", err.message);
    res.status(500).json(errorEnvelope("HANDOVER_HISTORY_FAILED", err.message));
  }
});

app.get("/wms/work-orders/:workOrderCode/material-reconciliation",requirePermission("wms.view"),async(req,res)=>{
  try{
    const wo=(await query("SELECT id,code FROM work_orders WHERE code=$1",[req.params.workOrderCode])).rows[0];
    if(!wo)return res.status(404).json(errorEnvelope("NOT_FOUND","Work order not found"));
    const rows=await query(`SELECT r.material_id,m.code AS material_code,r.required_qty,
      COALESCE(sum(it.qty) FILTER(WHERE it.action='ISSUE_TO_LINE'),0) issued_qty,
      COALESCE(sum(it.qty) FILTER(WHERE it.action='RETURN_FROM_LINE'),0) returned_qty,
      COALESCE((SELECT sum(w.qty) FROM work_order_bom_writeoffs w WHERE w.requirement_id=r.id AND w.status='POSTED' AND w.stage<>'REVERSAL'),0) consumed_qty,
      COALESCE((SELECT sum(d.difference_qty) FROM work_order_material_differences d WHERE d.work_order_id=r.work_order_id AND d.material_id=r.material_id AND d.status='APPROVED'),0) approved_difference_qty
      FROM work_order_bom_requirements r JOIN materials m ON m.id=r.material_id
      LEFT JOIN material_lots ml ON ml.material_id=r.material_id
      LEFT JOIN inventory_transactions it ON it.material_lot_id=ml.id AND it.work_order_id=r.work_order_id AND it.tx_status='posted'
      WHERE r.work_order_id=$1 GROUP BY r.id,m.id ORDER BY m.code`,[wo.id]);
    const items=rows.rows.map(row=>({...row,balanced:Number(row.issued_qty)===Number(row.consumed_qty)+Number(row.returned_qty)+Number(row.approved_difference_qty)}));
    res.json(envelope({workOrderCode:wo.code,balanced:items.length>0&&items.every(row=>row.balanced),items}));
  }catch(error){res.status(500).json(errorEnvelope("RECONCILIATION_QUERY_FAILED",error.message));}
});

app.get("/wms/work-orders/:workOrderCode/lot-recommendations/:materialCode",requirePermission("wms.view"),async(req,res)=>{
  try{
    const wo=(await query("SELECT id FROM work_orders WHERE code=$1",[req.params.workOrderCode])).rows[0];
    const material=(await query("SELECT id FROM materials WHERE UPPER(code)=UPPER($1)",[req.params.materialCode])).rows[0];
    if(!wo||!material)return res.status(404).json(errorEnvelope("NOT_FOUND",!wo?"Work order not found":"Material not found"));
    const member=(await query("SELECT 1 FROM work_order_bom_requirements WHERE work_order_id=$1 AND material_id=$2",[wo.id,material.id])).rows[0];
    if(!member)return res.status(409).json(errorEnvelope("WRONG_WORK_ORDER_MATERIAL","Material is not in the frozen work-order BOM"));
    const lots=await query(`SELECT ml.id,ml.lot_no AS "lotNo",ml.received_qty-COALESCE(ml.reserved_qty,0) AS "availableQty",
      ml.received_at AS "receivedAt",ml.expiry_date AS "sealedExpiryDate",ml.opened_at AS "openedAt",ml.opened_shelf_life_days AS "openedShelfLifeDays",
      CASE WHEN ml.opened_at IS NOT NULL AND ml.opened_shelf_life_days IS NOT NULL
        THEN ml.opened_at+(ml.opened_shelf_life_days||' days')::interval ELSE ml.expiry_date::timestamp END AS "effectiveExpiryAt",
      sl.code AS "locationCode"
      FROM material_lots ml LEFT JOIN storage_locations sl ON sl.id=ml.storage_location_id
      WHERE ml.material_id=$1 AND ml.iqc_status='released' AND ml.lot_status='open'
        AND ml.received_qty-COALESCE(ml.reserved_qty,0)>0
        -- 手工冻结（migration 332）：冻结批次不推荐给发料员
        AND NOT COALESCE(ml.locked,false)
        AND (CASE WHEN ml.opened_at IS NOT NULL AND ml.opened_shelf_life_days IS NOT NULL
          THEN ml.opened_at+(ml.opened_shelf_life_days||' days')::interval ELSE ml.expiry_date::timestamp END IS NULL
          OR CASE WHEN ml.opened_at IS NOT NULL AND ml.opened_shelf_life_days IS NOT NULL
          THEN ml.opened_at+(ml.opened_shelf_life_days||' days')::interval ELSE ml.expiry_date::timestamp END>=CURRENT_DATE)
      ORDER BY ml.received_at ASC NULLS LAST,ml.id ASC`,[material.id]);
    res.json(envelope({policy:"FIFO",items:lots.rows}));
  }catch(error){res.status(500).json(errorEnvelope("LOT_RECOMMENDATION_FAILED",error.message));}
});

app.get("/wms/work-orders/:workOrderCode/material-shortages",requirePermission("wms.view"),async(req,res)=>{
  try{
    const wo=(await query("SELECT id,code FROM work_orders WHERE code=$1",[req.params.workOrderCode])).rows[0];
    if(!wo)return res.status(404).json(errorEnvelope("NOT_FOUND","Work order not found"));
    const rows=await query(`SELECT r.material_id,m.code AS "materialCode",m.name_zh AS "materialNameZh",m.name_en AS "materialNameEn",m.name_vi AS "materialNameVi",
      r.required_qty AS "requiredQty",COALESCE(inv.available_qty,0) AS "availableQty",
      GREATEST(r.required_qty-COALESCE(inv.available_qty,0),0) AS "shortageQty"
      FROM work_order_bom_requirements r JOIN materials m ON m.id=r.material_id
      LEFT JOIN LATERAL(SELECT sum(ml.received_qty-COALESCE(ml.reserved_qty,0)) available_qty FROM material_lots ml
        WHERE ml.material_id=r.material_id AND ml.iqc_status='released' AND ml.lot_status='open'
          AND (ml.expiry_date IS NULL OR ml.expiry_date>=CURRENT_DATE)) inv ON true
      WHERE r.work_order_id=$1 ORDER BY GREATEST(r.required_qty-COALESCE(inv.available_qty,0),0) DESC,m.code`,[wo.id]);
    const items=rows.rows.filter(row=>Number(row.shortageQty)>0);
    const unacknowledged=(await query(`SELECT count(*)::int count FROM inventory_transactions it LEFT JOIN line_issue_acknowledgements a ON a.issue_transaction_id=it.id
      WHERE it.work_order_id=$1 AND it.action='ISSUE_TO_LINE' AND it.tx_status='posted' AND a.id IS NULL`,[wo.id])).rows[0].count;
    res.json(envelope({workOrderCode:wo.code,hasShortage:items.length>0,unacknowledgedIssueCount:unacknowledged,items}));
  }catch(error){res.status(500).json(errorEnvelope("SHORTAGE_QUERY_FAILED",error.message));}
});

app.post("/wms/work-orders/:workOrderCode/material-differences",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},qty=Number(p.differenceQty),materialCode=String(p.materialCode||"").trim();
    if(!materialCode||!Number.isFinite(qty)||qty===0||!p.reasonCode||!p.reasonDetail)return res.status(400).json(errorEnvelope("VALIDATION","materialCode, non-zero differenceQty, reasonCode and reasonDetail required"));
    const row=await query(`INSERT INTO work_order_material_differences(work_order_id,material_id,difference_qty,reason_code,reason_detail,reported_by)
      SELECT wo.id,m.id,$3,$4,$5,$6 FROM work_orders wo JOIN work_order_bom_requirements r ON r.work_order_id=wo.id
      JOIN materials m ON m.id=r.material_id WHERE wo.code=$1 AND UPPER(m.code)=UPPER($2) RETURNING id,status`,
      [req.params.workOrderCode,materialCode,qty,p.reasonCode,p.reasonDetail,req.user?.userId??10]);
    if(!row.rows[0])return res.status(409).json(errorEnvelope("WRONG_WORK_ORDER_MATERIAL","Material is not in the frozen work-order BOM"));
    res.status(201).json(mutateEnvelope(row.rows[0]));
  }catch(error){res.status(409).json(errorEnvelope("DIFFERENCE_REJECTED",error.message));}
});

app.post("/wms/material-differences/:id/decision",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const decision=String((req.body?.payload??req.body??{}).decision||"").toUpperCase();
    if(!["APPROVE","REJECT"].includes(decision))return res.status(400).json(errorEnvelope("VALIDATION","APPROVE or REJECT required"));
    const row=await query(`UPDATE work_order_material_differences SET status=$2,approved_by=$3,approved_at=now()
      WHERE id=$1 AND status IN('OPEN','EXPLAINED') RETURNING *`,[req.params.id,decision==="APPROVE"?"APPROVED":"REJECTED",req.user?.userId??10]);
    if(!row.rows[0])return res.status(409).json(errorEnvelope("INVALID_STATE","Difference was already decided"));
    res.json(mutateEnvelope(row.rows[0]));
  }catch(error){res.status(500).json(errorEnvelope("DIFFERENCE_DECISION_FAILED",error.message));}
});

app.post("/wms/replenishment-requests",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();
  try{
    const p=req.body?.payload??req.body??{},qty=Number(p.qty);
    if(!p.workOrderCode||!p.originalRequisitionId||!p.materialCode||!(qty>0)||!p.reasonCode)return res.status(400).json(errorEnvelope("VALIDATION","workOrderCode, originalRequisitionId, materialCode, positive qty and reasonCode required"));
    await client.query("BEGIN");
    const origin=(await client.query(`SELECT r.id,r.work_order_id,r.work_order_code,r.line_code FROM requisitions r JOIN requisition_lines l ON l.requisition_id=r.id
      JOIN materials m ON m.id=l.material_id WHERE r.id=$1 AND r.work_order_code=$2 AND r.status IN('APPROVED','EXECUTING','COMPLETED') AND UPPER(m.code)=UPPER($3) LIMIT 1`,
      [p.originalRequisitionId,p.workOrderCode,p.materialCode])).rows[0];
    if(!origin){await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("ORIGINAL_REQUISITION_REQUIRED","Approved original requisition with matching WO/material required"));}
    const docNo=`RPL-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(Date.now()).slice(-6)}`;
    const rep=(await client.query(`INSERT INTO replenishments(doc_no,status,work_order_code,work_order_id,original_requisition_id,reason_code,line_code,requestor_name,notes,created_by)
      VALUES($1,'SUBMITTED',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,doc_no,status`,[docNo,p.workOrderCode,origin.work_order_id,origin.id,p.reasonCode,origin.line_code,p.requestor??"MES",p.notes??null,req.user?.userId??10])).rows[0];
    const material=(await client.query("SELECT id,code,name_zh,uom FROM materials WHERE UPPER(code)=UPPER($1)",[p.materialCode])).rows[0];
    await client.query(`INSERT INTO replenishment_lines(replenishment_id,material_id,material_code,material_name_zh,unit,requested_qty,line_status,remarks)
      VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7)`,[rep.id,material.id,material.code,material.name_zh,material.uom,qty,p.notes??null]);
    await client.query("COMMIT");res.status(201).json(mutateEnvelope(rep));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("REPLENISHMENT_REJECTED",error.message));}finally{client.release();}
});

app.post("/wms/return-from-line", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { lotNo, workOrderCode, qty, operator, reason, reasonCode } = req.body?.payload ?? req.body ?? {};
    const returnQty = Number(qty);
    if (!lotNo || !workOrderCode || !Number.isFinite(returnQty) || returnQty <= 0) {
      return res.status(400).json(errorEnvelope("VALIDATION", "lotNo, workOrderCode, and qty required"));
    }
    // Reason codes: UNUSED (未用退仓), DAMAGED (使用中破损), MISSING (缺料),
    // BROKEN (损坏), WASTE (超出合理损耗). Free-text `reason` kept as detail.
    const rc = String(reasonCode || "").trim().toUpperCase() || "UNUSED";
    const validRc = ["UNUSED", "DAMAGED", "MISSING", "BROKEN", "WASTE"];
    if (!validRc.includes(rc)) {
      return res.status(400).json(errorEnvelope("VALIDATION", `reasonCode must be one of ${validRc.join("/")}`));
    }
    await client.query("BEGIN");
    const lot = await client.query("SELECT id,iqc_status,received_qty FROM material_lots WHERE lot_no=$1 FOR UPDATE", [lotNo]);
    const wo = await client.query("SELECT id FROM work_orders WHERE code=$1", [workOrderCode]);
    if (!lot.rows[0] || !wo.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json(errorEnvelope("NOT_FOUND", !lot.rows[0] ? "Lot not found" : "Work order not found"));
    }
    if (lot.rows[0].iqc_status !== "released") {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("IQC_STATUS_BLOCKED", "Only released material may return to available stock"));
    }
    const balanceR = await client.query(`SELECT
      COALESCE(SUM(qty) FILTER(WHERE action='ISSUE_TO_LINE'),0)-
      COALESCE(SUM(qty) FILTER(WHERE action='RETURN_FROM_LINE'),0) AS outstanding
      FROM inventory_transactions WHERE material_lot_id=$1 AND work_order_id=$2 AND tx_status='posted'`, [lot.rows[0].id, wo.rows[0].id]);
    const outstanding = Number(balanceR.rows[0].outstanding);
    if (returnQty > outstanding) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("RETURN_QTY_EXCEEDED", `Only ${outstanding} issued units remain returnable`));
    }
    const actor = String(operator ?? req.user?.username ?? "UNKNOWN");
    // Immediate single-transaction return: credit stock back, post the
    // RETURN_FROM_LINE transaction and flip any ISSUED collect line back to
    // COLLECTED so the material is available to be picked again.
    await client.query(
      `UPDATE material_lots SET received_qty = received_qty + $1, updated_at = NOW() WHERE id = $2`,
      [returnQty, lot.rows[0].id]
    );
    const operatorId = await resolveOperatorId(actor);
    const tx = (await client.query(
      `INSERT INTO inventory_transactions
         (tx_no, action, material_lot_id, work_order_id, qty, operator_id, tx_status, reference_type, reference_no)
       VALUES ($1,'RETURN_FROM_LINE',$2,$3,$4,$5,'posted','LINE_RETURN',$6) RETURNING id, tx_no`,
      [`RTN_${Date.now()}_${Math.floor(Math.random()*9999)}`, lot.rows[0].id, wo.rows[0].id,
       returnQty, operatorId, `${rc}:${String(reason ?? "").slice(0, 200)}`]
    )).rows[0];
    // Reopen matching collect lines that were issued from this lot for this WO.
    const reopened = (await client.query(
      `UPDATE wms_collect_order_lines SET status='COLLECTED', updated_at=NOW(), scanned_qr=COALESCE(scanned_qr,$2)
        WHERE UPPER(COALESCE(lot_no,''))=UPPER($2)
          AND status='ISSUED'
          AND collect_order_id IN (SELECT id FROM wms_collect_orders WHERE work_order_code=$3 AND status <> 'CANCELLED')
        RETURNING id, line_no AS "lineNo", material_code AS "materialCode", status`,
      [lotNo, lotNo, workOrderCode]
    )).rows;
    await client.query(
      `UPDATE wms_collect_orders SET status='PARTIAL', updated_at=NOW()
        WHERE work_order_code=$1 AND status='ISSUED'`, [workOrderCode]
    );
    await client.query("COMMIT");
    res.status(201).json(mutateEnvelope({
      id: tx.id, txNo: tx.tx_no, lotNo, workOrderCode, qty: returnQty,
      reason: rc + (reason ? `: ${reason}` : ""),
      reasonCode: rc,
      reopenedLines: reopened.length,
      reopened,
    }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/return-from-line:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  } finally { client.release(); }
});

// POST /wms/supplier-returns — record return of rejected/hold lots back to supplier
app.post("/wms/supplier-returns", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { lotNo, materialCode, supplierCode, returnQty, reason, operator } = req.body?.payload ?? req.body ?? {};
    const qty = Number(returnQty);
    if (!lotNo || !Number.isFinite(qty) || qty <= 0 || !String(reason ?? "").trim()) {
      return res.status(400).json(errorEnvelope("VALIDATION", "lotNo, positive returnQty and reason required"));
    }
    await client.query("BEGIN");
    const lotRes = await client.query(
      `SELECT ml.id,ml.received_qty,ml.iqc_status,m.code material_code,s.code supplier_code
       FROM material_lots ml JOIN materials m ON m.id=ml.material_id
       LEFT JOIN suppliers s ON s.id=ml.supplier_id
       WHERE ml.lot_no=$1 FOR UPDATE`, [lotNo]
    );
    if (!lotRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json(errorEnvelope("NOT_FOUND", `Lot '${lotNo}' not found`));
    }
    const lot = lotRes.rows[0];
    if (qty > Number(lot.received_qty)) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("INSUFFICIENT_QTY", `Only ${lot.received_qty} units available`));
    }
    if (materialCode && materialCode !== lot.material_code) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("MATERIAL_MISMATCH", `Lot contains ${lot.material_code}`));
    }
    if (supplierCode && lot.supplier_code && supplierCode !== lot.supplier_code) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("SUPPLIER_MISMATCH", `Lot belongs to ${lot.supplier_code}`));
    }
    const actor = String(operator ?? req.user?.username ?? "UNKNOWN");
    const caseNo = `WCL-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,8).toUpperCase()}`;
    const row = (await client.query(
      `INSERT INTO wms_closure_cases
       (case_no,case_type,entity_type,entity_key,material_lot_id,expected_qty,actual_qty,
        reason_code,reason_detail,risk_level,status,required_approvals,requested_by)
       VALUES($1,'SUPPLIER_RETURN','MATERIAL_LOT',$2,$3,$4,$4,'SUPPLIER_RETURN',$5,
              'NORMAL','PENDING_APPROVAL','["WAREHOUSE_SUPERVISOR"]'::jsonb,$6)
       RETURNING id,status`,
      [caseNo,lotNo,lot.id,qty,String(reason).trim(),actor]
    )).rows[0];
    await client.query(
      `INSERT INTO wms_inventory_freezes(case_id,material_lot_id,freeze_scope,reason,frozen_by)
       VALUES($1,$2,'LOT',$3,$4)`, [row.id,lot.id,String(reason).trim(),actor]
    );
    await appendClosureAudit(client,{caseId:row.id,action:"SUPPLIER_RETURN_SUBMITTED",actor,newState:"PENDING_APPROVAL",detail:{lotNo,qty,supplierCode:lot.supplier_code}});
    await client.query("COMMIT");
    res.status(201).json(mutateEnvelope({ caseId:row.id,caseNo,status:row.status,lotNo,returnQty:qty }));
  } catch (err) {
    await client.query("ROLLBACK").catch(()=>{});
    console.error("POST /wms/supplier-returns:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  } finally { client.release(); }
});

app.post("/wms/scrap", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { lotNo, qty, reason, operator } = req.body?.payload ?? req.body ?? {};
    if (!lotNo || !qty) {
      return res.status(400).json(errorEnvelope("VALIDATION", "lotNo and qty required"));
    }
    const lot = (await query("SELECT id, received_qty, iqc_status FROM material_lots WHERE lot_no = $1", [lotNo])).rows[0];
    if (!lot) return res.status(404).json(errorEnvelope("NOT_FOUND", "Lot not found"));
    if (Number(qty) > Number(lot.received_qty)) {
      return res.status(409).json(errorEnvelope("INSUFFICIENT_QTY", `Only ${lot.received_qty} units in lot '${lotNo}'`));
    }
    const operatorId = await resolveOperatorId(operator);
    const tx = await query(
      `INSERT INTO inventory_transactions
         (tx_no, action, material_lot_id, qty, operator_id, tx_status)
       VALUES ($1,'SCRAP',$2,$3,$4,'posted') RETURNING id, tx_no`,
      [`TXN_${Date.now()}`, lot.id, qty, operatorId],
    );
    await query(
      "UPDATE material_lots SET received_qty = received_qty - $1, iqc_status = 'rejected' WHERE id = $2",
      [qty, lot.id],
    );
    res.status(201).json(mutateEnvelope({ id: tx.rows[0].id, txNo: tx.rows[0].tx_no, lotNo, qty, reason: reason ?? "" }));
  } catch (err) {
    console.error("POST /wms/scrap:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// ── Extended WMS Endpoints ───────────────────────────────────────────────
// POST /wms/put-away — move released lot from IQC area to permanent storage
app.post("/wms/put-away", requirePermission("wms.execute"), async (req, res) => {
  try {
    const { lotNo, toLocation, qty, operator } = req.body;
    const moveQty = Number(qty);
    if (!lotNo || !toLocation || !Number.isFinite(moveQty) || moveQty <= 0) {
      return res.status(400).json(errorEnvelope("VALIDATION", "lotNo, toLocation, qty required"));
    }
    // Verify lot exists and is released
    const lotR = await query(`SELECT id, iqc_status, received_qty FROM material_lots WHERE lot_no = $1`, [lotNo]);
    if (!lotR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Lot not found"));
    if (lotR.rows[0].iqc_status !== "released") {
      return res.status(400).json(errorEnvelope("VALIDATION", "Only released lots can be put away"));
    }
    if (moveQty > Number(lotR.rows[0].received_qty)) {
      return res.status(409).json(errorEnvelope("INSUFFICIENT_QTY", "Put-away quantity exceeds lot quantity"));
    }
    // Verify location exists
    const locR = await query(`
      SELECT sl.id, sl.status, sl.locked_reason, sl.capacity_qty, w.warehouse_type,
             COALESCE(SUM(CASE WHEN ml.iqc_status = 'released' THEN ml.received_qty ELSE 0 END), 0) AS occupied_qty
      FROM storage_locations sl
      LEFT JOIN wms_warehouses w ON w.id=sl.warehouse_id
      LEFT JOIN material_lots ml ON ml.storage_location_id = sl.id
      WHERE sl.code = $1
      GROUP BY sl.id, sl.status, sl.locked_reason, sl.capacity_qty, w.warehouse_type
    `, [toLocation]);
    if (!locR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Location not found"));
    const target = locR.rows[0];
    if (target.status !== "active" || target.locked_reason) {
      return res.status(409).json(errorEnvelope("LOCATION_BLOCKED", target.locked_reason || "Location is not active"));
    }
    if (target.warehouse_type !== "RAW_MATERIAL") {
      return res.status(409).json(errorEnvelope("RAW_MATERIAL_LOCATION_REQUIRED", "Material lots can only be put away to RAW_MATERIAL warehouse locations"));
    }
    if (target.capacity_qty != null && Number(target.occupied_qty) + moveQty > Number(target.capacity_qty)) {
      return res.status(409).json(errorEnvelope("LOCATION_CAPACITY", "Put-away exceeds location capacity"));
    }
    // Create transaction
    const operatorId = await resolveOperatorId(operator ?? "admin") ?? 10;
    const txNo = `PA_${Date.now()}`;
    const txR = await query(`
      INSERT INTO inventory_transactions
        (tx_no, action, material_lot_id, qty, from_location_id, to_location_id,
         operator_id, tx_status, reference_type, reference_no)
      VALUES ($1, 'PUT_AWAY', $2, $3,
        (SELECT storage_location_id FROM material_lots WHERE lot_no = $4),
        $5, $6, 'posted', 'MANUAL', $1)
      RETURNING id, tx_no
    `, [txNo, lotR.rows[0].id, moveQty, lotNo, locR.rows[0].id, operatorId]);
    await query("UPDATE material_lots SET storage_location_id = $1 WHERE id = $2", [locR.rows[0].id, lotR.rows[0].id]);
    res.status(201).json(mutateEnvelope({ id: txR.rows[0].id, txNo: txR.rows[0].tx_no }));
  } catch (err) {
    console.error("POST /wms/put-away:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /wms/lot-transactions/:lotId — full transaction history for a lot
app.get("/wms/lot-transactions/:lotId", requirePermission("wms.view"), async (req, res) => {
  try {
    const { lotId } = req.params;
    const r = await query(`
      SELECT it.id, it.tx_no, it.action, it.qty, it.tx_status,
             u.username AS operator,
             it.reference_type, it.reference_no, it.occurred_at,
             sl_from.code AS from_location_code, sl_to.code AS to_location_code
      FROM inventory_transactions it
      LEFT JOIN storage_locations sl_from ON sl_from.id = it.from_location_id
      LEFT JOIN storage_locations sl_to ON sl_to.id = it.to_location_id
      LEFT JOIN users u ON u.id = it.operator_id
      WHERE it.material_lot_id = $1
      ORDER BY it.occurred_at DESC
      LIMIT 200
    `, [lotId]);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /wms/lot-transactions/:lotId:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /wms/pda-inspection-records — IQC/PDA inspection history.
// 表结构以 migration 001 的 canonical 形状为准（record_type/lot_no/decision/
// recorded_at…）；旧版查询引用的 material_lot_id/scanned_at/result 列从未存在，
// 该端点此前一直 500。WmsPdaHistory.tsx 消费的就是 canonical 列。
app.get("/wms/pda-inspection-records", requirePermission("wms.view"), async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const r = await query(`
      SELECT pir.*
      FROM pda_inspection_records pir
      ORDER BY pir.recorded_at DESC, pir.id DESC
      LIMIT $1 OFFSET $2
    `, [Number(limit), Number(offset)]);
    const cnt = await query(`SELECT count(*) AS total FROM pda_inspection_records`);
    res.json({ items: r.rows, total: Number(cnt.rows[0]?.total ?? 0) });
  } catch (err) {
    console.error("GET /wms/pda-inspection-records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /wms/pda-inspection-records — record PDA inspection result.
// 两种入参并存（与前端三处调用一致）：
//  1) canonical 记录（WmsPdaIqc/WmsPdaReceiving）：record_type + lot_no +
//     decision + 检验明细，纯历史落库；库存动作由调用方另发 /wms/transactions。
//  2) 旧版移动端（WmsPdaReceivingMobile）：materialLotId + result(+MSD 三查)，
//     由本端点顺带更新批次 IQC 状态并记 IQC_* 流水。
// 旧版 INSERT 引用不存在的列（material_lot_id/result/scanned_at…），此前一直 500。
app.post("/wms/pda-inspection-records", requirePermission("wms.execute"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const b = req.body ?? {};
    await client.query("BEGIN");
    if (b.record_type || b.lot_no) {
      // canonical 形状：只落历史，不碰库存。
      if (!["RECEIVING", "IQC"].includes(String(b.record_type))) {
        await client.query("ROLLBACK");
        return res.status(400).json(errorEnvelope("VALIDATION", "record_type must be RECEIVING or IQC"));
      }
      if (!String(b.lot_no || "").trim()) {
        await client.query("ROLLBACK");
        return res.status(400).json(errorEnvelope("VALIDATION", "lot_no required"));
      }
      const r = await client.query(
        `INSERT INTO pda_inspection_records
           (record_type, lot_no, material_code, material_name_zh, supplier_code, supplier_name_zh,
            received_qty, po_no, date_code, msd_level, msd_bag_intact, msd_bag_sealed, msd_exposure_noted,
            receiving_photo_url, receiving_notes, location_code,
            sample_size, defect_count, defect_type, defect_severity, defect_rate, defect_photo_url, inspection_notes,
            decision, decision_by, ornith_confidence, operator_name, device_info,
            signature_url, signature_hash, signed_by, signed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
         RETURNING *`,
        [b.record_type, String(b.lot_no).trim(), b.material_code || null, b.material_name_zh || null,
         b.supplier_code || null, b.supplier_name_zh || null, b.received_qty ?? null,
         b.po_no || null, b.date_code || null, b.msd_level || null,
         b.msd_bag_intact ?? null, b.msd_bag_sealed ?? null, b.msd_exposure_noted ?? null,
         b.receiving_photo_url || null, b.receiving_notes ?? b.notes ?? null, b.location_code || null,
         b.sample_size ?? null, b.defect_count ?? null, b.defect_type || null, b.defect_severity || null,
         b.defect_rate ?? null, b.defect_photo_url || null, b.inspection_notes ?? null,
         b.decision || b.result || null, b.decision_by || null, b.ornith_confidence ?? null,
         b.operator_name || b.operator || null, b.device_info || null,
         b.signatureUrl || b.signature_url || null, b.signatureHash || b.signature_hash || null,
         b.signedBy || b.signed_by || null, (b.signatureUrl || b.signature_url || b.signedBy || b.signed_by) ? new Date() : null]
      );
      await client.query("COMMIT");
      return res.status(201).json({ item: r.rows[0] });
    }

    // 旧版移动端形状：materialLotId + result，附带 IQC 状态迁移。
    const { materialLotId, result, rejectReason, operator, operatorId,
            msdSealOk, msdDesiccantOk, msdHumidityOk, photoUrl, notes,
            signatureUrl, signatureHash, signedBy } = b;
    if (!materialLotId || !result) {
      await client.query("ROLLBACK");
      return res.status(400).json(errorEnvelope("VALIDATION", "materialLotId and result required"));
    }
    if (!["PASS", "FAIL", "HOLD"].includes(result)) {
      await client.query("ROLLBACK");
      return res.status(400).json(errorEnvelope("VALIDATION", "result must be PASS, FAIL, or HOLD"));
    }
    const lot = (await client.query(
      `SELECT ml.id, ml.lot_no, ml.iqc_status, ml.received_qty, ml.po_no, m.msd_level,
              m.code AS material_code, m.name_zh AS material_name_zh,
              s.code AS supplier_code, s.name_zh AS supplier_name_zh
         FROM material_lots ml
         JOIN materials m ON m.id = ml.material_id
         LEFT JOIN suppliers s ON s.id = ml.supplier_id
        WHERE ml.id=$1 FOR UPDATE OF ml`, [materialLotId])).rows[0];
    if (!lot) {
      await client.query("ROLLBACK");
      return res.status(404).json(errorEnvelope("NOT_FOUND", "Material lot not found"));
    }
    const r = await client.query(
      `INSERT INTO pda_inspection_records
         (record_type, lot_no, material_code, material_name_zh, supplier_code, supplier_name_zh,
          received_qty, po_no, date_code, msd_level, msd_bag_intact, msd_bag_sealed, msd_exposure_noted,
          receiving_photo_url, receiving_notes, inspection_notes,
          decision, decision_by, operator_name,
          signature_url, signature_hash, signed_by, signed_at)
       VALUES ('RECEIVING',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'OPERATOR',$17,$18,$19,$20,NOW())
       RETURNING *`,
      [lot.lot_no, lot.material_code, lot.material_name_zh, lot.supplier_code, lot.supplier_name_zh,
       lot.received_qty, lot.po_no, null, lot.msd_level,
       msdSealOk ?? null, msdDesiccantOk ?? null, msdHumidityOk ?? null,
       photoUrl || null, rejectReason || null, notes || null,
       result, operator || null,
       signatureUrl || null, signatureHash || null, signedBy || operator || null]
    );

    const nextStatus = result === "PASS" ? "released" : result === "HOLD" ? "hold" : "rejected";
    const action = result === "PASS" ? "IQC_RELEASE" : result === "HOLD" ? "IQC_HOLD" : "IQC_REJECT";
    await client.query(`UPDATE material_lots SET iqc_status=$1, updated_at=NOW() WHERE id=$2`, [nextStatus, materialLotId]);
    // inventory_transactions.operator_id 是 NOT NULL：移动端只传 operator 用户名，
    // 与 /wms/transactions 同款解析（用户名/ID → users.id），登录用户兜底。
    const txOperatorId = operatorId ?? await resolveOperatorId(operator) ?? req.user?.userId ?? req.user?.id;
    if (!txOperatorId) {
      await client.query("ROLLBACK");
      return res.status(400).json(errorEnvelope("VALIDATION", "operator must resolve to a known user"));
    }
    await client.query(
      `INSERT INTO inventory_transactions
         (tx_no, action, material_lot_id, qty, operator_id, tx_status, reference_type, reference_no)
       VALUES ($1,$2,$3,0,$4,'posted','PDA_INSPECTION',$5)`,
      [`IQC_${r.rows[0].id}_${Date.now()}`, action, materialLotId, txOperatorId, String(r.rows[0].id)]
    );
    await client.query("COMMIT");

    res.status(201).json({ item: r.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /wms/pda-inspection-records:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  } finally { client.release(); }
});

app.get("/wms/receiving-queue", requirePermission("wms.view"), async (req, res) => {
  try {
    const r = await query(`
      SELECT ml.id, ml.lot_no, ml.po_no, ml.received_qty, ml.iqc_status, ml.received_at,
             ml.receiving_photo_url, ml.receiving_notes,
             m.code AS material_code, m.name_zh AS material_name_zh,
             s.code AS supplier_code, s.name_zh AS supplier_name_zh,
             sl.code AS location_code, u.display_name AS receiver_name,
             EXISTS (
               SELECT 1 FROM receiving_issues ri
               WHERE ri.material_lot_id = ml.id AND NOT ri.resolved
             ) AS has_open_issues
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      LEFT JOIN suppliers s ON s.id = ml.supplier_id
      LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
      LEFT JOIN users u ON u.id = ml.receiver_id
      WHERE ml.iqc_status IN ('pending','hold')
      ORDER BY ml.received_at ASC
      LIMIT 200
    `);
    res.json({ items: r.rows, total: r.rows.length });
  } catch (err) {
    console.error("GET /wms/receiving-queue:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});
}
