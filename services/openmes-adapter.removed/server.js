import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, "services/api/.env") });
dotenv.config({ path: path.join(root, ".env"), override: false });

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "smt_factory",
  password: process.env.PGPASSWORD ?? "smt_factory",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 8,
});
const app = express();
app.use(express.json({ limit: "2mb" }));

const port = Number(process.env.OPENMES_ADAPTER_PORT ?? 8092);
const openMesBase = String(process.env.OPENMES_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const openMesKey = String(process.env.OPENMES_API_KEY ?? "");
const batchSize = Number(process.env.OPENMES_SYNC_BATCH_SIZE ?? 200);

function hashPayload(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function openMesRequest(method, endpoint, body) {
  if (!openMesKey) throw new Error("OPENMES_API_KEY is not configured");
  const response = await fetch(`${openMesBase}${endpoint}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Api-Key": openMesKey },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.OPENMES_HTTP_TIMEOUT_MS ?? 15000)),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`OpenMES ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function createRun(entityType) {
  const result = await pool.query(
    "INSERT INTO openmes_sync_runs(direction,entity_type) VALUES('OUTBOUND',$1) RETURNING id",
    [entityType],
  );
  return result.rows[0].id;
}

async function finishRun(id, status, counts, errorMessage = null) {
  await pool.query(
    "UPDATE openmes_sync_runs SET status=$1,request_count=$2,success_count=$3,error_count=$4,error_message=$5,finished_at=NOW() WHERE id=$6",
    [status, counts.requestCount, counts.successCount, counts.errorCount, errorMessage, id],
  );
}

async function recordObjects(entityType, rows) {
  for (const row of rows) {
    await pool.query(
      `INSERT INTO openmes_sync_objects(entity_type,source_key,payload_hash,status,last_synced_at,updated_at)
       VALUES($1,$2,$3,'SYNCED',NOW(),NOW())
       ON CONFLICT(entity_type,source_key) DO UPDATE SET payload_hash=$3,status='SYNCED',last_error=NULL,last_synced_at=NOW(),updated_at=NOW()`,
      [entityType, row.sourceKey, hashPayload(row.payload)],
    );
  }
}

async function upsertObject(entityType, sourceKey, payload, sync) {
  const payloadHash = hashPayload(payload);
  const existing = await pool.query(
    "SELECT payload_hash,status FROM openmes_sync_objects WHERE entity_type=$1 AND source_key=$2",
    [entityType, sourceKey],
  );
  if (!process.env.OPENMES_FORCE_SYNC && existing.rows[0]?.payload_hash === payloadHash && existing.rows[0]?.status === "SYNCED") {
    sync.skippedCount = (sync.skippedCount ?? 0) + 1;
    return { skipped: true };
  }
  await pool.query(
    `INSERT INTO openmes_sync_objects(entity_type,source_key,payload_hash,status,updated_at)
     VALUES($1,$2,$3,'PENDING',NOW())
     ON CONFLICT(entity_type,source_key) DO UPDATE SET payload_hash=$3,status='PENDING',last_error=NULL,updated_at=NOW()`,
    [entityType, sourceKey, payloadHash],
  );
  try {
    const response = await openMesRequest("POST", "/api/v1/erp/" + sync.endpoint, sync.body(payload));
    await pool.query(
      "UPDATE openmes_sync_objects SET status='SYNCED',target_key=$1,last_synced_at=NOW(),updated_at=NOW() WHERE entity_type=$2 AND source_key=$3",
      [response?.data?.id ? String(response.data.id) : null, entityType, sourceKey],
    );
    return { skipped: false, response };
  } catch (error) {
    await pool.query(
      "UPDATE openmes_sync_objects SET status='ERROR',last_error=$1,updated_at=NOW() WHERE entity_type=$2 AND source_key=$3",
      [error.message, entityType, sourceKey],
    );
    throw error;
  }
}

async function syncMasterData({ dryRun = false } = {}) {
  const runId = await createRun("MASTER_DATA");
  const counts = { requestCount: 0, successCount: 0, errorCount: 0, skippedCount: 0 };
  try {
    const materials = (await pool.query(`SELECT id,code,COALESCE(name_zh,name_en,code) AS name,uom,material_type,status FROM materials WHERE COALESCE(code,'') <> '' ORDER BY id`)).rows;
    const lots = (await pool.query(`SELECT ml.id,ml.lot_no,ml.received_qty,ml.reserved_qty,ml.received_at,ml.expiry_date,ml.iqc_status,ml.lot_status,m.code AS material_code,m.uom FROM material_lots ml JOIN materials m ON m.id=ml.material_id WHERE COALESCE(ml.lot_no,'') <> '' ORDER BY ml.id`)).rows;
    const materialRows = materials.map((row) => ({
      code: row.code,
      name: row.name,
      category: row.material_type ?? "RAW",
      material_type_code: row.material_type ?? "RAW",
      unit_of_measure: row.uom ?? "pcs",
      tracking_type: "batch",
      external_code: String(row.id),
      external_system: "ruijing-smt-mes",
      is_active: String(row.status ?? "active").toLowerCase() !== "inactive",
    }));
    const lotRows = lots.map((row) => ({
      material_code: row.material_code,
      lot_number: row.lot_no,
      quantity_available: Math.max(0, Number(row.received_qty ?? 0) - Number(row.reserved_qty ?? 0)),
      quantity_received: Number(row.received_qty ?? 0),
      unit_of_measure: row.uom ?? "pcs",
      status: String(row.iqc_status).toLowerCase() === "released" ? "released" : "quarantine",
      received_at: row.received_at,
      expiry_date: row.expiry_date,
      supplier_reference: `ruijing-material-lot:${row.id}`,
    }));
    if (!dryRun) {
      for (let i = 0; i < materialRows.length; i += batchSize) {
        const rows = materialRows.slice(i, i + batchSize);
        await openMesRequest("POST", "/api/v1/erp/materials/import", { strategy: "update_or_create", external_system: "ruijing-smt-mes", materials: rows });
        await recordObjects("MATERIAL", rows.map((payload) => ({ sourceKey: `code:${payload.code}`, payload })));
        counts.requestCount += rows.length;
      }
      for (let i = 0; i < lotRows.length; i += batchSize) {
        const rows = lotRows.slice(i, i + batchSize);
        await openMesRequest("POST", "/api/v1/erp/material-lots/import", { strategy: "update_or_create", warehouse_code: process.env.OPENMES_DEFAULT_WAREHOUSE ?? "RAW-INCOMING", lots: rows });
        await recordObjects("MATERIAL_LOT", rows.map((payload) => ({ sourceKey: `lot:${payload.supplier_reference}`, payload })));
        counts.requestCount += rows.length;
      }
    }
    counts.successCount = materialRows.length + lotRows.length;
    await finishRun(runId, "SUCCESS", counts);
    return { runId, dryRun, materials: materialRows.length, lots: lotRows.length, ...counts };
  } catch (error) {
    counts.errorCount += 1;
    await finishRun(runId, "ERROR", counts, error.message);
    throw error;
  }
}

async function syncWorkOrders({ dryRun = false } = {}) {
  const runId = await createRun("WORK_ORDERS");
  const counts = { requestCount: 0, successCount: 0, errorCount: 0 };
  try {
    const rows = (await pool.query(`SELECT wo.id,wo.code,wo.planned_qty,wo.due_date,wo.status,wo.priority,p.code AS product_code,COALESCE(pl.internal_code,'SMT') AS line_code FROM work_orders wo JOIN products p ON p.id=wo.product_id LEFT JOIN production_lines pl ON pl.id=wo.line_id WHERE COALESCE(wo.code,'') <> '' ORDER BY wo.id`)).rows;
    const orders = rows.map((row) => ({ order_no: row.code, line_code: row.line_code, product_type_code: row.product_code, planned_qty: Number(row.planned_qty ?? 0), due_date: row.due_date, customer_order_no: `ruijing-wo:${row.id}`, priority: Number(row.priority ?? 0) }));
    if (!dryRun && orders.length) {
      for (let i = 0; i < orders.length; i += batchSize) {
        const batch = orders.slice(i, i + batchSize);
        await openMesRequest("POST", "/api/v1/erp/work-orders/import", { strategy: "update_or_create", orders: batch });
        await recordObjects("WORK_ORDER", batch.map((payload) => ({ sourceKey: `order:${payload.order_no}`, payload })));
        counts.requestCount += batch.length;
      }
    }
    counts.successCount = orders.length;
    await finishRun(runId, "SUCCESS", counts);
    return { runId, dryRun, workOrders: orders.length, ...counts };
  } catch (error) {
    counts.errorCount += 1;
    await finishRun(runId, "ERROR", counts, error.message);
    throw error;
  }
}

app.get("/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true, service: "openmes-adapter", openMesBase }); }
  catch (error) { res.status(503).json({ ok: false, error: error.message }); }
});
app.get("/status", async (_req, res) => {
  const runs = await pool.query("SELECT * FROM openmes_sync_runs ORDER BY id DESC LIMIT 20");
  const objects = await pool.query("SELECT entity_type,status,COUNT(*)::int AS count FROM openmes_sync_objects GROUP BY entity_type,status ORDER BY entity_type,status");
  res.json({ ok: true, configured: Boolean(openMesKey), openMesBase, runs: runs.rows, objects: objects.rows });
});
app.post("/sync/master-data", async (req, res) => { try { res.json({ ok: true, data: await syncMasterData({ dryRun: req.body?.dryRun === true }) }); } catch (error) { res.status(502).json({ ok: false, error: error.message }); } });
app.post("/sync/work-orders", async (req, res) => { try { res.json({ ok: true, data: await syncWorkOrders({ dryRun: req.body?.dryRun === true }) }); } catch (error) { res.status(502).json({ ok: false, error: error.message }); } });
app.post("/sync/all", async (req, res) => { try { const dryRun = req.body?.dryRun === true; res.json({ ok: true, data: { masterData: await syncMasterData({ dryRun }), workOrders: await syncWorkOrders({ dryRun }) } }); } catch (error) { res.status(502).json({ ok: false, error: error.message }); } });
app.post("/sync/inbound", async (req, res) => {
  const run = await createRun("INBOUND_EVENTS");
  const counts = { requestCount: 0, successCount: 0, errorCount: 0 };
  try {
    const since = req.body?.since ? `?since=${encodeURIComponent(req.body.since)}` : "";
    for (const [eventType, endpoint] of [["PRODUCTION_COMPLETION", "/api/v1/erp/production/completions"], ["QUALITY_ISSUE", "/api/v1/erp/quality/issues"]]) {
      const response = await openMesRequest("GET", endpoint + since);
      const events = Array.isArray(response?.data) ? response.data : [];
      for (const event of events) {
        const sourceKey = String(event.id ?? event.external_id ?? event.order_no ?? hashPayload(event));
        await pool.query("INSERT INTO openmes_inbound_events(event_type,source_key,payload) VALUES($1,$2,$3) ON CONFLICT(event_type,source_key) DO NOTHING", [eventType, sourceKey, event]);
        counts.requestCount += 1;
        counts.successCount += 1;
      }
    }
    await finishRun(run, "SUCCESS", counts);
    res.json({ ok: true, data: { runId: run, ...counts } });
  } catch (error) {
    counts.errorCount = 1;
    await finishRun(run, "ERROR", counts, error.message);
    res.status(502).json({ ok: false, error: error.message });
  }
});

app.listen(port, () => console.log(`[OpenMES adapter] listening on http://127.0.0.1:${port}`));
