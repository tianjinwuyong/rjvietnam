// finance-query.js — Finance AI Manager DB query tool
// Usage: node finance-query.js [--json] <scope>
// Scopes: ar-aging, ap-aging, wo-cost, inventory-valuation, material-events, gl-journals, dashboard-summary, all
// --json   : Output machine-readable JSON (used by finance-manager.js)

import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { query, shutdown } from "../_shared/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require2 = createRequire(import.meta.url);
require2("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });

const rawArgs = process.argv.slice(2);
const jsonMode = rawArgs[0] === "--json";
const scope = jsonMode ? (rawArgs[1] || "all") : (rawArgs[0] || "all");

function fmt(n) {
  if (n == null) return "0";
  return parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function arAging() {
  const today = new Date().toISOString().split("T")[0];
  const rows = await query(
    `SELECT c.code AS customer_code, c.name_zh AS customer_name,
            a.currency_code,
            SUM(a.total_amount) AS total_invoiced,
            SUM(a.outstanding_amount) AS total_outstanding,
            SUM(CASE WHEN a.due_date < $1::date - interval '90 days' THEN a.outstanding_amount ELSE 0 END) AS overdue_90
     FROM ar_invoices a JOIN customers c ON c.id = a.customer_id
     WHERE a.payment_status NOT IN ('paid','voided')
     GROUP BY c.code, c.name_zh, a.currency_code ORDER BY SUM(a.outstanding_amount) DESC LIMIT 50`,
    [today]
  );
  if (!jsonMode) {
    console.log("\n📊 AR Aging Report — as of", today);
    console.log("━".repeat(90));
    console.log("Customer              | Currency | Invoiced    | Outstanding | Overdue(90d+)");
    console.log("━".repeat(90));
    for (const r of rows.rows) {
      const overdue = parseFloat(r.overdue_90) > 0 ? `🔴 ${fmt(r.overdue_90)}` : "—";
      console.log(`${(r.customer_name || r.customer_code).padEnd(20)} | ${(r.currency_code || "USD").padEnd(8)} | ${fmt(r.total_invoiced).padStart(11)} | ${fmt(r.total_outstanding).padStart(11)} | ${overdue}`);
    }
    const totals = rows.rows.reduce((a, r) => ({
      invoiced: a.invoiced + parseFloat(r.total_invoiced || 0),
      outstanding: a.outstanding + parseFloat(r.total_outstanding || 0),
      overdue: a.overdue + parseFloat(r.overdue_90 || 0),
    }), { invoiced: 0, outstanding: 0, overdue: 0 });
    console.log("━".repeat(90));
    console.log(`${"TOTAL".padEnd(20)} |          | ${fmt(totals.invoiced).padStart(11)} | ${fmt(totals.outstanding).padStart(11)} | ${fmt(totals.overdue)}`);
  }
  return rows;
}

async function apAging() {
  const today = new Date().toISOString().split("T")[0];
  const rows = await query(
    `SELECT s.code AS supplier_code, s.name_zh AS supplier_name,
            a.currency_code,
            SUM(a.total_amount) AS total_invoiced,
            SUM(a.outstanding_amount) AS total_outstanding,
            SUM(CASE WHEN a.due_date < $1::date - interval '30 days' THEN a.outstanding_amount ELSE 0 END) AS overdue_30
     FROM ap_invoices a JOIN suppliers s ON s.id = a.supplier_id
     WHERE a.payment_status NOT IN ('paid','voided')
     GROUP BY s.code, s.name_zh, a.currency_code ORDER BY SUM(a.outstanding_amount) DESC LIMIT 50`,
    [today]
  );
  if (!jsonMode) {
    console.log("\n📊 AP Aging Report — as of", today);
    console.log("━".repeat(90));
    console.log("Supplier             | Currency | Invoiced    | Outstanding | Overdue(30d+)");
    console.log("━".repeat(90));
    for (const r of rows.rows) {
      const overdue = parseFloat(r.overdue_30) > 0 ? `🟠 ${fmt(r.overdue_30)}` : "—";
      console.log(`${(r.supplier_name || r.supplier_code).padEnd(20)} | ${(r.currency_code || "USD").padEnd(8)} | ${fmt(r.total_invoiced).padStart(11)} | ${fmt(r.total_outstanding).padStart(11)} | ${overdue}`);
    }
  }
  return rows;
}

async function woCost() {
  const rows = await query(
    `SELECT wo.code AS wo_code, p.code AS product_code, p.name_zh AS product_name,
            pl.internal_code AS line_code,
            w.total_standard_cost, w.total_actual_cost,
            w.cost_status, w.updated_at
     FROM work_order_cost_summaries w
     JOIN work_orders wo ON wo.id = w.work_order_id
     JOIN products p ON p.id = wo.product_id
     LEFT JOIN production_lines pl ON pl.id = wo.line_id
     WHERE w.cost_status IN ('open','accumulating')
     ORDER BY w.updated_at DESC LIMIT 30`
  );
  if (!jsonMode) {
    console.log("\n📋 Work Order Cost Summary");
    console.log("━".repeat(100));
    console.log("WO Code        | Product         | Line  | Std Cost     | Act Cost     | Variance  | Status");
    console.log("━".repeat(100));
    for (const r of rows.rows) {
      const std = parseFloat(r.total_standard_cost) || 0;
      const act = parseFloat(r.total_actual_cost) || 0;
      const varPct = std > 0 ? ((act - std) / std * 100).toFixed(1) + "%" : "—";
      const tone = act > std * 1.1 ? "🔴" : act > std * 1.05 ? "🟠" : "🟢";
      console.log(`${(r.wo_code || "").padEnd(13)}| ${(r.product_code || "").padEnd(15)}| ${(r.line_code || "-").padEnd(5)}| ${fmt(std).padStart(11)}| ${fmt(act).padStart(11)}| ${varPct.padStart(9)} ${tone}| ${r.cost_status}`);
    }
  }
  return rows;
}

async function inventoryValuation() {
  const rows = await query(
    `SELECT m.code AS material_code, m.name_zh AS material_name,
            SUM(icl.remaining_quantity) AS total_qty,
            AVG(icl.unit_cost) AS avg_unit_cost,
            SUM(icl.remaining_quantity * icl.unit_cost) AS total_value,
            icl.currency_code
     FROM inventory_cost_layers icl
     JOIN material_lots ml ON ml.id = icl.material_lot_id
     JOIN materials m ON m.id = ml.material_id
     WHERE icl.status = 'open' AND icl.remaining_quantity > 0
     GROUP BY m.code, m.name_zh, icl.currency_code
     ORDER BY total_value DESC LIMIT 30`
  );
  if (!jsonMode) {
    console.log("\n📦 Inventory Valuation (FIFO Cost Layers)");
    console.log("━".repeat(90));
    console.log("Material Code    | Material Name        | Qty        | Avg Cost   | Total Value");
    console.log("━".repeat(90));
    for (const r of rows.rows) {
      const val = parseFloat(r.total_value) || 0;
      const tone = val > 10000 ? "🔴" : val > 5000 ? "🟠" : "🟢";
      console.log(`${(r.material_code || "").padEnd(15)}| ${(r.material_name || "").padEnd(19)}| ${fmt(r.total_qty).padStart(10)}| ${fmt(r.avg_unit_cost).padStart(9)}| ${fmt(val).padStart(12)} ${tone}`);
    }
    const total = rows.rows.reduce((s, r) => s + parseFloat(r.total_value || 0), 0);
    console.log("━".repeat(90));
    console.log(`Total Inventory Value: ${fmt(total)} ${rows.rows[0]?.currency_code || "USD"}`);
  }
  return rows;
}

async function materialEvents() {
  const rows = await query(
    `SELECT id, event_type, status, work_order_code, material_code, material_name_zh,
            qty, unit_cost_usd, total_cost_usd, loss_amount_usd,
            supplier_name, reason_note, occurred_at
     FROM material_financial_events
     WHERE status = 'OPEN'
     ORDER BY occurred_at DESC LIMIT 20`
  );
  if (!jsonMode) {
    console.log("\n⚠️  Material Financial Events (OPEN)");
    console.log("━".repeat(100));
    for (const r of rows.rows) {
      const loss = parseFloat(r.loss_amount_usd) || 0;
      const tone = loss > 1000 ? "🔴" : loss > 0 ? "🟠" : "🟡";
      console.log(`${tone} [${r.event_type}] ${r.work_order_code || "-"} | ${r.material_code || "-"} | ${r.qty || 0}pcs | $${fmt(r.total_cost_usd)} | Loss: $${fmt(r.loss_amount_usd)} | ${r.reason_note || ""}`);
      if (r.supplier_name) console.log(`   Supplier: ${r.supplier_name} | At: ${r.occurred_at}`);
    }
    const totalLoss = rows.rows.reduce((s, r) => s + parseFloat(r.loss_amount_usd || 0), 0);
    console.log("━".repeat(100));
    console.log(`Total Open Loss: $${fmt(totalLoss)}`);
  }
  return rows;
}

async function dashboardSummary() {
  const today = new Date().toISOString().split("T")[0];
  const ar = await query(`SELECT COALESCE(SUM(outstanding_amount),0) AS total, COALESCE(SUM(CASE WHEN due_date < $1 THEN outstanding_amount ELSE 0 END),0) AS overdue FROM ar_invoices WHERE payment_status NOT IN ('paid','voided')`, [today]);
  const ap = await query(`SELECT COALESCE(SUM(outstanding_amount),0) AS total FROM ap_invoices WHERE payment_status NOT IN ('paid','voided')`);
  const inv = await query(`SELECT COALESCE(SUM(remaining_quantity * unit_cost),0) AS val FROM inventory_cost_layers WHERE status = 'open' AND remaining_quantity > 0`);
  const wip = await query(`SELECT COALESCE(SUM(total_actual_cost),0) AS val FROM work_order_cost_summaries WHERE cost_status IN ('open','accumulating')`);
  const mfe = await query(`SELECT count(*) AS cnt FROM material_financial_events WHERE status = 'OPEN'`);
  const openJe = await query(`SELECT count(*) AS cnt FROM gl_journal_entries WHERE status = 'draft'`);
  const result = {
    totalArOutstanding: parseFloat(ar.rows[0]?.total || 0),
    arOverdue: parseFloat(ar.rows[0]?.overdue || 0),
    totalApOutstanding: parseFloat(ap.rows[0]?.total || 0),
    totalInventoryValue: parseFloat(inv.rows[0]?.val || 0),
    totalWipCost: parseFloat(wip.rows[0]?.val || 0),
    openMaterialEvents: parseInt(mfe.rows[0]?.cnt || 0),
    draftGlEntries: parseInt(openJe.rows[0]?.cnt || 0),
    currency: "USD",
    date: today,
  };
  if (!jsonMode) {
    console.log("\n💰 Finance Dashboard Summary —", today);
    console.log("━".repeat(60));
    console.log(`  AR Receivable:        $${fmt(result.totalArOutstanding)}  (Overdue: $${fmt(result.arOverdue)})`);
    console.log(`  AP Payable:          $${fmt(result.totalApOutstanding)}`);
    console.log(`  Inventory Value:     $${fmt(result.totalInventoryValue)}`);
    console.log(`  WIP Cost:            $${fmt(result.totalWipCost)}`);
    console.log(`  Open Material Events: ${result.openMaterialEvents}`);
    console.log(`  Draft GL Entries:     ${result.draftGlEntries}`);
    console.log("━".repeat(60));
  }
  return result;
}

async function main() {
  try {
    const result = {};

    if (scope === "all" || scope === "ar-aging") result.arAging = await arAging();
    if (scope === "all" || scope === "ap-aging") result.apAging = await apAging();
    if (scope === "all" || scope === "wo-cost") result.woCosts = await woCost();
    if (scope === "all" || scope === "inventory-valuation") result.inventoryValuation = await inventoryValuation();
    if (scope === "all" || scope === "material-events") result.materialEvents = await materialEvents();
    if (scope === "all" || scope === "dashboard-summary") result.dashboardSummary = await dashboardSummary();
    if (scope === "all" || scope === "gl-journals") {
      const rows = await query(`SELECT entry_no, source_type, posting_date, status, (SELECT sum(debit_amount) FROM gl_journal_lines WHERE entry_id = j.id) AS total_debit FROM gl_journal_entries j ORDER BY created_at DESC LIMIT 20`);
      result.glJournals = rows;
      if (!jsonMode) {
        console.log("\n📒 Recent GL Journal Entries");
        console.log("━".repeat(80));
        for (const r of rows.rows) {
          console.log(`${r.entry_no} | ${r.source_type} | ${r.posting_date} | ${r.status} | DR: $${fmt(r.total_debit)}`);
        }
      }
    }

    if (jsonMode) {
      console.log(JSON.stringify(result));
    }
  } catch (err) {
    console.error("Error:", err.message);
    if (jsonMode) console.error(JSON.stringify({ error: err.message }));
  } finally {
    await shutdown();
  }
}

main();
