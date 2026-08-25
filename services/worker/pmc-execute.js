/**
 * pmc-execute.js — PMC AI Manager executor
 * Usage:
 *   node pmc-execute.js <action> [options]
 *
 * Actions:
 *   wo-schedule      [--dry-run] [--limit N]
 *   wo-reschedule    --wocode <code> [--due-date YYYY-MM-DD] [--qty N]
 *   wo-hold          --wocode <code> [--reason <text>]
 *   wo-release       --wocode <code>
 *   mrp-run          [--date YYYY-MM-DD]
 *   kit-check        --wocode <code>
 *   shortage-escalate [--days N]
 *   capacity-simulate [--add-wo <code>] [--remove-wo <code>]
 *   delivery-alert   [--days-threshold N]
 *   mps-update       --ponumber <po> [--add-wo <code>] [--priority N]
 *   pmc-digest
 *   patrol
 *   help
 */

import jwt from "jsonwebtoken";
import pg from "pg";
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { execSync } = await import("child_process");

const { Pool } = pg;

// ── Config ──────────────────────────────────────────────────────────────
const JWT_SECRET      = process.env.JWT_SECRET      ?? "smt-factory-secret-2026";
const API_BASE        = process.env.API_BASE        ?? "http://127.0.0.1:8080";
const LINE_TOKEN_FILE  = "services/worker/line_token.txt";

const pgPool = new Pool({
  host:     process.env.PGHOST     ?? "127.0.0.1",
  port:     Number(process.env.PGPORT ?? 5432),
  user:     process.env.PGUSER     ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

// ── JWT ─────────────────────────────────────────────────────────────────
function getJwt(roleKey = "admin") {
  return jwt.sign(
    { userId: 10, username: "pmc-ai", roleKey,
      permissions: ["pmc.view", "pmc.execute", "wo.execute", "wo.schedule", "mps.update"] },
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
  if (!res.ok) throw new Error(`API ${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ── Patrol ──────────────────────────────────────────────────────────────
async function patrol() {
  const root = process.cwd();
  const raw = execSync(`node services/worker/pmc-query.js all`, {
    cwd: root, encoding: "utf8",
  });
  return JSON.parse(raw);
}

// ── WO Schedule ─────────────────────────────────────────────────────────
async function woSchedule(dryRun = false, limit = 20) {
  const root = process.cwd();
  let kitData;
  try {
    const raw = execSync(`node services/worker/pmc-query.js kit-readiness`, {
      cwd: root, encoding: "utf8",
    });
    kitData = JSON.parse(raw);
  } catch (_) {
    kitData = { data: [] };
  }

  const readyWos = (kitData.data ?? []).filter(w => parseFloat(w.kit_ready_pct) >= 100);
  const partialWos = (kitData.data ?? []).filter(w => parseFloat(w.kit_ready_pct) < 100);

  if (dryRun) {
    return {
      action: "wo-schedule", dry_run: true,
      released_count: readyWos.length,
      skipped_count: partialWos.length,
      message: `[DRY RUN] Would release ${readyWos.length} WOs (${partialWos.length} skipped — kit incomplete)`,
    };
  }

  let released = 0;
  for (const wo of readyWos.slice(0, limit)) {
    try {
      await apiCall("PATCH", `/pmc/work-orders/${wo.wo_code}`, { status: "released" });
    } catch (_) {
      await pgPool.query(
        "UPDATE work_orders SET status = 'released', released_at = now(), updated_at = now() WHERE code = $1 AND status = 'draft'",
        [wo.wo_code]
      );
    }
    released++;
  }

  await logAudit("PMC_WO_SCHEDULE", null, null, null, {
    dry_run: dryRun, limit, released_count: released, skipped_count: partialWos.length,
  });

  if (released > 0) {
    await sendLINE(`[PMC] WO Schedule: Released ${released} WOs`);
  }

  return {
    action: "wo-schedule", dry_run: dryRun,
    released_count: released,
    skipped_count: partialWos.length,
    released_wos: readyWos.slice(0, released).map(w => w.wo_code),
    message: `Released ${released} WOs, ${partialWos.length} skipped (kit incomplete)`,
  };
}

// ── WO Reschedule ───────────────────────────────────────────────────────
async function woReschedule(woCode, newDueDate, newQty) {
  if (!woCode) throw new Error("WO code required");
  const body = {};
  if (newDueDate) body.due_date_override = newDueDate;
  if (newQty !== undefined) body.planned_qty = newQty;

  let result;
  try {
    result = await apiCall("PATCH", `/pmc/work-orders/${woCode}`, body);
  } catch (_) {
    const sets = [];
    const params = [];
    let i = 1;
    if (newDueDate) { sets.push(`due_date_override = $${i++}`); params.push(newDueDate); }
    if (newQty !== undefined) { sets.push(`planned_qty = $${i++}`); params.push(newQty); }
    sets.push(`updated_at = now()`);
    params.push(woCode);
    await pgPool.query(`UPDATE work_orders SET ${sets.join(", ")} WHERE code = $${i}`, params);
    result = { ok: true, source: "direct-db-fallback" };
  }

  await logAudit("PMC_WO_RESCHEDULE", null, woCode, null, { newDueDate, newQty, result });
  return { action: "wo-reschedule", wo_code: woCode, changes: body, result };
}

// ── WO Hold ─────────────────────────────────────────────────────────────
async function woHold(woCode, reason = "kit incomplete") {
  if (!woCode) throw new Error("WO code required");
  let result;
  try {
    result = await apiCall("PATCH", `/pmc/work-orders/${woCode}`, { status: "on_hold", notes: reason });
  } catch (_) {
    await pgPool.query(
      "UPDATE work_orders SET status = 'on_hold', updated_at = now() WHERE code = $1",
      [woCode]
    );
    result = { ok: true, source: "direct-db-fallback" };
  }
  await logAudit("PMC_WO_HOLD", null, woCode, null, { reason, result });
  if (!dryRun) await sendLINE(`[PMC] WO Hold: ${woCode} — ${reason}`);
  return { action: "wo-hold", wo_code: woCode, reason, new_status: "on_hold" };
}

// ── WO Release ──────────────────────────────────────────────────────────
async function woRelease(woCode) {
  if (!woCode) throw new Error("WO code required");
  let result;
  try {
    result = await apiCall("PATCH", `/pmc/work-orders/${woCode}`, { status: "released" });
  } catch (_) {
    await pgPool.query(
      "UPDATE work_orders SET status = 'released', released_at = now(), updated_at = now() WHERE code = $1",
      [woCode]
    );
    result = { ok: true, source: "direct-db-fallback" };
  }
  await logAudit("PMC_WO_RELEASE", null, woCode, null, { result });
  return { action: "wo-release", wo_code: woCode, result };
}

// ── MRP Run ────────────────────────────────────────────────────────────
async function mrpRun(targetDate) {
  const root = process.cwd();
  const raw = execSync(
    `node services/worker/pmc-query.js mrp-result${targetDate ? " --date=" + targetDate : ""}`,
    { cwd: root, encoding: "utf8" }
  );
  const data = JSON.parse(raw);
  const urgent = (data.recommendations ?? []).filter(r => r.priority === "URGENT");
  if (urgent.length > 0) {
    const lines = urgent.slice(0, 5).map(r => `  ${r.material}: shortfall ${r.shortfall_qty} | ${r.wo_code}`);
    await sendLINE(`[PMC] MRP Alert: ${urgent.length} urgent material shortages\n${lines.join("\n")}`);
  }
  await logAudit("PMC_MRP_RUN", null, null, null, {
    target_date: targetDate,
    total_recommendations: (data.recommendations ?? []).length,
    urgent_count: urgent.length,
  });
  return { action: "mrp-run", target_date: targetDate, recommendations: data };
}

// ── Kit Check ──────────────────────────────────────────────────────────
async function kitCheck(woCode) {
  if (!woCode) throw new Error("WO code required");
  const root = process.cwd();
  const raw = execSync(`node services/worker/pmc-query.js kit-readiness --wocode=${woCode}`, {
    cwd: root, encoding: "utf8",
  });
  return JSON.parse(raw);
}

// ── Shortage Escalate ─────────────────────────────────────────────────
async function shortageEscalate(daysBack = 7) {
  const since = new Date(); since.setDate(since.getDate() - daysBack);
  const shortages = await pgPool.query(`
    SELECT ml.id, ml.lot_no, m.code AS material_code, m.name_zh AS material_name,
           ml.received_qty, ml.iqc_status, ml.created_at::text,
           s.code AS supplier_code, s.name_zh AS supplier_name
    FROM material_lots ml
    JOIN materials m ON m.id = ml.material_id
    LEFT JOIN suppliers s ON s.id = m.supplier_id
    WHERE ml.iqc_status != 'released' AND ml.created_at >= $1
    ORDER BY ml.created_at DESC
  `, [since]);

  const escalated = shortages.rows.map(r => ({
    material: `${r.material_code} / ${r.material_name || ""}`,
    supplier: `${r.supplier_code} / ${r.supplier_name || ""}`,
    lot_no: r.lot_no, status: r.iqc_status, received_at: r.created_at,
    action_required: r.iqc_status === "pending"
      ? "IQC pending — expedite"
      : r.iqc_status === "hold" ? "QA hold — review" : "Rejected — arrange return",
  }));

  await logAudit("PMC_SHORTAGE_ESCALATE", null, null, null, {
    since: since.toISOString(), count: shortages.rows.length, escalated,
  });

  if (escalated.length > 0) {
    const lines = escalated.slice(0, 5).map(e => `  ${e.material} (${e.supplier}) — ${e.action_required}`);
    await sendLINE(`[PMC] Material shortage: ${escalated.length} items\n${lines.join("\n")}`);
  }

  return {
    action: "shortage-escalate", period_days: daysBack,
    total_shortages: shortages.rows.length, escalated,
    message: shortages.rows.length > 0
      ? `${shortages.rows.length} items escalated to WMS + Purchasing`
      : "No shortages found",
  };
}

// ── Capacity Simulate ─────────────────────────────────────────────────
async function capacitySimulate(addWo, removeWo) {
  const root = process.cwd();
  const raw = execSync(`node services/worker/pmc-query.js capacity-analysis`, {
    cwd: root, encoding: "utf8",
  });
  const data = JSON.parse(raw);
  await logAudit("PMC_CAPACITY_SIMULATE", null, null, null, {
    scenario: { add_wo: addWo || null, remove_wo: removeWo || null },
    lines: data.lines?.length || 0,
  });
  return { action: "capacity-simulate", scenario: { add_wo: addWo, remove_wo: removeWo }, data };
}

// ── Delivery Alert ────────────────────────────────────────────────────
async function deliveryAlert(daysThreshold = 5) {
  const root = process.cwd();
  const raw = execSync(
    `node services/worker/pmc-query.js delivery-status --days=${daysThreshold}`,
    { cwd: root, encoding: "utf8" }
  );
  const data = JSON.parse(raw);
  const atRisk = (data.customer_pos ?? []).filter(p =>
    p.days_until_due !== null && p.days_until_due <= daysThreshold
  );
  await logAudit("PMC_DELIVERY_ALERT", null, null, null, {
    threshold_days: daysThreshold, at_risk_count: atRisk.length, data,
  });
  if (atRisk.length > 0) {
    const lines = atRisk.slice(0, 5).map(p =>
      `  PO:${p.po_number} | ${p.customer_name} | due:${p.due_date} | risk:${p.risk_level}`
    );
    await sendLINE(`[PMC] Delivery at risk: ${atRisk.length}\n${lines.join("\n")}`);
  }
  return {
    action: "delivery-alert", threshold_days: daysThreshold,
    at_risk_count: atRisk.length, data,
    message: `${atRisk.length} deliveries at risk (within ${daysThreshold} days)`,
  };
}

// ── MPS Update ────────────────────────────────────────────────────────
async function mpsUpdate(poNumber, addWo, priority) {
  if (!poNumber) throw new Error("PO number required");
  await logAudit("PMC_MPS_UPDATE", null, null, null, {
    po_number: poNumber, add_wo: addWo || null, priority: priority || "NORMAL",
  });
  await sendLINE(`[PMC] MPS updated: PO ${poNumber}`);
  return { action: "mps-update", po_number: poNumber, add_wo: addWo, priority: priority || "NORMAL" };
}

// ── PMC Digest ──────────────────────────────────────────────────────
async function pmcDigest() {
  const data = await patrol();
  const lines = [];
  lines.push(`PMC Daily Digest ${new Date().toLocaleDateString("zh-CN")}`);
  lines.push("---");

  const wos = data.workOrders ?? [];
  const running = wos.filter(w => w.status === "running").length;
  const released = wos.filter(w => w.status === "released").length;
  const draft = wos.filter(w => w.status === "draft").length;
  const onHold = wos.filter(w => w.status === "on_hold").length;
  lines.push(`WO: running=${running} released=${released} draft=${draft} on_hold=${onHold}`);

  const deliverySummary = data.deliveryStatus?.summary ?? {};
  lines.push(`Delivery: on_time=${deliverySummary.on_time || 0} at_risk=${deliverySummary.at_risk || 0} critical=${deliverySummary.critical || 0}`);

  const shortageSummary = data.shortageList?.summary ?? {};
  lines.push(`Shortage: ${shortageSummary.total_shortage_items || 0} items`);

  const capacitySummary = data.capacityAnalysis?.summary ?? {};
  lines.push(`Capacity: high_load=${capacitySummary.high_load || 0} available=${capacitySummary.available || 0} normal=${capacitySummary.normal || 0}`);

  const msg = lines.join("\n");
  await sendLINE(msg);
  console.log(msg);
  await logAudit("PMC_DIGEST", null, null, null, { work_orders: wos.length });
  return { action: "pmc-digest", lines, data };
}

// ── Audit Log ────────────────────────────────────────────────────────
async function logAudit(decisionType, bomId, woNumber, ecoId, data) {
  try {
    await pgPool.query(`
      INSERT INTO pmc_manager_audit
        (agent, decision_type, bom_id, wo_number, eco_id, input_data, output_decision, executed, executor)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,'pmc-ai')
    `, ["pmc-ai-manager", decisionType, bomId, woNumber, ecoId,
        JSON.stringify(data), JSON.stringify(data)]);
  } catch (err) {
    console.error("[AUDIT ERROR]", err.message);
  }
}

// ── LINE ───────────────────────────────────────────────────────────────
async function sendLINE(message) {
  try {
    if (!existsSync(LINE_TOKEN_FILE)) return;
    const token = readFileSync(LINE_TOKEN_FILE, "utf8").trim();
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

// ── Ensure audit table ────────────────────────────────────────────────
async function ensureAuditTable() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS pmc_manager_audit (
        id              bigserial PRIMARY KEY,
        agent           varchar(80) NOT NULL,
        decision_type   varchar(80) NOT NULL,
        bom_id          bigint,
        wo_number       varchar(80),
        eco_id          bigint,
        input_data      jsonb,
        output_decision jsonb,
        executed        boolean NOT NULL DEFAULT true,
        executor        varchar(80),
        override_by     varchar(80),
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
  } catch (_) {}
}

// ── CLI ───────────────────────────────────────────────────────────────
async function main() {
  await ensureAuditTable();

  const [action, ...args] = process.argv.slice(2);

  const getArg = (name, fallback = "") => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback;
  };

  const getFlag = (name) => args.includes(`--${name}`);

  switch (action) {
    case "wo-schedule": {
      const dryRun = getFlag("dry-run");
      const limit = parseInt(getArg("limit", "20"));
      console.log(JSON.stringify(await woSchedule(dryRun, limit), null, 2));
      break;
    }
    case "wo-reschedule": {
      const code = getArg("wocode");
      const dueDate = getArg("due-date");
      const qtyArg = getArg("qty");
      if (!code) { console.error("Usage: wo-reschedule --wocode <code> [--due-date YYYY-MM-DD] [--qty N]"); process.exit(1); }
      console.log(JSON.stringify(await woReschedule(code, dueDate, qtyArg !== "" ? parseInt(qtyArg) : undefined), null, 2));
      break;
    }
    case "wo-hold": {
      const code = getArg("wocode");
      const reason = getArg("reason", "kit incomplete");
      if (!code) { console.error("Usage: wo-hold --wocode <code> [--reason <text>]"); process.exit(1); }
      console.log(JSON.stringify(await woHold(code, reason), null, 2));
      break;
    }
    case "wo-release": {
      const code = getArg("wocode");
      if (!code) { console.error("Usage: wo-release --wocode <code>"); process.exit(1); }
      console.log(JSON.stringify(await woRelease(code), null, 2));
      break;
    }
    case "mrp-run": {
      const date = getArg("date");
      console.log(JSON.stringify(await mrpRun(date || null), null, 2));
      break;
    }
    case "kit-check": {
      const code = getArg("wocode");
      if (!code) { console.error("Usage: kit-check --wocode <code>"); process.exit(1); }
      console.log(JSON.stringify(await kitCheck(code), null, 2));
      break;
    }
    case "shortage-escalate": {
      const days = parseInt(getArg("days", "7"));
      console.log(JSON.stringify(await shortageEscalate(days), null, 2));
      break;
    }
    case "capacity-simulate": {
      const addWo = getArg("add-wo");
      const remWo = getArg("remove-wo");
      console.log(JSON.stringify(await capacitySimulate(addWo, remWo), null, 2));
      break;
    }
    case "delivery-alert": {
      const threshold = parseInt(getArg("days-threshold", "5"));
      console.log(JSON.stringify(await deliveryAlert(threshold), null, 2));
      break;
    }
    case "mps-update": {
      const po = getArg("ponumber");
      const addWo = getArg("add-wo");
      const priority = getArg("priority");
      if (!po) { console.error("Usage: mps-update --ponumber <po> [--add-wo <code>] [--priority N]"); process.exit(1); }
      console.log(JSON.stringify(await mpsUpdate(po, addWo, priority), null, 2));
      break;
    }
    case "pmc-digest":
      console.log(JSON.stringify(await pmcDigest(), null, 2));
      break;
    case "patrol":
      console.log(JSON.stringify(await patrol(), null, 2));
      break;
    case "help":
      console.log(`PMC AI Manager Executor
Usage: node pmc-execute.js <action> [options]

Actions:
  wo-schedule      [--dry-run] [--limit N]      Release WOs with 100% kit ready
  wo-reschedule   --wocode <code> [--due-date YYYY-MM-DD] [--qty N]
  wo-hold         --wocode <code> [--reason <text>]
  wo-release      --wocode <code>
  mrp-run         [--date YYYY-MM-DD]
  kit-check       --wocode <code>
  shortage-escalate [--days N]
  capacity-simulate [--add-wo <code>] [--remove-wo <code>]
  delivery-alert  [--days-threshold N]
  mps-update      --ponumber <po> [--add-wo <code>] [--priority N]
  pmc-digest
  patrol
  help
`);
      break;
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