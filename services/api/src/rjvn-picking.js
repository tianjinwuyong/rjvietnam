/**
 * rjvn Picking core port (NestJS/Drizzle -> Express/raw-pg).
 *
 * Source: D:\rj\rjvn\WMS-20261019\server\modules\workorder\workorder.service.ts
 *   getPickingOrderList() :1480, getPickingOrderById() :2469
 *   approvePickingOrder() :1757 - pending_approval -> approved/rejected
 *   pickMaterial()        :1781-2091 - FIFO deduct good/unlocked stock, write audit + reels, status -> issued
 *   receivePickingOrder() :2092-2168 - issued -> received
 * OA (oa-integration / oa-doc) intentionally skipped.
 *
 * Operates on the EXISTING public.rjvn_* mirror tables in `smt_factory`.
 */
export const PICKING_CONFIG = {
  noPrefix: "PK",            // workorder.service.ts:1737 generatePickingNo
  statuses: {
    pendingApproval: "pending_approval",
    approved: "approved",
    rejected: "rejected",
    issued: "issued",          // :pickMaterial status set
    received: "received",      // :2092 receivePickingOrder
  },
  pickTxType: "pick",
  seqReel: null,
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) {
      if (res.headersSent) return;
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error("[rjvn-picking]", e);
      res.status(status).json({ success: false, error: e.message || "Internal error" });
    }
  };
}
const isUuid = (v) => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function requireUuid(v, name) { if (!isUuid(v)) throw new HttpError(400, `${name}ID 无效`); }
function limitOf(v) { return Math.min(Math.max(parseInt(v, 10) || 50, 1), 200); }
function offsetOf(v) { return Math.max(parseInt(v, 10) || 0, 0); }

async function getById(client, id) {
  const { rows } = await client.query(`
    select p.*, wo.work_order_no, wo.work_order_no as wo_no
    from public.rjvn_picking_order p
    left join public.rjvn_work_order wo on wo.id = p.work_order_id
    where p.id = $1 limit 1`, [id]);
  if (!rows.length) return null;
  const { rows: items } = await client.query(
    `select * from public.rjvn_picking_order_item where picking_id = $1 order by material_code`, [id]);
  return { order: rows[0], items };
}

export function registerRjvnPickingRoutes(app, pgPool, requirePermission) {
  const perm = requirePermission("wms.view");

  // List with optional status/workOrder filters. Source: getPickingOrderList :1480.
  app.get("/rjvn-picking/list", perm, wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const q = String(req.query.q || "").slice(0, 200);
    const status = String(req.query.status || "").slice(0, 40);
    const clauses = [], params = [];
    if (q) {
      params.push(q);
      clauses.push(`(coalesce(p.picking_no,'') ilike '%'||$${params.length}||'%' or
        coalesce(wo.work_order_no,'') ilike '%'||$${params.length}||'%')`);
    }
    if (status) { params.push(status); clauses.push(`p.status = $${params.length}`); }
    const where = clauses.length ? "where " + clauses.join(" and ") : "";
    const base = `from public.rjvn_picking_order p
      left join public.rjvn_work_order wo on wo.id = p.work_order_id ${where}`;
    const lim = params.length + 1, off = params.length + 2;
    const [data, count, stats] = await Promise.all([
      pgPool.query(`select p.*, wo.work_order_no ${base}
        order by p._created_at desc nulls last limit $${lim} offset $${off}`, [...params, limit, offset]),
      pgPool.query(`select count(*)::int as n ${base}`, params),
      pgPool.query(`select status, count(*)::int as n from public.rjvn_picking_order group by 1`),
    ]);
    res.json({ success: true, data: {
      rows: data.rows, total: count.rows[0].n, limit, offset,
      byStatus: Object.fromEntries(stats.rows.map((r) => [r.status, r.n])),
    } });
  }));

  app.get("/rjvn-picking/detail/:id", perm, wrap(async (req, res) => {
    requireUuid(req.params.id, "拣货单");
    const d = await getById(pgPool, req.params.id);
    if (!d) throw new HttpError(404, "拣货单不存在");
    res.json({ success: true, data: d });
  }));

  // Approve. Source: approvePickingOrder :1757.
  app.post("/rjvn-picking/:id/approve", perm, wrap(async (req, res) => {
    requireUuid(req.params.id, "拣货单");
    const b = req.body || {};
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `select id, status from public.rjvn_picking_order where id=$1 for update`, [req.params.id]);
      if (!rows.length) throw new HttpError(404, "拣货单不存在");
      if (rows[0].status !== PICKING_CONFIG.statuses.pendingApproval) {
        throw new HttpError(400, "拣货单状态不允许审批");
      }
      await client.query(`update public.rjvn_picking_order set
        status=$1, approval_time=now(), approval_remark=$2, _updated_at=now() where id=$3`,
        [b.pass === false ? PICKING_CONFIG.statuses.rejected : PICKING_CONFIG.statuses.approved,
          String(b.approvalRemark || ""), req.params.id]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    res.json({ success: true, data: await getById(pgPool, req.params.id) });
  }));

  // Pick (FIFO). Source: pickMaterial :1781-2091.
  app.post("/rjvn-picking/:id/pick", perm, wrap(async (req, res) => {
    requireUuid(req.params.id, "拣货单");
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw new HttpError(400, "缺少拣货明细");
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const { rows: ordRows } = await client.query(
        `select * from public.rjvn_picking_order where id=$1 for update`, [req.params.id]);
      if (!ordRows.length) throw new HttpError(404, "拣货单不存在");
      const order = ordRows[0];
      if (order.status !== PICKING_CONFIG.statuses.approved) {
        throw new HttpError(400, "拣货单未审批通过，不能拣货");
      }
      const { rows: poItems } = await client.query(
        `select * from public.rjvn_picking_order_item where picking_id=$1`, [req.params.id]);
      if (!poItems.length) throw new HttpError(400, "拣货单无明细");

      const pickNos = new Set();
      for (const pi of items) {
        const item = poItems.find((i) => String(i.id) === String(pi.id));
        if (!item) throw new HttpError(400, `明细不存在: ${pi.id}`);
        const actual = Number(pi.actualQty);
        if (!Number.isFinite(actual) || actual <= 0) continue;
        if (actual > Number(item.pick_qty)) {
          throw new HttpError(400, `实拣数量不能超过应拣数量: ${item.material_code}`);
        }
        let remaining = actual;
        // FIFO: earliest production date / creation first; good + unlocked stock.
        const { rows: stock } = await client.query(`
          select i.*, l.location_code, m.material_code
          from public.rjvn_inventory i
          join public.rjvn_warehouse_location l on l.id = i.location_id
          join public.rjvn_material m on m.id = i.material_id
          where i.material_id = $1 and i.stock_status = 'good' and i.locked = false
            and (l.location_type = 'good' or l.location_type is null)
            and i.quantity > 0
          order by i.production_date nulls last, i._created_at asc`, [item.material_id]);
        const available = stock.reduce((s, r) => s + Number(r.quantity), 0);
        if (available < actual) {
          const { rows: locked } = await client.query(`
            select coalesce(sum(i.quantity),0)::numeric as qty
            from public.rjvn_inventory i join public.rjvn_warehouse_location l on l.id=i.location_id
            where i.material_id=$1 and i.stock_status='good' and i.locked=true
              and (l.location_type='good' or l.location_type is null)`, [item.material_id]);
          if (Number(locked[0].qty) > 0) {
            throw new HttpError(409, `物料 ${item.material_code} 有 ${locked[0].qty} 数量未检验库存不可发料，请先处理`);
          }
          throw new HttpError(409, `物料 ${item.material_code} 可用库存不足（可用 ${available}，需 ${actual}）`);
        }

        for (const s of stock) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, Number(s.quantity));
          const after = Number(s.quantity) - take;
          if (after === 0) {
            await client.query(`delete from public.rjvn_inventory where id=$1 and quantity=$2`, [s.id, s.quantity]);
          } else {
            await client.query(`update public.rjvn_inventory set quantity=$1, _updated_at=now()
              where id=$2 and quantity=$3`, [String(after), s.id, s.quantity]);
          }
          await client.query(`
            insert into public.rjvn_inventory_transaction
              (id, material_id, location_id, batch_no, label_no, stock_status, tx_type,
               tx_no, qty, balance_after, unit, remark, _created_at)
            values (gen_random_uuid(), $1, $2, $3, $4, 'good', 'pick', $5,
                    $6, $7, $8, $9, now())`,
            [s.material_id, s.location_id, s.batch_no, s.label_no, order.picking_no,
              String(-take), String(after), s.unit, `拣货出库 ${order.picking_no}`]);
          await client.query(`
            insert into public.rjvn_picking_reel
              (id, picking_id, picking_item_id, work_order_id, material_id, reel_no, batch_no,
               from_location_id, issued_qty, status, issued_at, _created_at)
            values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'issued', now(), now())`,
            [req.params.id, item.id, order.work_order_id, item.material_id,
              `R-${order.picking_no}-${pickNos.size + 1}`, s.batch_no, s.location_id, String(take)]);
          remaining -= take;
          pickNos.add(s.id);
        }
        await client.query(
          `update public.rjvn_picking_order_item set actual_qty=$1, _updated_at=now() where id=$2`,
          [String(actual), item.id]);
      }
      await client.query(`update public.rjvn_picking_order set
        status=$1, picker_id=null, pick_time=now(), _updated_at=now() where id=$2`,
        [PICKING_CONFIG.statuses.issued, req.params.id]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    res.json({ success: true, data: await getById(pgPool, req.params.id) });
  }));

  // Receive. Source: receivePickingOrder :2092-2168.
  app.post("/rjvn-picking/:id/receive", perm, wrap(async (req, res) => {
    requireUuid(req.params.id, "拣货单");
    const b = req.body || {};
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `select * from public.rjvn_picking_order where id=$1 for update`, [req.params.id]);
      if (!rows.length) throw new HttpError(404, "拣货单不存在");
      if (![PICKING_CONFIG.statuses.issued, "completed"].includes(rows[0].status)) {
        throw new HttpError(400, "非已发料/已完成状态的拣货单不能签收");
      }
      const inputs = Array.isArray(b.items) ? b.items : [];
      for (const it of inputs) {
        await client.query(`update public.rjvn_picking_order_item
          set received_qty=$1, receive_remark=$2, _updated_at=now()
          where id=$3 and picking_id=$4`,
          [String(Number(it.receivedQty) || 0), String(it.remark || ""), it.id, req.params.id]);
      }
      await client.query(`update public.rjvn_picking_order set
        status=$1, received_time=now(), receive_remark=$2, _updated_at=now() where id=$3`,
        [PICKING_CONFIG.statuses.received, String(b.remark || ""), req.params.id]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    res.json({ success: true, data: await getById(pgPool, req.params.id) });
  }));

  app.get("/rjvn-picking/reels", perm, wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const [data, count] = await Promise.all([
      pgPool.query(`select r.*, m.material_code, m.material_name, l.location_code
        from public.rjvn_picking_reel r
        left join public.rjvn_material m on m.id = r.material_id
        left join public.rjvn_warehouse_location l on l.id = r.from_location_id
        order by r._created_at desc nulls last limit $1 offset $2`, [limit, offset]),
      pgPool.query(`select count(*)::int as n from public.rjvn_picking_reel`),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n, limit, offset } });
  }));
}
