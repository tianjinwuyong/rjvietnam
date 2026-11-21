/**
 * rjvn Inventory core port (NestJS/Drizzle -> Express/raw-pg).
 *
 * Source: D:\rj\rjvn\WMS-20261019\server\modules\inventory\inventory.service.ts
 *   doTransfer()          :1654-1781 - stock movement (source deduct / target upsert / transfer record)
 *   adjustInventory()     :2074-2191 - CAS stock take with advisory lock + balance_after audit
 *   lock/unlockInventory():1944-2042 - lock state with audit trail
 *   getInventorySummary() :977-1000 - available stock aggregation
 *   assertNotMrbReserved():1519-1568 - MRB reservation guard
 * All oa-*.ts files skipped (OA out of scope).
 *
 * Operates on the EXISTING public.rjvn_* mirror tables in `smt_factory`.
 * DB routes registered via registerRjvnInventoryRoutes(app, pgPool, requirePermission).
 */

export const INVENTORY_CONFIG = {
  uniqueKey: ["material_id", "location_id", "batch_no", "stock_status"],
  goodStatus: "good",
  pendingQcStatus: "pending_qc",
  transferNoPrefix: "TRF",       // inventory.service.ts:1790 generateTransferNoWithPrefix
  adjustTxPrefix: "ADJ",         // :2156
  lockTxPrefix: "LCK",           // :2055
  unlockTxPrefix: "ULK",         // :2055
  mrbLockLike: "MRB-%",          // mrb.status.ts:140-142
  mrbOtherLike: "MRB-OTHER:%",   // :125,178
  mrbPrefix: "MRB-",             // :140
  seqTransfer: "public.rjvn_seq_transfer_no",
  seqAdjust: "public.rjvn_seq_adjust_tx_no",
  advisoryKey: "rjvn-inventory-adjust", // :2126 pg_try_advisory_xact_lock(hashtext(id))
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
      if (status === 500) console.error("[rjvn-inventory]", e);
      res.status(status).json({ success: false, error: e.message || "Internal error" });
    }
  };
}
const isUuid = (v) => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function requireUuid(v, name) {
  if (!isUuid(v)) throw new HttpError(400, `${name}ID 无效`);
}
function limitOf(v) { return Math.min(Math.max(parseInt(v, 10) || 50, 1), 200); }
function offsetOf(v) { return Math.max(parseInt(v, 10) || 0, 0); }
function num(v, name, { min = 0, allowZero = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || (!allowZero && n === 0)) {
    throw new HttpError(400, `${name}必须为${allowZero ? "非负" : "大于 0"}的数字`);
  }
  return n;
}

/** MRB reservation guard. Source: inventory.service.ts:1519-1568. */
async function assertNotMrbReserved(client, { inventoryIds = [], locationIds = [] }) {
  const ids = inventoryIds.filter(Boolean);
  const locs = locationIds.filter(Boolean);
  if (!ids.length && !locs.length) return;
  if (ids.length) {
    const ph = ids.map((_, i) => `$${i + 2}`).join(",");
    const { rows } = await client.query(
      `select id, lock_reason from public.rjvn_inventory
       where lock_reason like $1 and id in (${ph}) limit 1`,
      [INVENTORY_CONFIG.mrbLockLike, ...ids]);
    if (rows.length) throw mrbError(rows[0].lock_reason);
  }
  if (locs.length) {
    const ph = locs.map((_, i) => `$${i + 2}`).join(",");
    const { rows } = await client.query(
      `select id, lock_reason from public.rjvn_inventory
       where lock_reason like $1 and location_id in (${ph}) limit 1`,
      [INVENTORY_CONFIG.mrbOtherLike, ...locs]);
    if (rows.length) throw mrbError(rows[0].lock_reason);
  }
}
function mrbError(lockReason) {
  const s = String(lockReason || "");
  const mrbNo = s.startsWith(INVENTORY_CONFIG.mrbPrefix)
    ? s.slice(s.indexOf(":") + 1) : s;
  return new HttpError(400, `该库存已被 MRB 占用（${mrbNo}），不能直接操作`);
}

async function nextNo(client, seq, prefix) {
  const { rows } = await client.query(
    `select nextval($1::regclass) as n`, [seq]);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}${today}${String(Number(rows[0].n)).padStart(4, "0")}`;
}

async function getInventoryById(client, id) {
  const { rows } = await client.query(
    `select i.*, m.material_code, m.material_name, s.supplier_name, w.location_code
     from public.rjvn_inventory i
     left join public.rjvn_material m on m.id = i.material_id
     left join public.rjvn_supplier s on s.id = i.supplier_id
     left join public.rjvn_warehouse_location w on w.id = i.location_id
     where i.id = $1 limit 1`, [id]);
  return rows[0] || null;
}

export function registerRjvnInventoryRoutes(app, pgPool, requirePermission) {
  const perm = requirePermission("wms.view");

  // --- Read: paginated inventory list (filters from getInventoryList :59-231) ---
  app.get("/rjvn-inventory/list", perm, wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const q = String(req.query.q || "").slice(0, 200);
    const warehouseId = isUuid(req.query.warehouseId) ? req.query.warehouseId : null;
    const status = String(req.query.stockStatus || "").slice(0, 40);
    const clauses = [];
    const params = [];
    const add = (sql, val) => { params.push(val); clauses.push(sql.split("$P").join(`$${params.length}`)); };
    if (q) add(`(coalesce(m.material_code,'') ilike '%'||$P||'%' or coalesce(m.material_name,'') ilike '%'||$P||'%' or coalesce(i.batch_no,'') ilike '%'||$P||'%' or coalesce(w.location_code,'') ilike '%'||$P||'%')`, q);
    if (warehouseId) add(`w.warehouse_id = $P`, warehouseId);
    if (status === "locked") clauses.push(`i.locked = true`);
    else if (status) add(`i.stock_status = $P`, status);
    const where = clauses.length ? "where " + clauses.join(" and ") : "";
    const base = `from public.rjvn_inventory i
      left join public.rjvn_material m on m.id = i.material_id
      left join public.rjvn_supplier s on s.id = i.supplier_id
      left join public.rjvn_warehouse_location w on w.id = i.location_id
      left join public.rjvn_warehouse wh on wh.id = w.warehouse_id
      left join lateral (
        select ext.new_expiry_date from public.rjvn_material_expiry_extension ext
        where ext.material_id = i.material_id
          and ext.batch_no is not distinct from i.batch_no
          and ext.location_id is not distinct from i.location_id
        order by ext._created_at desc limit 1
      ) exp on true ${where}`;
    const lim = params.length + 1, off = params.length + 2;
    const [data, count] = await Promise.all([
      pgPool.query(`select i.*, m.material_code, m.material_name, s.supplier_name, w.location_code,
        wh.wh_code, wh.wh_name_zh,
        coalesce(exp.new_expiry_date::text,
          (i.production_date + (m.expiry_days || ' days')::interval)::date::text) as expiry_date ${base}
        order by i._created_at desc nulls last, i.id limit $${lim} offset $${off}`, [...params, limit, offset]),
      pgPool.query(`select count(*)::int as n ${base}`, params),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n, limit, offset } });
  }));

  // --- Available stock summary (getInventorySummary :977-1000) ---
  app.get("/rjvn-inventory/summary", perm, wrap(async (_req, res) => {
    const { rows } = await pgPool.query(`
      select i.material_id, m.material_code, m.material_name, i.unit,
             sum(i.quantity)::numeric as total_qty, count(*)::int as lots
      from public.rjvn_inventory i
      join public.rjvn_material m on m.id = i.material_id
      where i.stock_status = 'good' and i.locked = false
      group by i.material_id, m.material_code, m.material_name, i.unit
      order by total_qty desc limit 200`);
    res.json({ success: true, data: { rows } });
  }));

  // --- Audit trail & transfer history ---
  app.get("/rjvn-inventory/transactions", perm, wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const [data, count] = await Promise.all([
      pgPool.query(`select t.*, m.material_code, m.material_name, w.location_code
        from public.rjvn_inventory_transaction t
        left join public.rjvn_material m on m.id = t.material_id
        left join public.rjvn_warehouse_location w on w.id = t.location_id
        order by t._created_at desc nulls last limit $1 offset $2`, [limit, offset]),
      pgPool.query(`select count(*)::int as n from public.rjvn_inventory_transaction`),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n, limit, offset } });
  }));

  app.get("/rjvn-inventory/transfers", perm, wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const [data, count] = await Promise.all([
      pgPool.query(`select tr.*, m.material_code, m.material_name,
        wl.location_code as from_code, w2.location_code as to_code
        from public.rjvn_stock_transfer tr
        left join public.rjvn_material m on m.id = tr.material_id
        left join public.rjvn_warehouse_location wl on wl.id = tr.from_location_id
        left join public.rjvn_warehouse_location w2 on w2.id = tr.to_location_id
        order by tr._created_at desc nulls last limit $1 offset $2`, [limit, offset]),
      pgPool.query(`select count(*)::int as n from public.rjvn_stock_transfer`),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n, limit, offset } });
  }));

  // --- Transfer (doTransfer :1654-1781) ---
  app.post("/rjvn-inventory/transfer", perm, wrap(async (req, res) => {
    const b = req.body || {};
    requireUuid(b.fromLocationId, "源库位");
    requireUuid(b.toLocationId, "目标库位");
    requireUuid(b.materialId, "物料");
    if (b.fromLocationId === b.toLocationId) throw new HttpError(400, "源库位与目标库位不能相同");
    const qty = num(b.quantity, "移库数量");
    const client = await pgPool.connect();
    let result;
    try {
      await client.query("BEGIN");
      await assertNotMrbReserved(client, { locationIds: [b.fromLocationId] });

      // 1. lock source row (good, unlocked, optional batch)
      const srcWhere = [`location_id = $1`, `material_id = $2`,
        `stock_status = '${INVENTORY_CONFIG.goodStatus}'`, `locked = false`];
      const srcParams = [b.fromLocationId, b.materialId];
      if (b.batchNo) { srcParams.push(b.batchNo); srcWhere.push(`batch_no = $${srcParams.length}`); }
      const { rows: srcRows } = await client.query(
        `select * from public.rjvn_inventory where ${srcWhere.join(" and ")}
         order by _created_at asc limit 1 for update`, srcParams);
      if (!srcRows.length) {
        const locked = await client.query(
          `select id from public.rjvn_inventory where location_id=$1 and material_id=$2
           and stock_status='good' and locked=true and ($3::text is null or batch_no=$3) limit 1`,
          [b.fromLocationId, b.materialId, b.batchNo || null]);
        if (locked.rowCount) throw new HttpError(400, "源库存未完成检验（待检验状态），不允许移库");
        throw new HttpError(404, "源库位无对应库存");
      }
      const src = srcRows[0];
      if (Number(src.quantity) < qty) throw new HttpError(409, "源库位库存不足");

      // 2. validate target location
      const { rows: tgtRows } = await client.query(
        `select id, status from public.rjvn_warehouse_location where id=$1 limit 1`, [b.toLocationId]);
      if (!tgtRows.length) throw new HttpError(404, "目标库位不存在");
      if (tgtRows[0].status !== "active") throw new HttpError(400, "目标库位未启用");

      // 3. deduct source (delete row when it goes to zero)
      const newQty = Number(src.quantity) - qty;
      let upd;
      if (newQty === 0) {
        upd = await client.query(
          `delete from public.rjvn_inventory where id=$1 and quantity >= $2 returning id`,
          [src.id, String(qty)]);
      } else {
        upd = await client.query(
          `update public.rjvn_inventory set quantity = quantity - $1, _updated_at = now()
           where id=$2 and quantity >= $1 returning id`, [String(qty), src.id]);
      }
      if (!upd.rowCount) throw new HttpError(409, "库存变化，扣减失败（请刷新后重试）");

      // 4. upsert target (unique key: material+location+batch+status)
      await client.query(`
        insert into public.rjvn_inventory
          (id, material_id, location_id, batch_no, supplier_id, quantity, unit,
           stock_status, production_date, _created_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now())
        on conflict (material_id, location_id, batch_no, stock_status)
        do update set quantity = public.rjvn_inventory.quantity + excluded.quantity, _updated_at = now()`,
        [b.materialId, b.toLocationId, src.batch_no, src.supplier_id, String(qty),
          src.unit, src.stock_status, src.production_date]);

      // 5. transfer record
      const transferNo = await nextNo(client, INVENTORY_CONFIG.seqTransfer, INVENTORY_CONFIG.transferNoPrefix);
      await client.query(`
        insert into public.rjvn_stock_transfer
          (id, transfer_no, transfer_date, from_location_id, to_location_id, material_id,
           batch_no, quantity, unit, operator_id, status, remark, _created_at)
        values (gen_random_uuid(), $1, current_date, $2, $3, $4, $5, $6, $7, null, 'completed', $8, now())`,
        [transferNo, b.fromLocationId, b.toLocationId, b.materialId, src.batch_no,
          String(qty), src.unit, String(b.remark || "")]);

      await client.query("COMMIT");
      const { rows: tr } = await client.query(
        `select * from public.rjvn_stock_transfer where transfer_no=$1 limit 1`, [transferNo]);
      result = tr[0];
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true, data: result });
  }));

  // --- Adjust (adjustInventory :2074-2191): advisory lock + CAS + balance audit ---
  app.post("/rjvn-inventory/adjust", perm, wrap(async (req, res) => {
    const b = req.body || {};
    requireUuid(b.inventoryId, "库存记录");
    if (!String(b.reason || "").trim()) throw new HttpError(400, "调整原因不能为空");
    const actual = num(b.actualQty, "调整后数量", { allowZero: true });
    const client = await pgPool.connect();
    let result, unchanged = false;
    try {
      await client.query("BEGIN");
      await assertNotMrbReserved(client, { inventoryIds: [b.inventoryId] });

      // pg_try_advisory_xact_lock(hashtext(id)) -> 409 if another tx holds it
      const { rows: lockRows } = await client.query(
        `select pg_try_advisory_xact_lock(hashtext($1)::bigint) as got`, [b.inventoryId]);
      if (!lockRows[0]?.got) throw new HttpError(409, "该库存正在被其他盘点操作处理，请稍后重试");

      const { rows: invRows } = await client.query(
        `select * from public.rjvn_inventory where id=$1 limit 1`, [b.inventoryId]);
      if (!invRows.length) throw new HttpError(404, "库存记录不存在");
      const inv = invRows[0];

      if (inv.locked === true) {
        if (!b.force) throw new HttpError(400, "该库存处于锁定状态（待检验/系统冻结），不能盘点调整");
        if (!String(b.forceReason || "").trim()) throw new HttpError(400, "强制调整必须填写授权原因");
      }

      const current = Number(inv.quantity);
      const diff = actual - current;
      if (diff === 0) { unchanged = true; await client.query("COMMIT"); }
      else {
        // CAS guard: WHERE quantity = old value
        const upd = await client.query(
          `update public.rjvn_inventory set quantity=$1, _updated_at=now()
           where id=$2 and quantity=$3 returning id`, [String(actual), b.inventoryId, String(current)]);
        if (!upd.rowCount) throw new HttpError(409, "库存已被其他操作修改，请刷新后重试");

        const txNo = await nextNo(client, INVENTORY_CONFIG.seqAdjust, INVENTORY_CONFIG.adjustTxPrefix);
        const signed = `${diff > 0 ? "+" : ""}${diff}`;
        const lockNote = inv.locked === true
          ? `（管理员强制调整，授权原因: ${String(b.forceReason).trim()}）` : "";
        await client.query(`
          insert into public.rjvn_inventory_transaction
            (id, material_id, location_id, batch_no, label_no, stock_status, tx_type,
             tx_no, qty, balance_after, unit, reference_no, remark, _created_by, _updated_by, _created_at)
          values (gen_random_uuid(), $1, $2, $3, $4, $5, 'adjust', $6,
                  $7, $8, $9, null, $10, null, null, now())`,
          [inv.material_id, inv.location_id, inv.batch_no, inv.label_no, inv.stock_status,
            txNo, String(diff), String(actual), inv.unit,
            `盘点调整 ${signed}，原因: ${String(b.reason).trim()}${lockNote}`]);
        await client.query("COMMIT");
      }
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    if (unchanged) return res.json({ success: true, data: { unchanged: true } });
    result = await getInventoryById(pgPool, b.inventoryId);
    res.json({ success: true, data: result });
  }));

  // --- Lock / Unlock (lockInventory / unlockInventory :1944-2042) ---
  for (const mode of ["lock", "unlock"]) {
    app.post(`/rjvn-inventory/${mode}`, perm, wrap(async (req, res) => {
      const b = req.body || {};
      requireUuid(b.inventoryId, "库存记录");
      if (mode === "lock" && !String(b.lockReason || "").trim()) {
        throw new HttpError(400, "锁定原因不能为空");
      }
      const client = await pgPool.connect();
      try {
        await client.query("BEGIN");
        await assertNotMrbReserved(client, { inventoryIds: [b.inventoryId] });
        const { rows } = await client.query(
          `select * from public.rjvn_inventory where id=$1 limit 1 for update`, [b.inventoryId]);
        if (!rows.length) throw new HttpError(404, "库存记录不存在");
        const inv = rows[0];
        if (mode === "lock" && inv.locked === true) throw new HttpError(409, "该库存已处于锁定状态");
        if (mode === "unlock") {
          if (inv.locked !== true) throw new HttpError(409, "该库存未处于锁定状态");
          if (inv.stock_status === INVENTORY_CONFIG.pendingQcStatus) {
            throw new HttpError(400, "待检验库存不能解锁，须通过 IQC 检验流程");
          }
        }
        const upd = mode === "lock"
          ? await client.query(`update public.rjvn_inventory set locked=true, lock_reason=$1, _updated_at=now()
              where id=$2 and locked=false returning id`, [String(b.lockReason).trim(), b.inventoryId])
          : await client.query(`update public.rjvn_inventory set locked=false, lock_reason=null, _updated_at=now()
              where id=$1 and locked=true returning id`, [b.inventoryId]);
        if (!upd.rowCount) throw new HttpError(409, "库存状态已被其他操作修改，请刷新后重试");

        const txNo = await nextNo(client, INVENTORY_CONFIG.seqAdjust,
          mode === "lock" ? INVENTORY_CONFIG.lockTxPrefix : INVENTORY_CONFIG.unlockTxPrefix);
        const prevReason = String(inv.lock_reason || "");
        const remark = mode === "lock"
          ? `库存锁定，原因: ${String(b.lockReason).trim()}`
          : `库存解锁${prevReason ? `（原锁定原因: ${prevReason}）` : ""}${b.reason ? `，说明: ${b.reason}` : ""}`;
        await client.query(`
          insert into public.rjvn_inventory_transaction
            (id, material_id, location_id, batch_no, label_no, stock_status, tx_type,
             tx_no, qty, balance_after, unit, remark, _created_at)
          values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, now())`,
          [inv.material_id, inv.location_id, inv.batch_no, inv.label_no, inv.stock_status,
            mode, txNo, String(Number(inv.quantity)), inv.unit, remark]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      res.json({ success: true, data: await getInventoryById(pgPool, b.inventoryId) });
    }));
  }
}
