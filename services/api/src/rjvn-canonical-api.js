/**
 * Canonical (imported) data read API — exposes the rjvn data AFTER it has been
 * imported into the official smt business tables.
 *
 * Backend companion of apps/web/src/wms/WmsCanonicalData.tsx.
 * All routes are read-only and use requirePermission("wms.view").
 */
function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) {
      if (res.headersSent) return;
      console.error("[canonical-api]", e);
      res.status(500).json({ success: false, error: e.message || "Internal error" });
    }
  };
}
const limitOf = (v) => Math.min(Math.max(parseInt(v, 10) || 50, 1), 200);
const offsetOf = (v) => Math.max(parseInt(v, 10) || 0, 0);

function listRoute(pool, { table, alias = "t", select, searchCols = [], join = "", order }) {
  return wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const q = String(req.query.q || "").slice(0, 200);
    const params = [], clauses = [];
    if (q && searchCols.length) {
      params.push(q);
      clauses.push(`(${searchCols.map((c) => `coalesce(${c}::text,'') ilike '%'||$${params.length}||'%'`).join(" or ")})`);
    }
    const where = clauses.length ? "where " + clauses.join(" and ") : "";
    const lim = params.length + 1, off = params.length + 2;
    const [data, count] = await Promise.all([
      pool.query(`select ${select} from public.${table} ${alias} ${join} ${where}
        order by ${order || `${alias}.id`} limit $${lim} offset $${off}`, [...params, limit, offset]),
      // Search columns may belong to joined tables (lots/reels/boms/inspections),
      // so the count query must carry the same join as the data query.
      pool.query(`select count(*)::int as n from public.${table} ${alias} ${join} ${where}`, params),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n, limit, offset } });
  });
}

export function registerCanonicalDataRoutes(app, pgPool, requirePermission) {
  const perm = requirePermission("wms.view");

  app.get("/canonical-data/summary", perm, wrap(async (_req, res) => {
    const tables = ["materials", "suppliers", "storage_locations", "material_lots",
      "wms_receipt_orders", "iqc_inspections", "boms", "bom_lines",
      "wms_picking_orders", "wms_picking_order_items", "rjvn_external_id_map"];
    const counts = await Promise.all(tables.map((t) =>
      pgPool.query(`select count(*)::int as n from public.${t}`)));
    const map = await pgPool.query(
      `select entity, count(*)::int as n from public.rjvn_external_id_map group by 1 order by 1`);
    const trans = await pgPool.query(`
      select 'materials' as entity, count(*) filter(where name_en<>name_zh)::int as translated,
             count(*) filter(where name_en=name_zh)::int as pending from public.materials
      union all select 'suppliers', count(*) filter(where name_en<>name_zh), count(*) filter(where name_en=name_zh) from public.suppliers
      union all select 'products', count(*) filter(where name_en<>name_zh), count(*) filter(where name_en=name_zh) from public.products`);
    res.json({ success: true, data: {
      counts: Object.fromEntries(tables.map((t, i) => [t, counts[i].rows[0].n])),
      map: Object.fromEntries(map.rows.map((r) => [r.entity, r.n])),
      translation: Object.fromEntries(trans.rows.map((r) => [r.entity, { translated: r.translated, pending: r.pending }])),
    } });
  }));

  app.get("/canonical-data/materials", perm, listRoute(pgPool, {
    table: "materials",
    select: `t.id, t.code, t.name_zh, t.name_en, t.name_vi, t.uom, t.material_type, t.status, t.shelf_life_days`,
    searchCols: ["t.code", "t.name_zh", "t.name_en", "t.name_vi"],
    order: "t.id",
  }));

  app.get("/canonical-data/suppliers", perm, listRoute(pgPool, {
    table: "suppliers",
    select: `t.id, t.code, t.name_zh, t.name_en, t.name_vi, t.status, t.country`,
    searchCols: ["t.code", "t.name_zh", "t.name_en", "t.name_vi"],
    order: "t.id",
  }));

  app.get("/canonical-data/lots", perm, listRoute(pgPool, {
    table: "material_lots",
    select: `t.id, t.lot_no, t.received_qty, t.iqc_status, t.lot_status,
      t.manufacturing_date, t.received_at, m.code as material_code, m.name_zh as material_name, s.code as supplier_code`,
    join: `left join public.materials m on m.id=t.material_id left join public.suppliers s on s.id=t.supplier_id`,
    searchCols: ["t.lot_no", "m.code", "m.name_zh", "s.code"],
    order: "t.id desc",
  }));

  app.get("/canonical-data/receipts", perm, listRoute(pgPool, {
    table: "wms_receipt_orders",
    select: `t.id, t.receipt_no, t.receipt_date, t.batch_no, t.serial_no, t.quantity, t.unit,
      t.location_code, t.status, t.material_code, t.supplier_code`,
    searchCols: ["t.receipt_no", "t.batch_no", "t.serial_no", "t.material_code", "t.supplier_code"],
    order: "t.id desc",
  }));

  app.get("/canonical-data/inspections", perm, listRoute(pgPool, {
    table: "iqc_inspections",
    select: `t.id, t.inspection_no, t.result, t.inspection_date, t.remarks, t.material_lot_id,
      ml.lot_no, ml.received_qty`,
    join: `left join public.material_lots ml on ml.id=t.material_lot_id`,
    searchCols: ["t.inspection_no", "t.result", "ml.lot_no"],
    order: "t.id desc",
  }));

  app.get("/canonical-data/boms", perm, listRoute(pgPool, {
    table: "boms",
    select: `t.id, t.revision, t.status, t.source_file_name, p.code as product_code, p.name_zh as product_name`,
    join: `left join public.products p on p.id=t.product_id`,
    searchCols: ["p.code", "p.name_zh", "t.revision", "t.source_file_name"],
    order: "t.id",
  }));

  app.get("/canonical-data/bom-lines", perm, listRoute(pgPool, {
    table: "bom_lines",
    select: `t.id, t.bom_id, t.qty_per, t.material_name_zh, t.unit, t.process_stage, m.code as material_code`,
    join: `left join public.materials m on m.id=t.material_id`,
    searchCols: ["m.code", "t.material_name_zh"],
    order: "t.id",
  }));

  app.get("/canonical-data/picking", perm, listRoute(pgPool, {
    table: "wms_picking_orders",
    select: `t.id, t.picking_no, t.work_order_no, t.work_section, t.total_qty, t.status, t.rjvn_id`,
    searchCols: ["t.picking_no", "t.work_order_no", "t.work_section"],
    order: "t.id",
  }));

  app.get("/canonical-data/reels", perm, listRoute(pgPool, {
    table: "wms_picking_order_items",
    select: `t.id, t.picking_id, t.material_code, t.material_name, t.pick_qty, t.actual_qty, t.received_qty, po.picking_no`,
    join: `left join public.wms_picking_orders po on po.id=t.picking_id`,
    searchCols: ["t.material_code", "t.material_name", "po.picking_no"],
    order: "t.id",
  }));
}
