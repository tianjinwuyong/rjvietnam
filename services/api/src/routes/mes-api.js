// ============================================================================
// MES / third-party read API (v1) — grafted from reference WMS-20261019
// Reference: server/modules/mes-api/mes-api.controller.ts + mes-api.service.ts
// Mount: registerMesApiRoutes(app, deps) from server.js on the `api` router,
//        after the auth wrapper; the prefix is exempted from JWT (machine
//        clients hold X-Api-Key, not a browser session) — see DEVICE_OPEN_PATHS.
// ============================================================================
// WHY THIS FILE EXISTS. The reference WMS exposes /api/mes/v1/* as a read-only
// contract so MES / third-party systems can query stock, picking and returns
// without touching business state. The factory needs the same contract to keep
// WMS clients working after the graft. Data source: the public.rjvn_* mirror
// (1:1 of the source `wms` DB, migration 309) — the same tables the read-only
// /rjvn-wms/* surface already serves. No writes here, ever.
//
// Wire contract (kept identical to the reference so existing clients don't change):
//   envelope  { code: 0, message: 'ok', data, requestId }
//   auth      X-Api-Key header (or ?apiKey=), compared timing-safe against
//             sys_param 'mes.api_key' (auto-generated on first use, like wms.itf_key)
//   errors    { code: 1, message } with HTTP 400/401/404/500
//   dates     ISO 8601 UTC; quantities float8
// ============================================================================
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";

const KEY_PARAM = "mes.api_key";

export function registerMesApiRoutes(app, deps) {
  const { query } = deps;

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const ok = (data) => ({ code: 0, message: "ok", data, requestId: randomUUID() });
  const fail = (res, http, message) => res.status(http).json({ code: 1, message, requestId: randomUUID() });
  const iso = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

  // ── key store (mirrors mesrj/itf/param-store.js getItfKey/guard) ──────────
  async function getApiKey(reset = false) {
    const r = await query("SELECT param_val FROM sys_param WHERE param_key=$1", [KEY_PARAM]);
    const cur = (r.rows[0]?.param_val || "").trim();
    if (cur && !reset) return cur;
    const k = "mesapi-" + randomBytes(16).toString("hex");
    const u = await query("UPDATE sys_param SET param_val=$2, updated_at=now() WHERE param_key=$1", [KEY_PARAM, k]);
    if (!u.rowCount) {
      await query(
        "INSERT INTO sys_param (param_key, param_val, param_name, group_name) VALUES ($1,$2,$3,$4)",
        [KEY_PARAM, k, "MES v1 只读接口密钥（X-Api-Key）", "WMS"]);
    }
    return k;
  }

  async function guard(req) {
    const got = String(req.headers["x-api-key"] || req.query.apiKey || "").trim();
    if (!got) return { ok: false, err: "缺少 X-Api-Key 请求头" };
    const want = await getApiKey();
    const a = createHash("sha256").update(got).digest();
    const b = createHash("sha256").update(want).digest();
    if (!timingSafeEqual(a, b)) return { ok: false, err: "X-Api-Key 不正确" };
    return { ok: true, err: "" };
  }

  // Every route: machine auth first, then the handler. Keeps the exemption in
  // DEVICE_OPEN_PATHS honest — the prefix is open to JWT but never to the world.
  const guarded = (handler) => async (req, res) => {
    const g = await guard(req);
    if (!g.ok) return fail(res, 401, g.err);
    try { await handler(req, res); }
    catch (e) {
      if (e.http) return fail(res, e.http, e.message);
      fail(res, 500, e.message);
    }
  };
  const badRequest = (msg) => Object.assign(new Error(msg), { http: 400 });
  const notFound = (msg) => Object.assign(new Error(msg), { http: 404 });

  function parsePaging(q) {
    const page = Math.max(1, Number(q.page) || 1);
    let pageSize = Number(q.pageSize) || 100;
    if (pageSize < 1) pageSize = 100;
    if (pageSize > 500) pageSize = 500;
    return { page, pageSize, offset: (page - 1) * pageSize };
  }
  function parseDate(v, field) {
    if (!v) return null;
    const t = Date.parse(v);
    if (Number.isNaN(t)) throw badRequest(`${field} 不是合法日期：${v}`);
    return new Date(t).toISOString();
  }

  // ── ping ─────────────────────────────────────────────────────────────────
  app.get("/api/mes/v1/ping", guarded(async (_req, res) => {
    const { rows } = await query("SELECT now() AS db_time, current_database() AS db");
    res.json(ok({
      ok: true,
      serverTime: new Date().toISOString(),
      database: { connected: true, name: rows[0]?.db ?? null, time: rows[0]?.db_time ?? null },
    }));
  }));

  // ── stock list ───────────────────────────────────────────────────────────
  app.get("/api/mes/v1/stock", guarded(async (req, res) => {
    const q = req.query;
    const { page, pageSize, offset } = parsePaging(q);
    const where = ["TRUE"]; const params = [];
    const add = (clause, val) => { params.push(val); where.push(clause.replace("?", `$${params.length}`)); };
    if (q.materialCode) add("m.material_code = ?", q.materialCode);
    if (q.warehouseCode) add("w.wh_code = ?", q.warehouseCode);
    if (q.locationCode) add("l.location_code = ?", q.locationCode);
    if (q.batchNo) add("i.batch_no = ?", q.batchNo);
    if (q.stockStatus) add("i.stock_status = ?", q.stockStatus);
    if (q.keyword) { params.push(`%${q.keyword}%`); where.push(`(m.material_code ILIKE $${params.length} OR m.material_name ILIKE $${params.length})`); }
    if (q.onlyAvailable !== "false") where.push("i.quantity > 0");
    params.push(pageSize, offset);
    const { rows } = await query(
      `SELECT m.material_code, m.material_name, m.specification, i.unit,
              w.wh_code AS warehouse_code, w.wh_name_zh AS warehouse_name,
              l.location_code, i.batch_no, i.quantity::float8 AS quantity,
              i.stock_status, i.locked, i.lock_reason,
              i.production_date, i.label_no, ${iso("i._updated_at")} AS updated_at,
              count(*) OVER() AS total
         FROM rjvn_inventory i
         JOIN rjvn_material m ON m.id = i.material_id
         JOIN rjvn_warehouse_location l ON l.id = i.location_id
         JOIN rjvn_warehouse w ON w.id = l.warehouse_id
        WHERE ${where.join(" AND ")}
        ORDER BY m.material_code, i.batch_no, l.location_code
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json(ok({
      items: rows.map((r) => ({
        materialCode: r.material_code, materialName: r.material_name, specification: r.specification,
        unit: r.unit, warehouseCode: r.warehouse_code, warehouseName: r.warehouse_name,
        locationCode: r.location_code, batchNo: r.batch_no, quantity: num(r.quantity),
        stockStatus: r.stock_status, locked: !!r.locked, lockReason: r.lock_reason,
        productionDate: r.production_date, labelNo: r.label_no, updatedAt: r.updated_at,
      })),
      page, pageSize, total: rows.length ? num(rows[0].total) : 0,
    }));
  }));

  // ── stock summary ────────────────────────────────────────────────────────
  app.get("/api/mes/v1/stock/summary", guarded(async (req, res) => {
    const q = req.query;
    const groupBy = q.groupBy === "warehouse" ? "warehouse" : "material";
    const where = ["TRUE"]; const params = [];
    const add = (clause, val) => { params.push(val); where.push(clause.replace("?", `$${params.length}`)); };
    if (q.materialCode) add("m.material_code = ?", q.materialCode);
    if (q.warehouseCode) add("w.wh_code = ?", q.warehouseCode);
    if (q.stockStatus) add("i.stock_status = ?", q.stockStatus);
    if (q.onlyAvailable !== "false") where.push("i.quantity > 0");
    const w = where.join(" AND ");
    if (groupBy === "warehouse") {
      const { rows } = await query(
        `SELECT w.wh_code AS warehouse_code, w.wh_name_zh AS warehouse_name,
                sum(i.quantity)::float8 AS total_qty,
                count(DISTINCT m.id)::int AS material_count,
                count(*)::int AS lot_count,
                sum(CASE WHEN i.locked THEN i.quantity ELSE 0 END)::float8 AS locked_qty
           FROM rjvn_inventory i
           JOIN rjvn_material m ON m.id = i.material_id
           JOIN rjvn_warehouse_location l ON l.id = i.location_id
           JOIN rjvn_warehouse w ON w.id = l.warehouse_id
          WHERE ${w}
          GROUP BY w.wh_code, w.wh_name_zh
          ORDER BY total_qty DESC`, params);
      return res.json(ok({ groupBy, items: rows.map((r) => ({
        warehouseCode: r.warehouse_code, warehouseName: r.warehouse_name,
        totalQty: num(r.total_qty), lockedQty: num(r.locked_qty),
        materialCount: num(r.material_count), lotCount: num(r.lot_count),
      })) }));
    }
    const { rows } = await query(
      `SELECT m.material_code, m.material_name, m.specification, m.unit,
              sum(i.quantity)::float8 AS total_qty,
              sum(CASE WHEN i.locked THEN i.quantity ELSE 0 END)::float8 AS locked_qty,
              count(*)::int AS lot_count,
              count(DISTINCT w.wh_code)::int AS warehouse_count
         FROM rjvn_inventory i
         JOIN rjvn_material m ON m.id = i.material_id
         JOIN rjvn_warehouse_location l ON l.id = i.location_id
         JOIN rjvn_warehouse w ON w.id = l.warehouse_id
        WHERE ${w}
        GROUP BY m.material_code, m.material_name, m.specification, m.unit
        ORDER BY total_qty DESC, m.material_code`, params);
    res.json(ok({ groupBy, items: rows.map((r) => ({
      materialCode: r.material_code, materialName: r.material_name, specification: r.specification,
      unit: r.unit, totalQty: num(r.total_qty), lockedQty: num(r.locked_qty),
      lotCount: num(r.lot_count), warehouseCount: num(r.warehouse_count),
    })) }));
  }));

  // ── picking list ─────────────────────────────────────────────────────────
  app.get("/api/mes/v1/picking-orders", guarded(async (req, res) => {
    const q = req.query;
    const { page, pageSize, offset } = parsePaging(q);
    const where = ["TRUE"]; const params = [];
    const add = (clause, val) => { params.push(val); where.push(clause.replace("?", `$${params.length}`)); };
    if (q.pickingNo) add("p.picking_no = ?", q.pickingNo);
    if (q.workOrderNo) add("w.work_order_no = ?", q.workOrderNo);
    if (q.workSection) add("p.work_section = ?", q.workSection);
    if (q.status) add("p.status = ?", q.status);
    const from = parseDate(q.from, "from"); const to = parseDate(q.to, "to");
    if (from) add("p._created_at >= ?::timestamptz", from);
    if (to) add("p._created_at <= ?::timestamptz", to);
    params.push(pageSize, offset);
    const { rows } = await query(
      `SELECT p.picking_no, p.work_section, p.is_supplement,
              p.total_qty::float8 AS total_qty, p.status, p.oa_status,
              ${iso("p._created_at")} AS created_at, ${iso("p.pick_time")} AS pick_time, ${iso("p.received_time")} AS received_time,
              w.work_order_no, w.product_code, w.product_name,
              (SELECT count(*)::int FROM rjvn_picking_order_item it WHERE it.picking_id = p.id) AS item_count,
              count(*) OVER() AS total
         FROM rjvn_picking_order p
         LEFT JOIN rjvn_work_order w ON w.id = p.work_order_id
        WHERE ${where.join(" AND ")}
        ORDER BY p._created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json(ok({
      items: rows.map((r) => ({
        pickingNo: r.picking_no, workOrderNo: r.work_order_no, productCode: r.product_code,
        productName: r.product_name, workSection: r.work_section, isSupplement: !!r.is_supplement,
        totalQty: num(r.total_qty), status: r.status, oaStatus: r.oa_status, itemCount: num(r.item_count),
        createdAt: r.created_at, pickTime: r.pick_time, receivedTime: r.received_time,
      })),
      page, pageSize, total: rows.length ? num(rows[0].total) : 0,
    }));
  }));

  // ── picking detail ───────────────────────────────────────────────────────
  app.get("/api/mes/v1/picking-orders/:pickingNo", guarded(async (req, res) => {
    const pickingNo = req.params.pickingNo;
    const head = (await query(
      `SELECT p.id, p.picking_no, p.work_section, p.is_supplement, p.total_qty::float8 AS total_qty,
              p.status, p.oa_status, p.remark,
              ${iso("p._created_at")} AS created_at, ${iso("p.pick_time")} AS pick_time, ${iso("p.received_time")} AS received_time, p.receive_remark,
              w.work_order_no, w.product_code, w.product_name, w.plan_qty::float8 AS plan_qty
         FROM rjvn_picking_order p
         LEFT JOIN rjvn_work_order w ON w.id = p.work_order_id
        WHERE p.picking_no = $1 LIMIT 1`, [pickingNo])).rows;
    if (!head.length) throw notFound(`领料单不存在：${pickingNo}`);
    const items = (await query(
      `SELECT it.material_code, it.material_name, it.unit,
              it.pick_qty::float8 AS pick_qty, it.actual_qty::float8 AS actual_qty,
              it.received_qty::float8 AS received_qty, it.actual_material_code,
              m.specification, m.packaging_type
         FROM rjvn_picking_order_item it
         LEFT JOIN rjvn_material m ON m.id = it.material_id
        WHERE it.picking_id = $1
        ORDER BY it.material_code`, [head[0].id])).rows;
    const h = head[0];
    res.json(ok({
      pickingNo: h.picking_no, workOrderNo: h.work_order_no, productCode: h.product_code,
      productName: h.product_name, planQty: h.plan_qty === null ? null : num(h.plan_qty),
      workSection: h.work_section, isSupplement: !!h.is_supplement, totalQty: num(h.total_qty),
      status: h.status, oaStatus: h.oa_status, remark: h.remark,
      createdAt: h.created_at, pickTime: h.pick_time, receivedTime: h.received_time, receiveRemark: h.receive_remark,
      items: items.map((r) => ({
        materialCode: r.material_code, materialName: r.material_name, specification: r.specification,
        packagingType: r.packaging_type, unit: r.unit, pickQty: num(r.pick_qty), actualQty: num(r.actual_qty),
        receivedQty: num(r.received_qty), actualMaterialCode: r.actual_material_code,
      })),
    }));
  }));

  // ── returns list ─────────────────────────────────────────────────────────
  app.get("/api/mes/v1/returns", guarded(async (req, res) => {
    const q = req.query;
    const { page, pageSize, offset } = parsePaging(q);
    const where = ["TRUE"]; const params = [];
    const add = (clause, val) => { params.push(val); where.push(clause.replace("?", `$${params.length}`)); };
    if (q.returnNo) add("r.return_no = ?", q.returnNo);
    if (q.workOrderNo) add("r.work_order_no = ?", q.workOrderNo);
    if (q.materialCode) add("r.material_code = ?", q.materialCode);
    if (q.status) add("r.status = ?", q.status);
    const from = parseDate(q.from, "from"); const to = parseDate(q.to, "to");
    if (from) add("r._created_at >= ?::timestamptz", from);
    if (to) add("r._created_at <= ?::timestamptz", to);
    params.push(pageSize, offset);
    const { rows } = await query(
      `SELECT r.return_no, r.material_code, r.material_name, r.unit,
              r.quantity::float8 AS quantity, r.batch_no, r.production_date,
              r.work_order_no, r.status, r.return_reason,
              r.received_good_qty::float8 AS received_good_qty,
              r.received_incoming_defect_qty::float8 AS received_incoming_defect_qty,
              r.received_operation_defect_qty::float8 AS received_operation_defect_qty,
              ${iso("r._created_at")} AS created_at,
              count(*) OVER() AS total
         FROM rjvn_production_return r
        WHERE ${where.join(" AND ")}
        ORDER BY r._created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json(ok({
      items: rows.map((r) => {
        const total = num(r.quantity);
        const received = num(r.received_good_qty) + num(r.received_incoming_defect_qty) + num(r.received_operation_defect_qty);
        return {
          returnNo: r.return_no, materialCode: r.material_code, materialName: r.material_name,
          unit: r.unit, quantity: total, batchNo: r.batch_no, productionDate: r.production_date,
          workOrderNo: r.work_order_no, status: r.status, returnReason: r.return_reason,
          receivedQty: received, pendingQty: Math.round((total - received) * 1000) / 1000, createdAt: r.created_at,
        };
      }),
      page, pageSize, total: rows.length ? num(rows[0].total) : 0,
    }));
  }));

  // ── return detail ────────────────────────────────────────────────────────
  app.get("/api/mes/v1/returns/:returnNo", guarded(async (req, res) => {
    const { rows } = await query(
      `SELECT r.return_no, r.material_code, r.material_name, r.unit,
              r.quantity::float8 AS quantity, r.batch_no, r.production_date,
              r.supplier_code, r.supplier_name, r.work_order_no, r.status, r.return_reason,
              r.received_good_qty::float8 AS received_good_qty,
              r.received_incoming_defect_qty::float8 AS received_incoming_defect_qty,
              r.received_operation_defect_qty::float8 AS received_operation_defect_qty,
              ${iso("r._created_at")} AS created_at, ${iso("r._updated_at")} AS updated_at
         FROM rjvn_production_return r
        WHERE r.return_no = $1 LIMIT 1`, [req.params.returnNo]);
    if (!rows.length) throw notFound(`退料单不存在：${req.params.returnNo}`);
    const r = rows[0];
    res.json(ok({
      returnNo: r.return_no, materialCode: r.material_code, materialName: r.material_name,
      unit: r.unit, quantity: num(r.quantity), batchNo: r.batch_no, productionDate: r.production_date,
      supplierCode: r.supplier_code, supplierName: r.supplier_name, workOrderNo: r.work_order_no,
      status: r.status, returnReason: r.return_reason,
      receivedQty: { good: num(r.received_good_qty), incomingDefect: num(r.received_incoming_defect_qty), operationDefect: num(r.received_operation_defect_qty) },
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }));

  // ── admin: reveal / reset the machine key (JWT + permission, like hub) ───
  const { requirePermission, errorEnvelope, successEnvelope } = deps;
  app.get("/api/mes/v1-admin/key", requirePermission("wms.execute"), async (_req, res) => {
    try { res.json(successEnvelope({ key: await getApiKey() })); }
    catch (e) { res.status(500).json(errorEnvelope("MES_API_KEY_FAILED", e.message)); }
  });
  app.post("/api/mes/v1-admin/key/reset", requirePermission("wms.execute"), async (_req, res) => {
    try { res.json(successEnvelope({ key: await getApiKey(true) })); }
    catch (e) { res.status(500).json(errorEnvelope("MES_API_KEY_FAILED", e.message)); }
  });
}