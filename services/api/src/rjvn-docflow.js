/**
 * rjvn remaining document flows (NestJS/Drizzle -> Express/raw-pg).
 * Covers stock-take / mrb / supplier-return / over-picking.
 *
 * Sources (OA skipped):
 *   modules/stock-take/stock-take.service.ts   - submit/approve/scan/cancel
 *   modules/mrb/mrb.service.ts                 - submit/final-approve/reject/disposition
 *   modules/supplier-return/supplier-return.service.ts - outbound/cancel
 *   modules/over-picking/over-picking.service.ts       - approve/cancel
 *
 * NOTE: the mirrored document tables currently contain 0 rows in smt_factory
 * (source demo data stops at receiving/IQC/picking). Routes are implemented
 * faithfully so imported data works; pages correctly show empty states.
 */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) {
      if (res.headersSent) return;
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error("[rjvn-docflow]", e);
      res.status(status).json({ success: false, error: e.message || "Internal error" });
    }
  };
}
const isUuid = (v) => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const limitOf = (v) => Math.min(Math.max(parseInt(v, 10) || 50, 1), 200);
const offsetOf = (v) => Math.max(parseInt(v, 10) || 0, 0);

// Generic paginated list + status breakdown for a mirror document table.
function listRoute(pool, { table, noCol, extraCols = "", searchCols = [] }) {
  return wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const q = String(req.query.q || "").slice(0, 200);
    const status = String(req.query.status || "").slice(0, 40);
    const params = [], clauses = [];
    if (q && searchCols.length) {
      params.push(q);
      clauses.push(`(${searchCols.map((c) => `coalesce(${c}::text,'') ilike '%'||$${params.length}||'%'`).join(" or ")})`);
    }
    if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
    const where = clauses.length ? "where " + clauses.join(" and ") : "";
    const lim = params.length + 1, off = params.length + 2;
    const sel = extraCols ? `, ${extraCols}` : "";
    const [data, count, stats] = await Promise.all([
      pool.query(`select *${sel} from public.${table} ${where}
        order by _created_at desc nulls last limit $${lim} offset $${off}`, [...params, limit, offset]),
      pool.query(`select count(*)::int as n from public.${table} ${where}`, params),
      pool.query(`select status, count(*)::int as n from public.${table} group by 1`),
    ]);
    res.json({ success: true, data: {
      rows: data.rows, total: count.rows[0].n, limit, offset,
      byStatus: Object.fromEntries(stats.rows.map((r) => [r.status, r.n])),
    } });
  });
}

// Transition helper: UPDATE ... WHERE id AND status IN (allowed) -> row.
function transitionRoute(pool, { table, childTable, childFk, allowed, set }) {
  return wrap(async (req, res) => {
    const id = req.params.id;
    if (!isUuid(id)) throw new HttpError(400, "ID 无效");
    const b = req.body || {};
    const client = await pool.connect();
    let row;
    try {
      await client.query("BEGIN");
      const sets = [], vals = [];
      for (const [col, val] of Object.entries(set)) {
        if (val === "__remark__") { vals.push(String(b.remark || "")); }
        else if (val === "__approvalRemark__") { vals.push(String(b.approvalRemark || "")); }
        else if (val === "__time__") { /* inline now(), no bound param */ }
        else { vals.push(val); }
        sets.push(`${col} = ${val === "__time__" ? "now()" : `$${vals.length}`}`);
      }
      vals.push(id);
      const idIdx = vals.length;
      vals.push(...allowed);
      const statusIdx = vals.map((_, i) => `$${idIdx + 1 + i}`).join(",");
      const upd = await client.query(`update public.${table} set ${sets.join(", ")}, _updated_at=now()
        where id=$${idIdx} and status in (${statusIdx}) returning *`, vals);
      if (!upd.rowCount) {
        const ex = await client.query(`select status from public.${table} where id=$1`, [id]);
        throw new HttpError(ex.rowCount ? 409 : 404,
          ex.rowCount ? `状态 ${ex.rows[0].status} 不允许此操作` : "记录不存在");
      }
      row = upd.rows[0];
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    let children = [];
    if (childTable) {
      const { rows } = await pool.query(`select * from public.${childTable} where ${childFk}=$1`, [id]);
      children = rows;
    }
    res.json({ success: true, data: { order: row, items: children } });
  });
}

export function registerRjvnDocFlowRoutes(app, pgPool, requirePermission) {
  const perm = requirePermission("wms.view");

  // ---- stock-take ----
  app.get("/rjvn-doc/stock-take/list", perm, listRoute(pgPool, {
    table: "rjvn_stock_take_order", searchCols: ["take_no", "warehouse_name", "title"],
  }));
  app.get("/rjvn-doc/stock-take/detail/:id", perm, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw new HttpError(400, "ID 无效");
    const [o, items, logs] = await Promise.all([
      pgPool.query(`select * from public.rjvn_stock_take_order where id=$1`, [req.params.id]),
      pgPool.query(`select * from public.rjvn_stock_take_item where take_id=$1 order by material_code`, [req.params.id]),
      pgPool.query(`select * from public.rjvn_stock_take_log where take_id=$1 order by _created_at desc`, [req.params.id]),
    ]);
    if (!o.rowCount) throw new HttpError(404, "盘点单不存在");
    res.json({ success: true, data: { order: o.rows[0], items: items.rows, logs: logs.rows } });
  }));
  app.post("/rjvn-doc/stock-take/:id/submit", perm, transitionRoute(pgPool, {
    table: "rjvn_stock_take_order", childTable: "rjvn_stock_take_item", childFk: "take_id",
    allowed: ["draft"], set: { status: "submitted", submit_time: "__time__", remark: "__remark__" },
  }));
  app.post("/rjvn-doc/stock-take/:id/approve", perm, transitionRoute(pgPool, {
    table: "rjvn_stock_take_order", childTable: "rjvn_stock_take_item", childFk: "take_id",
    allowed: ["submitted"], set: { status: "approved", approver_name: "wy", approval_time: "__time__", approval_remark: "__remark__" },
  }));
  app.post("/rjvn-doc/stock-take/:id/cancel", perm, transitionRoute(pgPool, {
    table: "rjvn_stock_take_order", allowed: ["draft", "submitted"],
    set: { status: "cancelled", remark: "__remark__" },
  }));

  // ---- mrb ----
  app.get("/rjvn-doc/mrb/list", perm, listRoute(pgPool, {
    table: "rjvn_mrb_review", searchCols: ["mrb_no", "batch_no", "fail_reason"],
  }));
  app.get("/rjvn-doc/mrb/detail/:id", perm, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw new HttpError(400, "ID 无效");
    const [o, disp] = await Promise.all([
      pgPool.query(`select r.*, m.material_code, m.material_name, s.supplier_name
        from public.rjvn_mrb_review r
        left join public.rjvn_material m on m.id=r.material_id
        left join public.rjvn_supplier s on s.id=r.supplier_id where r.id=$1`, [req.params.id]),
      pgPool.query(`select * from public.rjvn_mrb_disposition where mrb_id=$1 order by sort_order`, [req.params.id]),
    ]);
    if (!o.rowCount) throw new HttpError(404, "MRB 不存在");
    res.json({ success: true, data: { order: o.rows[0], items: disp.rows } });
  }));
  app.post("/rjvn-doc/mrb/:id/submit", perm, transitionRoute(pgPool, {
    table: "rjvn_mrb_review", allowed: ["draft"],
    set: { status: "pending_review", status_since: "__time__" },
  }));
  app.post("/rjvn-doc/mrb/:id/final-approve", perm, transitionRoute(pgPool, {
    table: "rjvn_mrb_review", allowed: ["reviewing", "pending_review"],
    set: { status: "approved", final_decision: "approved", final_approval_time: "__time__", final_remark: "__remark__" },
  }));
  app.post("/rjvn-doc/mrb/:id/reject", perm, transitionRoute(pgPool, {
    table: "rjvn_mrb_review", allowed: ["reviewing", "pending_review"],
    set: { status: "rejected", final_decision: "rejected", final_approval_time: "__time__", final_remark: "__remark__" },
  }));

  // ---- supplier-return ----
  app.get("/rjvn-doc/supplier-return/list", perm, listRoute(pgPool, {
    table: "rjvn_supplier_return_order", searchCols: ["return_no", "supplier_code", "supplier_name", "batch_no"],
  }));
  app.get("/rjvn-doc/supplier-return/detail/:id", perm, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw new HttpError(400, "ID 无效");
    const [o, items] = await Promise.all([
      pgPool.query(`select * from public.rjvn_supplier_return_order where id=$1`, [req.params.id]),
      pgPool.query(`select * from public.rjvn_supplier_return_item where order_id=$1`, [req.params.id]),
    ]);
    if (!o.rowCount) throw new HttpError(404, "退货单不存在");
    res.json({ success: true, data: { order: o.rows[0], items: items.rows } });
  }));
  app.post("/rjvn-doc/supplier-return/:id/outbound", perm, transitionRoute(pgPool, {
    table: "rjvn_supplier_return_order", childTable: "rjvn_supplier_return_item", childFk: "order_id",
    allowed: ["pending", "approved"],
    set: { status: "out", out_time: "__time__", out_by: null, remark: "__remark__" },
  }));
  app.post("/rjvn-doc/supplier-return/:id/cancel", perm, transitionRoute(pgPool, {
    table: "rjvn_supplier_return_order", allowed: ["pending", "approved"],
    set: { status: "cancelled", remark: "__remark__" },
  }));

  // ---- over-picking ----
  app.get("/rjvn-doc/over-picking/list", perm, listRoute(pgPool, {
    table: "rjvn_over_picking_order", searchCols: ["order_no", "work_order_no", "applicant_name"],
  }));
  app.get("/rjvn-doc/over-picking/detail/:id", perm, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw new HttpError(400, "ID 无效");
    const [o, items] = await Promise.all([
      pgPool.query(`select * from public.rjvn_over_picking_order where id=$1`, [req.params.id]),
      pgPool.query(`select * from public.rjvn_over_picking_item where order_id=$1`, [req.params.id]),
    ]);
    if (!o.rowCount) throw new HttpError(404, "超领单不存在");
    res.json({ success: true, data: { order: o.rows[0], items: items.rows } });
  }));
  app.post("/rjvn-doc/over-picking/:id/approve", perm, transitionRoute(pgPool, {
    table: "rjvn_over_picking_order", childTable: "rjvn_over_picking_item", childFk: "order_id",
    allowed: ["pending", "pending_approval"],
    set: { status: "approved", approver_name: "wy", approval_time: "__time__", approval_remark: "__remark__" },
  }));
  app.post("/rjvn-doc/over-picking/:id/cancel", perm, transitionRoute(pgPool, {
    table: "rjvn_over_picking_order", allowed: ["pending", "pending_approval"],
    set: { status: "cancelled", remark: "__remark__" },
  }));
}
