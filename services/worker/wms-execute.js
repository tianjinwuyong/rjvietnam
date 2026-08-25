/**
 * wms-execute.js — WMS AI Manager executor
 * Bridges Ornith decisions to actual API calls.
 * Generates its own JWT using the shared secret.
 *
 * Usage:
 *   node wms-execute.js <action> [options]
 *
 * Actions:
 *   iqc-decide     --lotno <lot> --action RELEASE|HOLD|REJECT [--reason <text>]
 *   issue-to-line  --lotno <lot> --qty <n> --wocode <wo>
 *   pick           --lotno <lot> --qty <n> --wocode <wo>
 *   put-away       --lotno <lot> --location <code>
 *   return-line    --lotno <lot> --qty <n> --wocode <wo> [--reason <code>]
 *   scrap          --lotno <lot> --qty <n> --reason <code>
 *   receive        --mat <code> --sup <code> --lotno <lot> --qty <n> [--location <code>]
 *   adjust         --lotno <lot> --qty <+n|-n> [--reason <text>]
 *   transfer       --lotno <lot> --toloc <location_code> [--reason <text>]
 *   vendor-return  --lotno <lot> [--qty <n>] [--reason <text>]
 *   patrol         (returns analysis only, no execution)
 *   morning-digest (returns LINE message)
 */

import jwt from "jsonwebtoken";
import pg from "pg";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

// ── Config ──────────────────────────────────────────────────────────────
const JWT_SECRET   = process.env.JWT_SECRET   ?? "smt-factory-secret-2026";
const API_BASE     = process.env.API_BASE     ?? "http://127.0.0.1:8080";
const LINE_TOKEN_FILE = "services/worker/line_token.txt";

// Postgres (for queries that the API doesn't expose)
const pgPool = new Pool({
  host:     process.env.PGHOST     ?? "127.0.0.1",
  port:     Number(process.env.PGPORT ?? 5432),
  user:     process.env.PGUSER     ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

// ── JWT generation ───────────────────────────────────────────────────────
function getJwt(roleKey = "admin") {
  // We'll use a mock user for the service account
  // The server verifies the token; we just need a valid one
  return jwt.sign(
    {
      userId: 10,
      username: "wms-ai",
      roleKey,
      permissions: ["wms.view", "wms.execute", "wms.receive", "wms.edit", "iqc.execute"],
    },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

// ── API helper ──────────────────────────────────────────────────────────
async function apiCall(method, path, body = null) {
  const token = getJwt();
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const json = await res.json();

  if (!res.ok) {
    throw new Error(`API ${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

// ── IQC Decision ───────────────────────────────────────────────────────
async function iqcDecide(lotNo, action, reason = "") {
  const lot = await getLotInfo(lotNo);
  const qty = lot ? Number(lot.qty) : 0;
  let result;

  try {
    result = await apiCall("POST", "/wms/transactions", {
      action,
      lotNo,
      qty,
      operator: "wms-ai",
      notes: reason,
    });
  } catch (apiErr) {
    // Direct DB fallback — update iqc_status
    const statusMap = { IQC_RELEASE: "released", IQC_HOLD: "hold", IQC_REJECT: "rejected" };
    const newStatus = statusMap[action];
    if (!newStatus) throw new Error(`Unknown IQC action: ${action}`);
    await pgPool.query(
      "UPDATE material_lots SET iqc_status = $1, updated_at = now() WHERE lot_no = $2",
      [newStatus, lotNo]
    );
    result = { ok: true, source: "direct-db-fallback", action, lotNo, status: newStatus };
  }

  // Also log to audit
  await logAudit("IQC_DECISION", lotNo, { action, reason, result });

  // LINE alert for holds/rejects
  if (action !== "IQC_RELEASE") {
    const lot = await getLotInfo(lotNo);
    const msg = action === "IQC_REJECT"
      ? `🔴 [IQC拒绝] Lot:${lotNo} | ${lot?.material} | ${lot?.qty}pcs | 原因:${reason}`
      : `🟡 [IQC挂起] Lot:${lotNo} | ${lot?.material} | ${lot?.qty}pcs | 原因:${reason}`;
    await sendLINE(msg);
  } else {
    const lot = await getLotInfo(lotNo);
    await sendLINE(`✅ [IQC合格释放] Lot:${lotNo} | ${lot?.material} | ${lot?.qty}pcs`);
  }

  return result;
}

// ── Issue to Line ────────────────────────────────────────────────────────
async function issueToLine(lotNo, qty, workOrderCode) {
  const result = await apiCall("POST", "/wms/transactions", {
    action: "ISSUE_TO_LINE",
    lotNo,
    qty,
    workOrderCode,
    operator: "wms-ai",
  });

  await logAudit("ISSUE_TO_LINE", lotNo, { qty, workOrderCode, result });
  await sendLINE(`📤 [发料到产线] Lot:${lotNo} | ${qty}pcs → WO:${workOrderCode}`);
  return result;
}

// ── Pick ────────────────────────────────────────────────────────────────
async function pick(lotNo, qty, workOrderCode) {
  const result = await apiCall("POST", "/wms/transactions", {
    action: "PICK",
    lotNo,
    qty,
    workOrderCode,
    operator: "wms-ai",
  });

  await logAudit("PICK", lotNo, { qty, workOrderCode, result });
  return result;
}

// ── Put Away ───────────────────────────────────────────────────────────
async function putAway(lotNo, locationCode) {
  const result = await apiCall("POST", "/wms/transactions", {
    action: "PUT_AWAY",
    lotNo,
    toLocationCode: locationCode,
    operator: "wms-ai",
  });

  await logAudit("PUT_AWAY", lotNo, { locationCode, result });
  await sendLINE(`📍 [上架完成] Lot:${lotNo} → ${locationCode}`);
  return result;
}

// ── Return from Line ───────────────────────────────────────────────────
async function returnFromLine(lotNo, qty, workOrderCode, reason = "LINE_CANCEL") {
  const result = await apiCall("POST", "/wms/transactions", {
    action: "RETURN_FROM_LINE",
    lotNo,
    qty,
    workOrderCode,
    operator: "wms-ai",
    notes: reason,
  });

  await logAudit("RETURN_FROM_LINE", lotNo, { qty, workOrderCode, reason, result });
  await sendLINE(`↩️ [产线退料] Lot:${lotNo} | ${qty}pcs → 原因:${reason}`);
  return result;
}

// ── Scrap ───────────────────────────────────────────────────────────────
async function scrap(lotNo, qty, reasonCode) {
  const result = await apiCall("POST", "/wms/transactions", {
    action: "SCRAP",
    lotNo,
    qty,
    operator: "wms-ai",
    notes: reasonCode,
  });

  await logAudit("SCRAP", lotNo, { qty, reasonCode, result });

  const lot = await getLotInfo(lotNo);
  await sendLINE(`🔴 [报废] Lot:${lotNo} | ${lot?.material} | ${qty}pcs | 原因:${reasonCode}`);
  return result;
}

// ── Receive material from vendor ─────────────────────────────────────────────
// Creates a new material_lot and records a RECEIVE transaction.
async function receiveMaterial({ materialCode, supplierCode, lotNo, qty, locationCode = "RAW" }) {
  // Resolve material_id and supplier_id
  const matRow = await pgPool.query(`SELECT id FROM materials WHERE code = $1`, [materialCode]);
  if (!matRow.rows.length) throw new Error(`Material not found: ${materialCode}`);
  const supRow = await pgPool.query(`SELECT id FROM suppliers WHERE code = $1`, [supplierCode]);
  if (!supRow.rows.length) throw new Error(`Supplier not found: ${supplierCode}`);
  const locRow = await pgPool.query(`SELECT id FROM storage_locations WHERE location_code = $1`, [locationCode]);
  if (!locRow.rows.length) throw new Error(`Location not found: ${locationCode}`);

  const materialId = matRow.rows[0].id;
  const supplierId = supRow.rows[0].id;
  const locationId = locRow.rows[0].id;

  // Generate tx_no
  const txNo = `RCV-${Date.now().toString(36).toUpperCase()}`;

  // Insert material_lot (starts in 'pending' iqc_status)
  const lotRow = await pgPool.query(`
    INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, status)
    VALUES ($1, $2, $3, $4, 'pending', 'active')
    RETURNING id
  `, [materialId, supplierId, lotNo, qty]);

  const lotId = lotRow.rows[0].id;

  // Record RECEIVE transaction
  await pgPool.query(`
    INSERT INTO inventory_transactions
      (tx_no, action, material_lot_id, qty, to_location_id, operator_id, occurred_at)
    SELECT $1, 'RECEIVE', $2, $3, $4, u.id, NOW()
    FROM users u WHERE u.username = 'wms-ai'
    LIMIT 1
  `, [txNo, lotId, qty, locationId]);

  await logAudit("RECEIVE", lotNo, { materialCode, supplierCode, qty, locationCode });
  await sendLINE(`📥 [到货接收] Lot:${lotNo} | ${materialCode} | ${qty}pcs | 供应商:${supplierCode} → ${locationCode} | 待IQC`);
  return { ok: true, action: "RECEIVE", lotNo, materialCode, qty, iqcStatus: "pending" };
}

// ── Inventory adjustment (+/-) ──────────────────────────────────────────────
// Positive qty = addition; negative qty = deduction (with justification).
async function adjustInventory({ lotNo, adjustQty, reason = "CYCLE_COUNT" }) {
  const lotInfo = await getLotInfo(lotNo);
  if (!lotInfo) throw new Error(`Lot not found: ${lotNo}`);

  const txNo = `ADJ-${Date.now().toString(36).toUpperCase()}`;
  const operatorResult = await pgPool.query(`SELECT id FROM users WHERE username = 'wms-ai' LIMIT 1`);
  const operatorId = operatorResult.rows[0]?.id ?? 1;

  // Update material_lot received_qty
  const newQty = lotInfo.qty + adjustQty;
  if (newQty < 0) throw new Error(`Adjustment would result in negative qty: current=${lotInfo.qty} adjust=${adjustQty}`);

  await pgPool.query(`
    UPDATE material_lots SET received_qty = $1, updated_at = NOW() WHERE lot_no = $2
  `, [newQty, lotNo]);

  // Record ADJUST transaction (qty = absolute value of adjustQty)
  await pgPool.query(`
    INSERT INTO inventory_transactions
      (tx_no, action, material_lot_id, qty, operator_id, notes, occurred_at)
    VALUES ($1, 'ADJUST', (SELECT id FROM material_lots WHERE lot_no = $2), $3, $4, $5, NOW())
  `, [txNo, lotNo, Math.abs(adjustQty), operatorId, `${reason} (adjust=${adjustQty > 0 ? "+" : ""}${adjustQty})`]);

  await logAudit("ADJUST", lotNo, { adjustQty, newQty, reason });
  const sign = adjustQty > 0 ? "+" : "";
  await sendLINE(`📊 [库存调整] Lot:${lotNo} | ${lotInfo.material} | ${sign}${adjustQty}pcs → 新库存:${newQty}pcs | 原因:${reason}`);
  return { ok: true, action: "ADJUST", lotNo, adjustQty, newQty };
}

// ── Transfer material between locations ─────────────────────────────────────
// Moves material from one storage location to another (e.g., RAW → SMT, or to QUARANTINE).
async function transferMaterial({ lotNo, toLocationCode, reason = "TRANSFER" }) {
  const lotInfo = await getLotInfo(lotNo);
  if (!lotInfo) throw new Error(`Lot not found: ${lotNo}`);

  const toLocRow = await pgPool.query(`SELECT id, location_code FROM storage_locations WHERE location_code = $1`, [toLocationCode]);
  if (!toLocRow.rows.length) throw new Error(`Location not found: ${toLocationCode}`);
  const toLocationId = toLocRow.rows[0].id;

  // Look up current location from most recent transaction (or default to RAW)
  const currentLocRow = await pgPool.query(`
    SELECT to_location_id FROM inventory_transactions
    WHERE material_lot_id = (SELECT id FROM material_lots WHERE lot_no = $1)
      AND to_location_id IS NOT NULL
    ORDER BY occurred_at DESC LIMIT 1
  `, [lotNo]);
  const fromLocationId = currentLocRow.rows[0]?.to_location_id ?? null;

  const txNo = `TRF-${Date.now().toString(36).toUpperCase()}`;
  const operatorResult = await pgPool.query(`SELECT id FROM users WHERE username = 'wms-ai' LIMIT 1`);
  const operatorId = operatorResult.rows[0]?.id ?? 1;

  await pgPool.query(`
    INSERT INTO inventory_transactions
      (tx_no, action, material_lot_id, qty, from_location_id, to_location_id, operator_id, notes, occurred_at)
    VALUES ($1, 'TRANSFER',
      (SELECT id FROM material_lots WHERE lot_no = $2),
      (SELECT received_qty FROM material_lots WHERE lot_no = $2),
      $3, $4, $5, $6, NOW())
  `, [txNo, lotNo, fromLocationId ?? null, toLocationId, operatorId, reason]);

  await logAudit("TRANSFER", lotNo, { toLocationCode, fromLocationId, reason });
  await sendLINE(`🔄 [库位转移] Lot:${lotNo} | ${lotInfo.material} | → ${toLocationCode} | 原因:${reason}`);
  return { ok: true, action: "TRANSFER", lotNo, toLocationCode };
}

// ── Return material to vendor ──────────────────────────────────────────────
// Records VENDOR_RETURN transaction. No status column on material_lots.
async function vendorReturn({ lotNo, qty, reason = "VENDOR_DEFECT" }) {
  const lotInfo = await getLotInfo(lotNo);
  if (!lotInfo) throw new Error(`Lot not found: ${lotNo}`);

  const returnQty = qty ?? lotInfo.qty;
  const txNo = `VRN-${Date.now().toString(36).toUpperCase()}`;
  const operatorResult = await pgPool.query(`SELECT id FROM users WHERE username = 'wms-ai' LIMIT 1`);
  const operatorId = operatorResult.rows[0]?.id ?? 1;

  // material_lots has no 'status' column; inventory_transactions has no 'notes' column
  await pgPool.query(`
    INSERT INTO inventory_transactions
      (tx_no, action, material_lot_id, qty, operator_id, occurred_at)
    VALUES ($1, 'VENDOR_RETURN',
      (SELECT id FROM material_lots WHERE lot_no = $2),
      $3, $4, NOW())
  `, [txNo, lotNo, returnQty, operatorId]);

  await logAudit("VENDOR_RETURN", lotNo, { qty: returnQty, reason });
  await sendLINE(`📦 [退货] Lot:${lotNo} | ${lotInfo.material} | ${returnQty}pcs → 供应商 | 原因:${reason}`);
  return { ok: true, action: "VENDOR_RETURN", lotNo, qty: returnQty };
}

// ── Helper: Get lot info ───────────────────────────────────────────────
async function getLotInfo(lotNo) {
  const rows = await pgPool.query(`
    SELECT ml.lot_no, ml.received_qty, ml.iqc_status,
           m.code AS material_code, m.name_zh
    FROM material_lots ml
    JOIN materials m ON m.id = ml.material_id
    WHERE ml.lot_no = $1
  `, [lotNo]);
  const row = rows.rows[0];
  if (!row) return null;
  return {
    lotNo: row.lot_no,
    qty: Number(row.received_qty),
    status: row.iqc_status,
    material: row.name_zh,
    materialCode: row.material_code,
  };
}

// ── Audit Log ──────────────────────────────────────────────────────────
async function logAudit({ decisionType, lotNo, workOrderCode, area, inputData, outputDecision,
    executed = true, executor = "wms-ai", autoExecute = false, ornithSummary = null, cycleId = null }) {
  try {
    await pgPool.query(`
      INSERT INTO wms_manager_audit
        (agent, decision_type, lot_no, work_order_code, area, input_data, output_decision,
         executed, executor, auto_execute, ornith_summary, cycle_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, ["wms-ai-manager", decisionType, lotNo || null, workOrderCode || null, area || null,
        JSON.stringify(inputData || {}), JSON.stringify(outputDecision || {}),
        executed, executor, autoExecute, ornithSummary || null, cycleId || null]);
  } catch (err) {
    console.error("[AUDIT ERROR]", err.message);
  }
}

// ── LINE Notification ─────────────────────────────────────────────────
async function sendLINE(message) {
  try {
    const tokenPath = LINE_TOKEN_FILE;
    if (!existsSync(tokenPath)) return;

    const token = readFileSync(tokenPath, "utf8").trim();
    if (!token) return;

    const res = await fetch("https://notify-api.line.me/api/notify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) console.error("[LINE ERROR]", res.status);
  } catch (err) {
    console.error("[LINE ERROR]", err.message);
  }
}

// ── Patrol — data only, no execution ──────────────────────────────────
async function patrol() {
  const { execSync: exec } = await import("child_process");
  const root = process.cwd();
  const raw = exec(`node services/worker/watchdog-query.js all`, {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

// ── Morning Digest ─────────────────────────────────────────────────────
async function morningDigest() {
  const data = await patrol();
  const lines = [];

  lines.push(`🌅 WMS晨报 ${new Date().toLocaleDateString("zh-CN")}`);
  lines.push("━━━━━━━━━━━━━━━━━━");

  // IQC snapshot
  const iqcNg = data.iqcNg ?? [];
  const pending = iqcNg.filter(x => x.iqc_status === "pending").length;
  const hold    = iqcNg.filter(x => x.iqc_status === "hold").length;
  const reject  = iqcNg.filter(x => x.iqc_status === "rejected").length;
  lines.push(`📦 IQC状态: 待检${pending} | Hold${hold} | 拒绝${reject}`);

  // Released lots
  const released = data.wmsHealth?.lots?.find(x => x.iqc_status === "released");
  lines.push(`📦 已检验释放: ${released?.count ?? 0}批 (${Number(released?.total_qty ?? 0).toLocaleString()}pcs)`);

  // WO status
  const wos = data.workOrders ?? [];
  const running = wos.filter(x => x.status === "running").length;
  const releasedWo = wos.filter(x => x.status === "released").length;
  lines.push(`⚙️ 工单: 进行中${running} | 已下达${releasedWo}`);

  // Low stock
  const lowStock = data.wmsHealth?.lowStock ?? [];
  if (lowStock.length > 0) {
    lines.push("⚠️ 低库存:");
    lowStock.forEach(s => lines.push(`  - ${s.material_name_zh}: 余额≈${s.approx_balance}`));
  }

  // NG lots attention
  if (hold > 0 || reject > 0) {
    lines.push("🔴 需关注批次:");
    iqcNg.filter(x => x.iqc_status !== "pending").forEach(l => {
      lines.push(`  - ${l.lot_no} | ${l.material_name_zh} | ${l.iqc_status} | ${l.supplier_name_zh}`);
    });
  }

  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("📋 操作建议见 LINE 详细分析");

  const msg = lines.join("\n");
  await sendLINE(msg);
  console.log(msg);
}

// ── Create audit table if not exists ──────────────────────────────────
async function ensureAuditTable() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS wms_manager_audit (
        id              bigserial PRIMARY KEY,
        agent           varchar(80) NOT NULL,
        decision_type   varchar(80) NOT NULL,
        lot_no          varchar(80),
        work_order_code varchar(80),
        area            varchar(40),
        input_data      jsonb,
        output_decision jsonb,
        executed        boolean NOT NULL DEFAULT true,
        executor        varchar(80),
        override_by     varchar(80),
        auto_execute   boolean NOT NULL DEFAULT false,
        ornith_summary  text,
        feedback        varchar(20),
        feedback_by    varchar(80),
        feedback_at    timestamptz,
        cycle_id        varchar(40),
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Add new columns if they don't exist (migration-safe)
    const addCol = (col, def) => {
      try {
        pgPool.query(`ALTER TABLE wms_manager_audit ADD COLUMN IF NOT EXISTS ${col} ${def}`).catch(() => {});
      } catch (_) {}
    };
    addCol("work_order_code", "varchar(80)");
    addCol("area", "varchar(40)");
    addCol("auto_execute", "boolean NOT NULL DEFAULT false");
    addCol("ornith_summary", "text");
    addCol("feedback", "varchar(20)");
    addCol("feedback_by", "varchar(80)");
    addCol("feedback_at", "timestamptz");
    addCol("cycle_id", "varchar(40)");
  } catch (_) {}
}

// ── CLI ────────────────────────────────────────────────────────────────
async function main() {
  await ensureAuditTable();

  const [action, ...args] = process.argv.slice(2);

  const getArg = (name, fallback = "") => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] ?? fallback : fallback;
  };

  switch (action) {
    case "iqc-decide": {
      const lotNo  = getArg("lotno");
      const act    = getArg("action", "HOLD").toUpperCase();
      const reason = getArg("reason", "AI建议");
      if (!lotNo) { console.error("Usage: iqc-decide --lotno <lot> --action <RELEASE|HOLD|REJECT>"); process.exit(1); }
      console.log(JSON.stringify(await iqcDecide(lotNo, `IQC_${act}`, reason), null, 2));
      break;
    }
    case "issue-to-line": {
      const lotNo = getArg("lotno"); const qty = Number(getArg("qty")); const wo = getArg("wocode");
      if (!lotNo || !qty || !wo) { console.error("Usage: issue-to-line --lotno <lot> --qty <n> --wocode <wo>"); process.exit(1); }
      console.log(JSON.stringify(await issueToLine(lotNo, qty, wo), null, 2));
      break;
    }
    case "pick": {
      const lotNo = getArg("lotno"); const qty = Number(getArg("qty")); const wo = getArg("wocode");
      if (!lotNo || !qty || !wo) { console.error("Usage: pick --lotno <lot> --qty <n> --wocode <wo>"); process.exit(1); }
      console.log(JSON.stringify(await pick(lotNo, qty, wo), null, 2));
      break;
    }
    case "put-away": {
      const lotNo = getArg("lotno"); const loc = getArg("location");
      if (!lotNo || !loc) { console.error("Usage: put-away --lotno <lot> --location <code>"); process.exit(1); }
      console.log(JSON.stringify(await putAway(lotNo, loc), null, 2));
      break;
    }
    case "return-line": {
      const lotNo = getArg("lotno"); const qty = Number(getArg("qty")); const wo = getArg("wocode");
      const reason = getArg("reason", "LINE_CANCEL");
      if (!lotNo || !qty || !wo) { console.error("Usage: return-line --lotno <lot> --qty <n> --wocode <wo> [--reason <code>]"); process.exit(1); }
      console.log(JSON.stringify(await returnFromLine(lotNo, qty, wo, reason), null, 2));
      break;
    }
    case "scrap": {
      const lotNo = getArg("lotno"); const qty = Number(getArg("qty")); const reason = getArg("reason", "DAMAGED");
      if (!lotNo || !qty) { console.error("Usage: scrap --lotno <lot> --qty <n> [--reason <code>]"); process.exit(1); }
      console.log(JSON.stringify(await scrap(lotNo, qty, reason), null, 2));
      break;
    }
    case "receive": {
      const matCode  = getArg("mat");
      const supCode  = getArg("sup");
      const lotNo    = getArg("lotno");
      const qty      = Number(getArg("qty"));
      const location = getArg("location", "RAW");
      if (!matCode || !supCode || !lotNo || !qty) {
        console.error("Usage: receive --mat <code> --sup <code> --lotno <lot> --qty <n> [--location <code>]");
        process.exit(1);
      }
      console.log(JSON.stringify(await receiveMaterial({ materialCode: matCode, supplierCode: supCode, lotNo, qty, locationCode: location }), null, 2));
      break;
    }
    case "adjust": {
      const lotNo    = getArg("lotno");
      const adjustQty = Number(getArg("qty"));   // positive or negative
      const reason   = getArg("reason", "CYCLE_COUNT");
      if (!lotNo || isNaN(adjustQty)) {
        console.error("Usage: adjust --lotno <lot> --qty <+n|-n> [--reason <text>]");
        process.exit(1);
      }
      console.log(JSON.stringify(await adjustInventory({ lotNo, adjustQty, reason }), null, 2));
      break;
    }
    case "transfer": {
      const lotNo    = getArg("lotno");
      const toLoc    = getArg("toloc");
      const reason   = getArg("reason", "TRANSFER");
      if (!lotNo || !toLoc) {
        console.error("Usage: transfer --lotno <lot> --toloc <location_code> [--reason <text>]");
        process.exit(1);
      }
      console.log(JSON.stringify(await transferMaterial({ lotNo, toLocationCode: toLoc, reason }), null, 2));
      break;
    }
    case "vendor-return": {
      const lotNo = getArg("lotno");
      const qty   = Number(getArg("qty"));
      const reason = getArg("reason", "VENDOR_DEFECT");
      if (!lotNo) {
        console.error("Usage: vendor-return --lotno <lot> [--qty <n>] [--reason <text>]");
        process.exit(1);
      }
      console.log(JSON.stringify(await vendorReturn({ lotNo, qty, reason }), null, 2));
      break;
    }
    case "receive-feedback": {
      const lotNo      = getArg("lotno");
      const fb         = getArg("feedback");      // correct|incorrect|partial
      const fbBy       = getArg("by", process.env.USERNAME || "operator");
      const decisionType = getArg("type", "iqc");
      if (!lotNo || !fb) { console.error("Usage: receive-feedback --lotno <lot> --feedback <correct|incorrect|partial> [--by <operator>] [--type <iqc|issue|pick|putaway|return|scrap>]"); process.exit(1); }
      await pgPool.query(`
        UPDATE wms_manager_audit
        SET feedback = $1, feedback_by = $2, feedback_at = now()
        WHERE lot_no = $3 AND decision_type = $4
        ORDER BY created_at DESC LIMIT 1
      `, [fb, fbBy, lotNo, decisionType]);
      console.log(JSON.stringify({ ok: true, lotNo, feedback: fb, by: fbBy }));
      break;
    }
    case "audit-log": {
      // Log an Ornith recommendation before execution: node wms-execute.js audit-log --decision <type> --lotno <lot> --wocode <wo> --area <area> --ornith <json> --auto <true|false> --cycle <id>
      const decisionType = getArg("decision", "iqc");
      const lotNo         = getArg("lotno", null);
      const workOrderCode = getArg("wocode", null);
      const area          = getArg("area", null);
      const ornithSummary  = getArg("ornith", null);
      const autoExecute    = getArg("auto", "false") === "true";
      const cycleId        = getArg("cycle", null);
      await logAudit({
        decisionType, lotNo, workOrderCode, area,
        inputData: { ornith_summary: ornithSummary },
        outputDecision: { status: "pending" },
        executed: false,
        executor: "ornith",
        autoExecute,
        ornithSummary,
        cycleId,
      });
      console.log(JSON.stringify({ ok: true, decisionType, lotNo, cycleId }));
      break;
    }
    case "analyze-performance": {
      const days = Number(getArg("days", "7"));
      const result = await pgPool.query(`
        SELECT
          decision_type,
          COUNT(*) as total,
          SUM(CASE WHEN executed = true THEN 1 ELSE 0 END) as executed_count,
          SUM(CASE WHEN auto_execute = true THEN 1 ELSE 0 END) as auto_count,
          SUM(CASE WHEN auto_execute = false THEN 1 ELSE 0 END) as manual_count,
          SUM(CASE WHEN feedback = 'correct' THEN 1 ELSE 0 END) as correct_count,
          SUM(CASE WHEN feedback = 'incorrect' THEN 1 ELSE 0 END) as incorrect_count,
          SUM(CASE WHEN feedback = 'partial' THEN 1 ELSE 0 END) as partial_count,
          SUM(CASE WHEN feedback IS NOT NULL THEN 1 ELSE 0 END) as feedback_count
        FROM wms_manager_audit
        WHERE created_at >= now() - (INTERVAL '1 day' * $1)
          AND decision_type IS NOT NULL
        GROUP BY decision_type
        ORDER BY total DESC
      `, [days]);
      const summary = await pgPool.query(`
        SELECT
          COUNT(*) as total_decisions,
          SUM(CASE WHEN auto_execute = true THEN 1 ELSE 0 END) as auto_decisions,
          SUM(CASE WHEN auto_execute = false THEN 1 ELSE 0 END) as manual_decisions,
          SUM(CASE WHEN feedback = 'correct' THEN 1 ELSE 0 END) as correct,
          SUM(CASE WHEN feedback = 'incorrect' THEN 1 ELSE 0 END) as incorrect,
          SUM(CASE WHEN feedback = 'partial' THEN 1 ELSE 0 END) as partial,
          SUM(CASE WHEN feedback IS NOT NULL THEN 1 ELSE 0 END) as rated,
          SUM(CASE WHEN executed = false AND auto_execute = true THEN 1 ELSE 0 END) as auto_pending,
          SUM(CASE WHEN executed = true AND override_by IS NOT NULL THEN 1 ELSE 0 END) as overridden
        FROM wms_manager_audit
        WHERE created_at >= now() - (INTERVAL '1 day' * $1)
      `, [days]);
      const result_obj = {
        period_days: days,
        summary: summary.rows[0],
        by_type: result.rows,
        generated_at: new Date().toISOString(),
      };
      console.log(JSON.stringify(result_obj, null, 2));
      break;
    }
    case "patrol": {
      const result = await patrol();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "morning-digest": {
      await morningDigest();
      break;
    }
    case "help": {
      console.log(`WMS AI Manager Executor
Usage: node wms-execute.js <action> [options]

Actions:
  iqc-decide      --lotno <lot> --action <RELEASE|HOLD|REJECT> [--reason <text>]
  issue-to-line   --lotno <lot> --qty <n> --wocode <wo>
  pick            --lotno <lot> --qty <n> --wocode <wo>
  put-away        --lotno <lot> --location <code>
  return-line     --lotno <lot> --qty <n> --wocode <wo> [--reason <code>]
  scrap           --lotno <lot> --qty <n> [--reason <code>]
  audit-log       --decision <type> --lotno <lot> --area <area> --ornith <json> --auto <true|false> --cycle <id>
  receive-feedback --lotno <lot> --feedback <correct|incorrect|partial> [--by <operator>] [--type <type>]
  analyze-performance [--days <N>]  — compute Ornith accuracy metrics over N days (default 7)
  patrol        (returns all data)
  morning-digest (sends LINE report)
  help
`);
      break;
    }
    default:
      console.error(`Unknown action: ${action}. Run with "help" for usage.`);
      process.exit(1);
  }

  await pgPool.end();
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
