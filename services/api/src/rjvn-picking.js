/**
 * rjvn Picking core — MERGED ONTO CANONICAL TABLES (one-WMS slice 2, 2026-11-20).
 *
 * Source semantics: D:\rj\rjvn\WMS-20261019\server\modules\workorder\workorder.service.ts
 *   approvePickingOrder() :1757   pending_approval -> approved/rejected
 *   pickMaterial()        :1781-2091  FIFO select lots, deduct stock, status -> issued
 *   receivePickingOrder() :2092-2168  issued/completed -> received
 *
 * WHAT CHANGED AND WHY IT IS NOW ONE SURFACE
 *   This module used to read and write the `rjvn_*` mirrors (uuid PKs, a
 *   `rjvn_inventory` balance table). That made picking a SECOND write surface
 *   beside `wms-graft.js`'s canonical routes, and the two are not synced —
 *   picking_order is not one of migration 309's seven projection-trigger pairs.
 *
 *   It now runs entirely on the authoritative tables:
 *     wms_picking_orders / wms_picking_order_items / material_lots /
 *     inventory_transactions / storage_locations / materials.
 *   Paths, method names, the {success,data} envelope and every response field
 *   the view reads are unchanged, so WmsRjvnPicking.tsx needs no edit.
 *
 *   The stock-accounting question that blocked this ("does picking reduce
 *   on-hand?") is answered by canonical's own code, not chosen here:
 *   server.js:22780 — "PICK = material leaves the warehouse -> post an
 *   ISSUE_TO_LINE stock transaction (inventory is derived from transactions,
 *   never a balance)". AGENTS.md states the same rule. So a pick posts
 *   ISSUE_TO_LINE; it does not touch a balance column. The reference reached the
 *   same effect by decrementing inventory.quantity because IT has no ledger —
 *   reserved_qty appears 0 times in its schema.ts; it reserves with a `locked`
 *   boolean. Same business act, different mechanism.
 *
 *   Reels: `rjvn_picking_reel` had no canonical twin and 0 rows. Each posted
 *   WMS_PICK ledger row *is* the lot-level issuance record a reel row was, so
 *   /reels is served from inventory_transactions — no new table invented.
 *
 *   Permissions: every write here used to be gated by `wms.view`, i.e. a
 *   read-only permission could mutate stock. Writes are now `wms.execute`.
 *
 *   Ids: the canonical PK is bigint. A uuid is still ACCEPTED and resolved
 *   through `wms_picking_orders.rjvn_id`, so old bookmarks and saved links land
 *   on the right row instead of 400ing.
 */
export const PICKING_CONFIG = {
  noPrefix: "PK",
  statuses: {
    pendingApproval: "pending_approval",
    approved: "approved",
    rejected: "rejected",
    issued: "issued",          // reference calls the post-pick state 'issued'; kept
    received: "received",
  },
  pickTxAction: "ISSUE_TO_LINE",
  pickTxRefType: "WMS_PICK",
};

const TXN_COLS = `
  SELECT t.id, t.tx_no, t.qty, t.reference_no, t.occurred_at, t.operator_id,
         ml.lot_no AS batch_no, ml.material_id, ml.storage_location_id,
         m.code AS material_code, m.name_zh AS material_name,
         -- Location at issue time (t.from_location_id) beats the lot's CURRENT
         -- location: the ledger is append-only and the lot may have moved since.
         COALESCE(slf.code, slc.code) AS location_code
    FROM inventory_transactions t
    LEFT JOIN material_lots ml ON ml.id = t.material_lot_id
    LEFT JOIN materials m ON m.id = ml.material_id
    LEFT JOIN storage_locations slf ON slf.id = t.from_location_id
    LEFT JOIN storage_locations slc ON slc.id = ml.storage_location_id`;

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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limitOf = (v) => Math.min(Math.max(parseInt(v, 10) || 50, 1), 200);
const offsetOf = (v) => Math.max(parseInt(v, 10) || 0, 0);

/**
 * Resolve a picking-order id to its canonical bigint.
 * Accepts a canonical numeric id or a legacy mirror uuid (via rjvn_id), so both
 * the new UI and pre-merge links resolve. Throws 400 on garbage, 404 on unknown.
 */
async function resolveOrderId(client, raw) {
  const s = String(raw ?? "").trim();
  if (/^\d+$/.test(s)) {
    const { rows } = await client.query(`SELECT id FROM public.wms_picking_orders WHERE id=$1`, [s]);
    if (!rows.length) throw new HttpError(404, "拣货单不存在");
    return rows[0].id;
  }
  if (UUID_RE.test(s)) {
    const { rows } = await client.query(`SELECT id FROM public.wms_picking_orders WHERE rjvn_id=$1`, [s]);
    if (!rows.length) throw new HttpError(404, "拣货单不存在");
    return rows[0].id;
  }
  throw new HttpError(400, "拣货单ID无效");
}

async function getById(client, id) {
  const { rows } = await client.query(`
    SELECT id, picking_no, work_order_no, work_section, total_qty, status,
           applicant_name, source, req_id, is_supplement, approval_time, approval_remark,
           pick_time, received_time, receive_remark, mes_issue_no, remark, created_at, updated_at
      FROM public.wms_picking_orders WHERE id=$1 LIMIT 1`, [id]);
  if (!rows.length) return null;
  const { rows: items } = await client.query(`
    SELECT id, picking_id, material_code, material_name, unit,
           pick_qty, actual_qty, received_qty, actual_material_code, receive_remark, mpq, issue_qty
      FROM public.wms_picking_order_items WHERE picking_id=$1 ORDER BY material_code`, [id]);
  return { order: rows[0], items };
}

export function registerRjvnPickingRoutes(app, pgPool, requirePermission) {
  const readPerm = requirePermission("wms.view");
  const writePerm = requirePermission("wms.execute");

  app.get("/rjvn-picking/list", readPerm, wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const q = String(req.query.q || "").slice(0, 200);
    const status = String(req.query.status || "").slice(0, 40);
    const clauses = [], params = [];
    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(coalesce(p.picking_no,'') ilike $${params.length} or coalesce(p.work_order_no,'') ilike $${params.length})`);
    }
    if (status) { params.push(status); clauses.push(`p.status = $${params.length}`); }
    const where = clauses.length ? "where " + clauses.join(" and ") : "";
    const base = `from public.wms_picking_orders p ${where}`;
    const lim = params.length + 1, off = params.length + 2;
    const [data, count, stats] = await Promise.all([
      pgPool.query(`select p.* ${base} order by p.picking_no desc limit $${lim} offset $${off}`, [...params, limit, offset]),
      pgPool.query(`select count(*)::int as n ${base}`, params),
      pgPool.query(`select status, count(*)::int as n from public.wms_picking_orders group by 1`),
    ]);
    res.json({ success: true, data: {
      rows: data.rows, total: count.rows[0].n, limit, offset,
      byStatus: Object.fromEntries(stats.rows.map((r) => [r.status, r.n])),
    } });
  }));

  app.get("/rjvn-picking/detail/:id", readPerm, wrap(async (req, res) => {
    const id = await resolveOrderId(pgPool, req.params.id);
    const d = await getById(pgPool, id);
    if (!d) throw new HttpError(404, "拣货单不存在");
    res.json({ success: true, data: d });
  }));

  // Approve. Source: approvePickingOrder :1757 — CAS on the expected status,
  // matching the reference invariant "never read-then-write".
  app.post("/rjvn-picking/:id/approve", writePerm, wrap(async (req, res) => {
    const b = req.body || {};
    const client = await pgPool.connect();
    let id;
    try {
      id = await resolveOrderId(client, req.params.id);
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT id, status FROM public.wms_picking_orders WHERE id=$1 FOR UPDATE`, [id]);
      if (!rows.length) throw new HttpError(404, "拣货单不存在");
      if (rows[0].status !== PICKING_CONFIG.statuses.pendingApproval) {
        throw new HttpError(400, "拣货单状态不允许审批");
      }
      const next = b.pass === false ? PICKING_CONFIG.statuses.rejected : PICKING_CONFIG.statuses.approved;
      // Reference invariant: operator identity comes from the token, never the body.
      const approver = req.user?.userId ?? req.user?.id ?? null;
      await client.query(
        `UPDATE public.wms_picking_orders
            SET status=$1, approver_id=$2, approval_time=now(), approval_remark=$3, updated_at=now()
          WHERE id=$4 AND status=$5`,
        [next, approver, String(b.approvalRemark || ""), id, rows[0].status]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    res.json({ success: true, data: await getById(pgPool, id) });
  }));

  // Pick (FIFO issue). Source: pickMaterial :1781-2091.
  // The reference decremented an inventory balance row; canonical derives stock
  // from the ledger, so each lot consumed posts one ISSUE_TO_LINE transaction
  // tagged reference_type='WMS_PICK' — the same idiom as the collect-order pick
  // path (server.js:22780-22806), including its idempotency guard.
  app.post("/rjvn-picking/:id/pick", writePerm, wrap(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw new HttpError(400, "缺少拣货明细");
    const client = await pgPool.connect();
    let id;
    try {
      id = await resolveOrderId(client, req.params.id);
      await client.query("BEGIN");
      const { rows: ordRows } = await client.query(
        `SELECT id, picking_no, work_order_no, status
           FROM public.wms_picking_orders WHERE id=$1 FOR UPDATE`, [id]);
      if (!ordRows.length) throw new HttpError(404, "拣货单不存在");
      const order = ordRows[0];
      if (order.status !== PICKING_CONFIG.statuses.approved) {
        throw new HttpError(400, "拣货单未审批通过，不能拣货");
      }
      const { rows: poItems } = await client.query(
        `SELECT id, material_code, material_name, pick_qty, actual_qty
           FROM public.wms_picking_order_items WHERE picking_id=$1`, [id]);
      if (!poItems.length) throw new HttpError(400, "拣货单无明细");

      const pickerId = req.user?.userId ?? req.user?.id ?? null;
      const issuedLots = [];
      for (const pi of items) {
        const item = poItems.find((i) => String(i.id) === String(pi.id));
        if (!item) throw new HttpError(400, `明细不存在: ${pi.id}`);
        const actual = Number(pi.actualQty);
        if (!Number.isFinite(actual) || actual <= 0) continue;
        if (actual > Number(item.pick_qty)) {
          throw new HttpError(400, `实拣数量不能超过应拣数量: ${item.material_code}`);
        }

        // FIFO over canonical lots: released IQC, open lot, not manually frozen,
        // oldest receipt first. Same ordering the canonical FIFO read uses
        // (received_at ASC NULLS LAST, id ASC).
        // 冻结（migration 332）必须在这里生效：只有 pick 会真的扣库存。
        const avail = await client.query(`
          SELECT ml.id, ml.lot_no, ml.storage_location_id,
                 (COALESCE(ml.received_qty,0) - COALESCE(ml.reserved_qty,0)) AS available
            FROM material_lots ml
            JOIN materials m ON m.id = ml.material_id
           WHERE m.code = $1
             AND ml.iqc_status = 'released'
             AND COALESCE(ml.lot_status,'open') IN ('open','active')
             AND COALESCE(ml.lifecycle_status,'NORMAL') <> 'EXPIRED_ISOLATED'
             AND NOT COALESCE(ml.locked, false)
             AND (COALESCE(ml.received_qty,0) - COALESCE(ml.reserved_qty,0)) > 0
           ORDER BY ml.received_at ASC NULLS LAST, ml.id ASC`, [item.material_code]);

        const available = avail.rows.reduce((s, r) => s + Number(r.available), 0);
        if (available < actual) {
          // Mirror the reference's two-tier refusal: say so when the shortfall is
          // specifically uninspected stock, because that needs IQC, not a retry.
          const pending = (await client.query(`
            SELECT COALESCE(SUM(ml.received_qty),0)::numeric AS qty
              FROM material_lots ml JOIN materials m ON m.id = ml.material_id
             WHERE m.code = $1 AND ml.iqc_status <> 'released'
               AND COALESCE(ml.lot_status,'open') NOT IN ('closed','voided')`,
            [item.material_code])).rows[0];
          if (Number(pending.qty) > 0) {
            throw new HttpError(409, `物料 ${item.material_code} 有 ${pending.qty} 数量未检验库存不可发料，请先处理`);
          }
          // 第三档：库存有，但被人手工冻结了。这条要单独说，因为需要有人去解冻，
          // 而不是等 IQC 或补货。
          const frozen = (await client.query(`
            SELECT COALESCE(SUM(COALESCE(ml.received_qty,0) - COALESCE(ml.reserved_qty,0)),0)::numeric AS qty,
                   MIN(ml.lock_reason) AS reason
              FROM material_lots ml JOIN materials m ON m.id = ml.material_id
             WHERE m.code = $1 AND COALESCE(ml.locked,false)
               AND COALESCE(ml.lot_status,'open') NOT IN ('closed','voided')`,
            [item.material_code])).rows[0];
          if (Number(frozen.qty) > 0) {
            throw new HttpError(409, `物料 ${item.material_code} 有 ${frozen.qty} 数量被冻结（原因：${frozen.reason || "未填写"}），解冻后才能发料`);
          }
          throw new HttpError(409, `物料 ${item.material_code} 可用库存不足（可用 ${available}，需 ${actual}）`);
        }

        let remaining = actual;
        for (const lot of avail.rows) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, Number(lot.available));
          // Idempotency: a re-picked line must never deduct twice. Keyed per
          // (picking line, lot) so partial multi-lot picks still work.
          const refNo = `PK:${order.picking_no}:L${item.id}:${lot.lot_no}`;
          const already = (await client.query(
            `SELECT 1 FROM inventory_transactions
              WHERE reference_type=$1 AND reference_no=$2 LIMIT 1`,
            [PICKING_CONFIG.pickTxRefType, refNo])).rowCount;
          if (!already) {
            // work_order_id is left NULL deliberately: wms_picking_orders carries
            // only work_order_no (a varchar), and public.work_orders has 0 rows,
            // so there is no bigint to reference. The ledger column is nullable
            // and the picking number is preserved in reference_no instead
            // (PK:<picking_no>:L<item>:<lot>), so the audit trail is complete.
            // from_location_id records where the stock left from, as of this
            // issue — the append-only ledger keeps it even if the lot moves.
            await client.query(`
              INSERT INTO inventory_transactions
                (tx_no, action, material_lot_id, work_order_id, qty, operator_id,
                 occurred_at, tx_status, voided, reference_type, reference_no, is_test,
                 from_location_id)
              VALUES ($1,$2,$3,$4,$5,$6,NOW(),'posted',false,$7,$8,false,$9)`,
              [`TXN-PICK-${order.picking_no}-${item.id}-${lot.lot_no}`,
               PICKING_CONFIG.pickTxAction, lot.id, null,
               take, pickerId, PICKING_CONFIG.pickTxRefType, refNo,
               lot.storage_location_id ?? null]);
          }
          issuedLots.push({ lotNo: lot.lot_no, qty: take, locationId: lot.storage_location_id });
          remaining -= take;
        }
        await client.query(
          `UPDATE public.wms_picking_order_items
              SET actual_qty=$1, updated_at=now() WHERE id=$2 AND picking_id=$3`,
          [String(actual), item.id, id]);
      }
      await client.query(
        `UPDATE public.wms_picking_orders
            SET status=$1, picker_id=$2, pick_time=now(), updated_at=now() WHERE id=$3`,
        [PICKING_CONFIG.statuses.issued, pickerId, id]);
      await client.query("COMMIT");
      res.json({ success: true, data: { ...(await getById(pgPool, id)), issuedLots } });
      return;
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  }));

  // Receive. Source: receivePickingOrder :2092-2168.
  app.post("/rjvn-picking/:id/receive", writePerm, wrap(async (req, res) => {
    const b = req.body || {};
    const client = await pgPool.connect();
    let id;
    try {
      id = await resolveOrderId(client, req.params.id);
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT id, status FROM public.wms_picking_orders WHERE id=$1 FOR UPDATE`, [id]);
      if (!rows.length) throw new HttpError(404, "拣货单不存在");
      if (![PICKING_CONFIG.statuses.issued, "completed"].includes(rows[0].status)) {
        throw new HttpError(400, "非已发料/已完成状态的拣货单不能签收");
      }
      const receiverId = req.user?.userId ?? req.user?.id ?? null;
      for (const it of Array.isArray(b.items) ? b.items : []) {
        await client.query(
          `UPDATE public.wms_picking_order_items
              SET received_qty=$1, receive_remark=$2, updated_at=now()
            WHERE id=$3 AND picking_id=$4`,
          [String(Number(it.receivedQty) || 0), String(it.remark || ""), it.id, id]);
      }
      await client.query(
        `UPDATE public.wms_picking_orders
            SET status=$1, received_by=$2, received_time=now(), receive_remark=$3, updated_at=now()
          WHERE id=$4`,
        [PICKING_CONFIG.statuses.received, receiverId, String(b.remark || ""), id]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    res.json({ success: true, data: await getById(pgPool, id) });
  }));

  // Reels: the lot-level issuance record. Served from the WMS_PICK ledger —
  // each row is what a rjvn_picking_reel row used to be (0 rows ever existed).
  app.get("/rjvn-picking/reels", readPerm, wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const pickingNo = String(req.query.pickingNo || "").slice(0, 60);
    // One placeholder list, built once. $1 = reference_type, then optional
    // picking_no, then limit/offset — so the indexes below must match exactly.
    const params = [PICKING_CONFIG.pickTxRefType];
    if (pickingNo) params.push(pickingNo);
    const limitPh = params.length + 1, offsetPh = params.length + 2;
    const data = await pgPool.query(
      `${TXN_COLS}
       WHERE t.reference_type = $1
         ${pickingNo ? `AND t.reference_no LIKE 'PK:' || $2 || ':%'` : ""}
       ORDER BY t.occurred_at DESC NULLS LAST LIMIT $${limitPh} OFFSET $${offsetPh}`,
      [...params, limit, offset]);
    // total must honour the same filter as the page, or a filtered view reports
    // the whole ledger's size.
    const count = await pgPool.query(
      `SELECT count(*)::int AS n FROM inventory_transactions t
        WHERE t.reference_type=$1
          ${pickingNo ? `AND t.reference_no LIKE 'PK:' || $2 || ':%'` : ""}`,
      params);
    // reference_no is the key this module writes: PK:<picking_no>:L:<lot_no>.
    // split_part recovers the picking number without joining back to the order.
    res.json({ success: true, data: {
      rows: data.rows.map((r) => ({
        ...r,
        reel_no: r.tx_no,
        picking_no: String(r.reference_no || "").split(":")[1] ?? null,
        issued_qty: r.qty,
        status: r.tx_status ?? "issued",
      })),
      total: count.rows[0].n, limit, offset,
    } });
  }));
}
