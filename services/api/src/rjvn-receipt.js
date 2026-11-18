/**
 * rjvn Receiving core port (NestJS/Drizzle -> Express/raw-pg).
 *
 * Source: D:\rj\rjvn\WMS-20261019\server\modules\receipt\
 *   receipt.service.ts - parseQr / verifyQr / submitIqc (receipt -> IQC lot)
 * All oa-*.ts files skipped (OA out of scope).
 *
 * Operates on the EXISTING public.rjvn_* mirror tables in `smt_factory`.
 * Pure QR parsing is exported; DB routes via registerRjvnReceiptRoutes(...).
 */

export const RECEIPT_CONFIG = {
  qrParts: 6,                       // receipt.service.ts:124-128
  qrSeparator: "*",                 // :123
  status: {
    received: "received",           // :783 submitIqc target
    pendingIqc: "pending_iqc",      // post-submit receipt status
  },
  activeLotStatuses: ["inspecting", "review_pending"], // :848-858
  mergeableLotStatuses: ["pending", "rejected"],       // :902 (F-11 active de-dup key)
  lotNoPrefix: "IQC",               // :821
  defaultUnit: "PCS",               // :906
  advisoryLockKey: 881001,          // :873 pg_advisory_xact_lock
};

/** Pure parse. Source: receipt.service.ts:120-140. */
export function parseQr(qrContent) {
  if (typeof qrContent !== "string" || qrContent.trim() === "") {
    throw new Error("二维码内容不能为空");
  }
  const parts = qrContent.split(RECEIPT_CONFIG.qrSeparator);
  if (parts.length !== RECEIPT_CONFIG.qrParts) {
    throw new Error("二维码格式应为：供应商代码*物料代码*生产日期*数量*批次号*流水号（6段）");
  }
  const [supplierCode, materialCode, productionDate, qtyStr, batchNo, serialNo] = parts;
  if (!supplierCode || !materialCode || !productionDate || !batchNo || !serialNo) {
    throw new Error("二维码格式错误：必填项存在空值");
  }
  const quantity = Number(qtyStr);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("二维码数量格式错误");
  }
  return { supplierCode, materialCode, productionDate, quantity, batchNo, serialNo };
}

// pg returns DATE columns as JS Date objects at local midnight. Passing those
// back verbatim produces "Wed Nov 11 2026 ..." which PostgreSQL cannot parse
// as a date. Normalize to YYYY-MM-DD using LOCAL parts (toISOString would shift
// the calendar day for UTC+7 factories).
function dateVal(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(v);
}

/** Pure group key. Source: receipt.service.ts:802-808. */
export function groupKey(receipt) {
  return JSON.stringify({
    materialId: receipt.material_id,
    supplierId: receipt.supplier_id ?? null,
    productionDate: dateVal(receipt.production_date),
    batchNo: receipt.batch_no ?? null,
  });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) {
      if (res.headersSent) return;
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error("[rjvn-receipt]", e);
      res.status(status).json({ success: false, error: e.message || "Internal error" });
    }
  };
}
const isUuid = (v) => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function limitOf(v) { return Math.min(Math.max(parseInt(v, 10) || 50, 1), 200); }
function offsetOf(v) { return Math.max(parseInt(v, 10) || 0, 0); }

export function registerRjvnReceiptRoutes(app, pgPool, requirePermission) {
  const perm = requirePermission("wms.view");

  // Align the mirror sequence with existing IQC lot numbers once, so the
  // generated suffix never collides with the 501 imported lots.
  void pgPool.query(`
    select setval('public.rjvn_seq_iqc_lot_no',
      greatest(coalesce((select max(substring(lot_no from '\\d+$')::int)
        from public.rjvn_iqc_lot where lot_no like 'IQC%'), 1), 1), true)
  `).catch((e) => console.error("[rjvn-receipt] sequence align:", e.message));

  // Pending IQC receipts: status='received' AND not linked to any IQC lot.
  // Source: receipt.service.ts:764-801 submitIqc step 1.
  app.get("/rjvn-receipt/pending", perm, wrap(async (req, res) => {
    const q = String(req.query.q || "").slice(0, 200);
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const where = `r.status = 'received'
      and not exists (select 1 from public.rjvn_iqc_lot_receipt lr where lr.receipt_id = r.id)
      and ($1::text is null or $1 = '' or
        coalesce(r.receipt_no,'') ilike '%'||$1||'%' or
        coalesce(r.batch_no,'') ilike '%'||$1||'%' or
        coalesce(r.serial_no,'') ilike '%'||$1||'%' or
        coalesce(m.material_code,'') ilike '%'||$1||'%' or
        coalesce(s.supplier_name,'') ilike '%'||$1||'%')`;
    const [data, count] = await Promise.all([
      pgPool.query(`select r.*, m.material_code, m.material_name, s.supplier_name,
          w.location_code
        from public.rjvn_receipt_order r
        left join public.rjvn_material m on m.id = r.material_id
        left join public.rjvn_supplier s on s.id = r.supplier_id
        left join public.rjvn_warehouse_location w on w.id = r.location_id
        where ${where}
        order by r.receipt_date desc nulls last, r.receipt_no desc limit $2 offset $3`, [q || null, limit, offset]),
      pgPool.query(`select count(*)::int as n from public.rjvn_receipt_order r
        left join public.rjvn_material m on m.id = r.material_id
        left join public.rjvn_supplier s on s.id = r.supplier_id where ${where}`, [q || null]),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n, limit, offset } });
  }));

  // QR verification. Source: receipt.service.ts:120-270 parseQr + verifyQr.
  app.post("/rjvn-receipt/verify-qr", perm, wrap(async (req, res) => {
    let parsed;
    try { parsed = parseQr(req.body?.qrContent); }
    catch (e) { return res.json({ success: true, data: { valid: false, errorCode: "bad_format", errorMessage: e.message } }); }

    const mat = await pgPool.query(
      `select id, material_name, unit, msl_level, supplier_code from public.rjvn_material
       where material_code = $1 limit 1`, [parsed.materialCode]);
    if (!mat.rowCount) {
      return res.json({ success: true, data: { ...parsed, valid: false,
        errorCode: "unregistered_material", errorMessage: "物料条码不存在" } });
    }
    const m = mat.rows[0];
    if (!m.supplier_code || m.supplier_code !== parsed.supplierCode) {
      return res.json({ success: true, data: { ...parsed, valid: false,
        materialName: m.material_name, unit: m.unit,
        errorCode: "unqualified_supplier", errorMessage: "非合格供应商" } });
    }
    const dup = await pgPool.query(
      `select id from public.rjvn_receipt_order where qr_content = $1 limit 1`, [req.body.qrContent]);
    if (dup.rowCount) {
      return res.json({ success: true, data: { ...parsed, valid: false,
        materialName: m.material_name, unit: m.unit,
        errorCode: "duplicate_serial", errorMessage: "该标签已收料（重复扫码），请勿重复提交" } });
    }
    res.json({ success: true, data: { ...parsed, valid: true, materialName: m.material_name,
      unit: m.unit, mslLevel: m.msl_level ?? "未知等级" } });
  }));

  // Preview: receipt count + resulting lot count (before committing).
  // Source: receipt.service.ts:736-762 previewSubmitIqc.
  app.post("/rjvn-receipt/submit-iqc/preview", perm, wrap(async (_req, res) => {
    const { rows } = await pgPool.query(`
      select count(*)::int as receipt_count, count(distinct group_key)::int as lot_count
      from (
        select jsonb_build_object('m', material_id, 's', supplier_id,
          'p', production_date, 'b', batch_no)::text as group_key
        from public.rjvn_receipt_order r
        where r.status = 'received' and not exists (
          select 1 from public.rjvn_iqc_lot_receipt lr where lr.receipt_id = r.id)
      ) t`);
    res.json({ success: true, data: rows[0] });
  }));

  // Receipt -> IQC lot. Source: receipt.service.ts:764-1130 submitIqc.
  app.post("/rjvn-receipt/submit-iqc", perm, wrap(async (req, res) => {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const pending = await client.query(`
        select r.*, w.location_code from public.rjvn_receipt_order r
        left join public.rjvn_warehouse_location w on w.id = r.location_id
        where r.status = 'received' and not exists (
          select 1 from public.rjvn_iqc_lot_receipt lr where lr.receipt_id = r.id)
        order by r.receipt_date nulls last, r.receipt_no`);
      if (!pending.rowCount) {
        await client.query("COMMIT");
        return res.json({ success: true, data: { createdLotCount: 0, submittedReceiptCount: 0, lotNos: [] } });
      }

      const groups = new Map();
      for (const r of pending.rows) {
        const key = groupKey(r);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }

      const blocked = [];
      for (const key of groups.keys()) {
        const k = JSON.parse(key);
        const b = await client.query(`
          select l.lot_no, l.status, m.material_code
          from public.rjvn_iqc_lot l left join public.rjvn_material m on m.id = l.material_id
          where l.supplier_id is not distinct from $1
            and l.material_id is not distinct from $2
            and l.production_date is not distinct from $3
            and l.batch_no is not distinct from $4
            and l.status = any($5::text[]) limit 1`,
          [k.supplierId, k.materialId, k.productionDate || null, k.batchNo || null,
            RECEIPT_CONFIG.activeLotStatuses]);
        if (b.rowCount) blocked.push(`${b.rows[0].material_code ?? k.materialId} / ${k.batchNo ?? "-"}: ${b.rows[0].lot_no} (${b.rows[0].status})`);
      }
      if (blocked.length) throw new HttpError(409, `以下批次正在检验/待审核，不能重复提交：${blocked.join("；")}`);

      const lotNos = [];
      let submitted = 0;
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

      for (const key of [...groups.keys()].sort()) {
        const k = JSON.parse(key);
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, $2))",
          [key, RECEIPT_CONFIG.advisoryLockKey]);
        const receipts = groups.get(key);
        const totalQty = receipts.reduce((s, r) => s + Number(r.quantity || 0), 0);
        const unit = receipts[0].unit || RECEIPT_CONFIG.defaultUnit;
        const boxCount = receipts.length;
        const dates = receipts.map((r) => dateVal(r.receipt_date)).filter(Boolean).sort();
        const firstDate = dates[0] ?? new Date().toISOString().slice(0, 10);
        const lastDate = dates[dates.length - 1] ?? firstDate;
        const locationCodes = [...new Set(receipts.map((r) => r.location_code).filter(Boolean))].sort().join(",");
        const mat = await client.query(
          `select material_source from public.rjvn_material where id = $1 limit 1`, [k.materialId]);
        const materialSource = mat.rows[0]?.material_source ?? null;

        const existing = await client.query(`
          select * from public.rjvn_iqc_lot
          where supplier_id is not distinct from $1 and material_id is not distinct from $2
            and production_date is not distinct from $3 and batch_no is not distinct from $4
            and status = any($5::text[])
          order by _created_at desc limit 1 for update`,
          [k.supplierId, k.materialId, k.productionDate || null, k.batchNo || null,
            RECEIPT_CONFIG.mergeableLotStatuses]);

        let lotId, lotNo;
        if (existing.rowCount) {
          const ex = existing.rows[0];
          lotId = ex.id; lotNo = ex.lot_no;
          const exCodes = String(ex.location_codes || "").split(",").filter(Boolean);
          const mergedCodes = [...new Set([...exCodes, ...locationCodes.split(",").filter(Boolean)])].sort().join(",");
          const prevLast = dateVal(ex.last_receipt_date) || "";
          const mergedLast = prevLast && prevLast > lastDate ? prevLast : lastDate;
          await client.query(`update public.rjvn_iqc_lot set
            total_qty = $1, box_count = $2, location_codes = $3, last_receipt_date = $4,
            _updated_at = now() where id = $5`,
            [String(Number(ex.total_qty || 0) + totalQty), Number(ex.box_count || 0) + boxCount,
              mergedCodes, mergedLast, lotId]);
        } else {
          const seq = await client.query(`select nextval('public.rjvn_seq_iqc_lot_no') as n`);
          lotNo = `${RECEIPT_CONFIG.lotNoPrefix}${today}${String(seq.rows[0].n).padStart(4, "0")}`;
          const ins = await client.query(`
            insert into public.rjvn_iqc_lot
              (id, lot_no, receipt_date, last_receipt_date, supplier_id, material_id,
               total_qty, unit, production_date, batch_no, location_codes, box_count,
               material_source, inspection_result, status, _created_at)
            values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', 'pending', now())
            returning id`,
            [lotNo, firstDate, lastDate, k.supplierId, k.materialId, String(totalQty), unit,
              dateVal(k.productionDate), k.batchNo || null, locationCodes || null, boxCount, materialSource]);
          lotId = ins.rows[0].id;
          lotNos.push(lotNo);
        }

        for (const r of receipts) {
          await client.query(`insert into public.rjvn_iqc_lot_receipt
            (id, lot_id, receipt_id, _created_at) values (gen_random_uuid(), $1, $2, now())`,
            [lotId, r.id]);
          await client.query(`update public.rjvn_receipt_order set status = $1, _updated_at = now() where id = $2`,
            [RECEIPT_CONFIG.status.pendingIqc, r.id]);
        }
        submitted += receipts.length;
      }
      await client.query("COMMIT");
      res.json({ success: true, data: { createdLotCount: lotNos.length, submittedReceiptCount: submitted, lotNos } });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }));

  // Receipt list + detail. Source: receipt.service.ts:1134 getReceiptDetail.
  app.get("/rjvn-receipt/list", perm, wrap(async (req, res) => {
    const limit = limitOf(req.query.limit), offset = offsetOf(req.query.offset);
    const status = String(req.query.status || "");
    // Parity with original receipt.service.ts getReceiptList: when no status is
    // supplied, IQC-handled documents are excluded from the default list.
    const where = status
      ? "where r.status = $1"
      : "where coalesce(r.status,'') not in ('pending_iqc','iqc_pass','iqc_fail')";
    const params = status ? [status, limit, offset] : [limit, offset];
    const [data, count] = await Promise.all([
      pgPool.query(`select r.*, m.material_code, m.material_name, s.supplier_name,
        s.supplier_code, w.location_code, ru.user_name as keeper_name
        from public.rjvn_receipt_order r
        left join public.rjvn_material m on m.id = r.material_id
        left join public.rjvn_supplier s on s.id = r.supplier_id
        left join public.rjvn_warehouse_location w on w.id = r.location_id
        left join public.rjvn_role_user ru on ru.user_id::text = r.keeper_id::text
        ${where} order by r.receipt_date desc nulls last, r.receipt_no desc
        limit $${status ? 2 : 1} offset $${status ? 3 : 2}`, params),
      pgPool.query(`select count(*)::int as n from public.rjvn_receipt_order r ${where}`,
        status ? [status] : []),
    ]);
    res.json({ success: true, data: { rows: data.rows, total: count.rows[0].n, limit, offset } });
  }));

  app.get("/rjvn-receipt/list/:id", perm, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw new HttpError(400, "Invalid receipt id");
    const [r, lots] = await Promise.all([
      pgPool.query(`select r.*, m.material_code, m.material_name, s.supplier_name, w.location_code
        from public.rjvn_receipt_order r
        left join public.rjvn_material m on m.id = r.material_id
        left join public.rjvn_supplier s on s.id = r.supplier_id
        left join public.rjvn_warehouse_location w on w.id = r.location_id
        where r.id = $1 limit 1`, [req.params.id]),
      pgPool.query(`select l.id, l.lot_no, l.status, l.total_qty from public.rjvn_iqc_lot l
        join public.rjvn_iqc_lot_receipt lr on lr.lot_id = l.id
        where lr.receipt_id = $1`, [req.params.id]),
    ]);
    if (!r.rowCount) throw new HttpError(404, "Receipt not found");
    res.json({ success: true, data: { receipt: r.rows[0], lots: lots.rows } });
  }));

  // Warehouses + location verification. Source: receipt.service.ts:389-430.
  app.get("/rjvn-receipt/warehouses", perm, wrap(async (_req, res) => {
    const { rows } = await pgPool.query(
      `select id, wh_code, wh_name_zh, wh_name_vi, wh_name_en, wh_type, status
       from public.rjvn_warehouse where status = 'active' and wh_type = 'normal' order by wh_code`);
    res.json({ success: true, data: { rows } });
  }));

  app.post("/rjvn-receipt/verify-location", perm, wrap(async (req, res) => {
    const { locationCode, warehouseId } = req.body || {};
    if (!locationCode || !isUuid(warehouseId)) {
      throw new HttpError(400, "locationCode 与 warehouseId 必填");
    }
    const { rows } = await pgPool.query(
      `select id, location_code, area_code, shelf_code, layer_code, position_code, status
       from public.rjvn_warehouse_location
       where location_code = $1 and warehouse_id = $2 limit 1`, [locationCode, warehouseId]);
    res.json({ success: true, data: { valid: rows.length > 0, location: rows[0] || null } });
  }));
}
