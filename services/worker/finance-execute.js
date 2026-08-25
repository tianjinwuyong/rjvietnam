// finance-execute.js — Finance AI Manager action/execute tool
// Usage: node finance-execute.js <action> [args]
// Actions:
//   post-ar          <invoice_id>         — Post an AR invoice (generate GL entries)
//   post-ap          <invoice_id>         — Post an AP invoice (generate GL entries)
//   post-wo-cost     <wo_id>             — Post/accumulate WO actual cost
//   fx-reval         <date>              — Revalue open AP/AR balances at period end
//   close-period     <fiscal_year> <period> — Close a fiscal period
//   ack-material-event <event_id>        — Acknowledge a material financial event
//   reconcile        <account_code>      — Auto-reconcile GL account

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { withClient, shutdown } from "../_shared/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env"), quiet: true });

const action = process.argv[2];
const arg1 = process.argv[3]; // invoice_id or wo_id
const arg2 = process.argv[4]; // date or fiscal_year
const arg3 = process.argv[5]; // period

function fmt(n) {
  if (n == null) return "0.00";
  return parseFloat(n).toFixed(2);
}

function nextSeq(client, seqName) {
  return client.query(`SELECT nextval($1)`, [seqName]);
}

// ─────────────────────────────────────────
// POST AR INVOICE
// ─────────────────────────────────────────
async function postArInvoice(invoiceId) {
  return withClient(async (client) => {
    await client.query("BEGIN");

    // Lock the invoice
    const invResult = await client.query(
      `SELECT id, invoice_number, customer_id, total_amount, tax_amount,
              currency_code, exchange_rate, due_date, payment_status
       FROM ar_invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId]
    );
    if (invResult.rows.length === 0) throw new Error(`AR invoice ${invoiceId} not found`);
    const inv = invResult.rows[0];
    if (inv.payment_status === "posted") throw new Error("Invoice already posted");
    if (inv.payment_status === "voided") throw new Error("Cannot post voided invoice");

    // Get GL account codes and VAT rate from config
    const glAccts = await client.query(
      `SELECT account_code, effective_rate FROM finance_vietnam_tax_config
       WHERE tax_type = 'VAT'
       ORDER BY effective_rate DESC LIMIT 1`
    );
    const revenueAcct = glAccts.rows[0]?.account_code || "4100";
    const vatRate = parseFloat(glAccts.rows[0]?.effective_rate || 0.10);

    // Generate GL journal entry number
    const seqResult = await nextSeq(client, "gl_journal_number_seq");
    const journalNo = `AR-${new Date().getFullYear()}-${String(seqResult.rows[0].nextval).padStart(6, "0")}`;

    const debitAmt = parseFloat(inv.total_amount);
    const creditRevenue = debitAmt / (1 + vatRate);
    const creditVat = debitAmt - creditRevenue;

    // Insert GL journal header
    const journalResult = await client.query(
      `INSERT INTO gl_journal_entries (entry_no, source_type, source_id, posting_date, status, description, created_by, created_at)
       VALUES ($1, 'ar_invoice', $2, CURRENT_DATE, 'posted', $3, 'FINANCE_AI', NOW())
       RETURNING id`,
      [journalNo, inv.id, `AR Invoice ${inv.invoice_number} posted`]
    );
    const journalId = journalResult.rows[0].id;

    // GL lines: DR AR, CR Revenue, CR VAT Payable
    await client.query(
      `INSERT INTO gl_journal_lines (entry_id, account_code, debit_amount, credit_amount, currency_code, exchange_rate, description)
       VALUES ($1, '1200', $2, 0, $3, $4, 'DR AR from invoice'), ($1, $5, 0, $6, $3, $4, 'CR Revenue from invoice'), ($1, '2210', 0, $7, $3, $4, 'CR VAT Payable')`,
      [journalId, fmt(debitAmt), inv.currency_code, inv.exchange_rate || 1.0, revenueAcct, fmt(creditRevenue), fmt(creditVat)]
    );

    // Update invoice status
    await client.query(
      `UPDATE ar_invoices SET payment_status = 'posted', updated_at = NOW() WHERE id = $1`,
      [invoiceId]
    );

    await client.query("COMMIT");
    console.log(`✅ AR invoice ${inv.invoice_number} posted. Journal: ${journalNo} | DR $${fmt(debitAmt)} | Journal ID: ${journalId}`);
    return { journalNo, journalId, debitAmt };
  });
}

// ─────────────────────────────────────────
// POST AP INVOICE
// ─────────────────────────────────────────
async function postApInvoice(invoiceId) {
  return withClient(async (client) => {
    await client.query("BEGIN");

    const invResult = await client.query(
      `SELECT id, invoice_number, supplier_id, total_amount, tax_amount,
              currency_code, exchange_rate, payment_status
       FROM ap_invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId]
    );
    if (invResult.rows.length === 0) throw new Error(`AP invoice ${invoiceId} not found`);
    const inv = invResult.rows[0];
    if (inv.payment_status === "posted") throw new Error("Invoice already posted");
    if (inv.payment_status === "voided") throw new Error("Cannot post voided invoice");

    // Get VAT rate from config
    const taxCfg = await client.query(
      `SELECT effective_rate FROM finance_vietnam_tax_config
       WHERE tax_type = 'VAT'
       ORDER BY effective_rate DESC LIMIT 1`
    );
    const vatRate = parseFloat(taxCfg.rows[0]?.effective_rate || 0.10);

    const seqResult = await nextSeq(client, "gl_journal_number_seq");
    const journalNo = `AP-${new Date().getFullYear()}-${String(seqResult.rows[0].nextval).padStart(6, "0")}`;

    const creditAmt = parseFloat(inv.total_amount);
    const debitCogs = creditAmt / (1 + vatRate);
    const debitVat = creditAmt - debitCogs;

    const journalResult = await client.query(
      `INSERT INTO gl_journal_entries (entry_no, source_type, source_id, posting_date, status, description, created_by, created_at)
       VALUES ($1, 'ap_invoice', $2, CURRENT_DATE, 'posted', $3, 'FINANCE_AI', NOW())
       RETURNING id`,
      [journalNo, inv.id, `AP Invoice ${inv.invoice_number} posted`]
    );
    const journalId = journalResult.rows[0].id;

    await client.query(
      `INSERT INTO gl_journal_lines (entry_id, account_code, debit_amount, credit_amount, currency_code, exchange_rate, description)
       VALUES ($1, '5100', $2, 0, $3, $4, 'DR COGS from AP'), ($1, '2220', $5, 0, $3, $4, 'DR VAT Input'), ($1, '2100', 0, $6, $3, $4, 'CR AP')`,
      [journalId, fmt(debitCogs), inv.currency_code, inv.exchange_rate || 1.0, fmt(debitVat), fmt(creditAmt)]
    );

    await client.query(
      `UPDATE ap_invoices SET payment_status = 'posted', updated_at = NOW() WHERE id = $1`,
      [invoiceId]
    );

    await client.query("COMMIT");
    console.log(`✅ AP invoice ${inv.invoice_number} posted. Journal: ${journalNo} | CR $${fmt(creditAmt)} | Journal ID: ${journalId}`);
    return { journalNo, journalId, creditAmt };
  });
}

// ─────────────────────────────────────────
// POST WO ACTUAL COST
// ─────────────────────────────────────────
async function postWoCost(woId) {
  return withClient(async (client) => {
    await client.query("BEGIN");

    // Get WO summary
    const woResult = await client.query(
      `SELECT w.id, w.code, w.product_id, w.line_id, w.status,
              p.code AS product_code, p.name_zh AS product_name,
              w.standard_labor_minutes, w.standard_overhead_minutes,
              w.actual_labor_minutes, w.actual_overhead_minutes,
              wsc.total_standard_cost, wsc.total_actual_cost
       FROM work_orders w
       JOIN products p ON p.id = w.product_id
       LEFT JOIN work_order_cost_summaries wsc ON wsc.work_order_id = w.id
       WHERE w.id = $1 FOR UPDATE`,
      [woId]
    );
    if (woResult.rows.length === 0) throw new Error(`Work order ${woId} not found`);
    const wo = woResult.rows[0];

    // Get cost rates
    const overheadRows = await client.query(
      `SELECT line_code, overhead_rate_usd_per_hour FROM finance_smt_overhead_rates LIMIT 10`
    );
    const laborRows = await client.query(
      `SELECT grade, labor_rate_vnd_per_month FROM finance_labor_rates LIMIT 10`
    );

    const overheadRate = overheadRows.rows.find(r => r.line_code === `SMT-L${wo.line_id}`)?.overhead_rate_usd_per_hour || 45.0;
    const laborRate = laborRows.rows[0]?.labor_rate_vnd_per_month || 6500000;

    // Calculate actual costs
    const actualLaborMin = parseFloat(wo.actual_labor_minutes) || 0;
    const actualOverheadMin = parseFloat(wo.actual_overhead_minutes) || 0;
    const laborCostUsd = (actualLaborMin / 60) * (laborRate / 24000); // approx USD
    const overheadCostUsd = (actualOverheadMin / 60) * overheadRate;
    const totalActualCost = laborCostUsd + overheadCostUsd;

    // Update or insert cost summary
    if (wo.id === wo.id) {
      await client.query(
        `INSERT INTO work_order_cost_summaries
          (work_order_id, total_standard_cost, total_actual_cost, cost_status, updated_at)
         VALUES ($1, $2, $3, 'accumulating', NOW())
         ON CONFLICT (work_order_id) DO UPDATE SET
          total_actual_cost = $3, cost_status = 'accumulating', updated_at = NOW()`,
        [woId, wo.total_standard_cost || 0, fmt(totalActualCost)]
      );
    }

    await client.query("COMMIT");
    console.log(`✅ WO ${wo.code} cost posted. Labor: $${fmt(laborCostUsd)} | Overhead: $${fmt(overheadCostUsd)} | Total: $${fmt(totalActualCost)}`);
    return { woCode: wo.code, laborCostUsd, overheadCostUsd, totalActualCost };
  });
}

// ─────────────────────────────────────────
// FX REVALUATION
// ─────────────────────────────────────────
async function fxReval(asOfDate) {
  return withClient(async (client) => {
    await client.query("BEGIN");

    // Get period FX rate
    const fxResult = await client.query(
      `SELECT from_currency, to_currency, spot_rate FROM finance_exchange_rates
       WHERE from_currency IN ('USD','VND') AND to_currency IN ('USD','VND')
       AND rate_date <= $1
       ORDER BY rate_date DESC LIMIT 1`,
      [asOfDate || new Date().toISOString().split("T")[0]]
    );
    if (fxResult.rows.length === 0) {
      console.log("⚠️  No FX rate found for revaluation, using 1.0");
    }
    const fxRate = fxResult.rows[0]?.spot_rate || 1.0;

    // Revalue open AR invoices in VND
    const arRows = await client.query(
      `SELECT id, invoice_number, total_amount, currency_code,
              COALESCE(exchange_rate, 1.0) AS original_rate,
              CASE WHEN currency_code = 'VND' THEN total_amount / $1
                   WHEN currency_code = 'USD' THEN total_amount * $1
                   ELSE total_amount END AS revalued_amount
       FROM ar_invoices
       WHERE payment_status = 'posted' AND currency_code != 'USD'`,
      [fxRate]
    );

    // Revalue open AP invoices in VND
    const apRows = await client.query(
      `SELECT id, invoice_number, total_amount, currency_code,
              COALESCE(exchange_rate, 1.0) AS original_rate,
              CASE WHEN currency_code = 'VND' THEN total_amount / $1
                   WHEN currency_code = 'USD' THEN total_amount * $1
                   ELSE total_amount END AS revalued_amount
       FROM ap_invoices
       WHERE payment_status = 'posted' AND currency_code != 'USD'`,
      [fxRate]
    );

    let revalCount = 0;
    for (const row of [...arRows.rows, ...apRows.rows]) {
      const diff = parseFloat(row.revalued_amount) - parseFloat(row.total_amount);
      if (Math.abs(diff) < 0.01) continue;

      const seqResult = await nextSeq(client, "gl_journal_number_seq");
      const journalNo = `FX-${new Date().getFullYear()}-${String(seqResult.rows[0].nextval).padStart(6, "0")}`;

      const journalResult = await client.query(
        `INSERT INTO gl_journal_entries (entry_no, source_type, source_id, posting_date, status, description, created_by, created_at)
         VALUES ($1, 'fx_revaluation', $2, $3, 'posted', $4, 'FINANCE_AI', NOW())
         RETURNING id`,
        [journalNo, row.id, asOfDate || new Date().toISOString().split("T")[0],
         `FX Reval ${row.invoice_number} (rate: ${fxRate})`]
      );
      const jid = journalResult.rows[0].id;

      const isAr = row.invoice_number?.startsWith("AR");
      await client.query(
        `INSERT INTO gl_journal_lines (entry_id, account_code, debit_amount, credit_amount, currency_code, exchange_rate, description)
         VALUES ($1, $2, $3, 0, $4, $5, 'FX revaluation gain/loss'), ($1, $6, 0, $7, $4, $5, 'FX revaluation')`,
        [jid, isAr ? "7100" : "6100", fmt(Math.abs(diff)), row.currency_code, fxRate,
         isAr ? "1200" : "2100", fmt(Math.abs(diff))]
      );
      revalCount++;
    }

    await client.query("COMMIT");
    console.log(`✅ FX Revaluation complete | Rate: ${fxRate} | Date: ${asOfDate || "today"} | Entries: ${revalCount}`);
    return { fxRate, revaluedCount: revalCount };
  });
}

// ─────────────────────────────────────────
// CLOSE FISCAL PERIOD
// ─────────────────────────────────────────
async function closePeriod(fiscalYear, period) {
  return withClient(async (client) => {
    await client.query("BEGIN");

    // Check all GL entries posted
    const unposted = await client.query(
      `SELECT count(*) AS cnt FROM gl_journal_entries
       WHERE EXTRACT(YEAR FROM posting_date) = $1
       AND EXTRACT(MONTH FROM posting_date) = $2
       AND status = 'draft'`,
      [fiscalYear, period]
    );
    if (parseInt(unposted.rows[0].cnt) > 0) {
      throw new Error(`Cannot close period ${fiscalYear}-${period}: ${unposted.rows[0].cnt} draft entries remain`);
    }

    // Lock and close period
    const result = await client.query(
      `UPDATE finance_fiscal_periods
       SET period_status = 'closed', closed_at = NOW(), closed_by = 'FINANCE_AI'
       WHERE fiscal_year = $1 AND period_month = $2 AND period_status = 'open'
       RETURNING id`,
      [fiscalYear, period]
    );
    if (result.rows.length === 0) throw new Error(`Period ${fiscalYear}-${period} not found or already closed`);

    await client.query("COMMIT");
    console.log(`✅ Fiscal period ${fiscalYear}-${String(period).padStart(2,"0")} closed successfully`);
    return { fiscalYear, period, status: "closed" };
  });
}

// ─────────────────────────────────────────
// ACKNOWLEDGE MATERIAL FINANCIAL EVENT
// ─────────────────────────────────────────
async function ackMaterialEvent(eventId) {
  return withClient(async (client) => {
    const result = await client.query(
      `UPDATE material_financial_events
       SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = 'FINANCE_AI'
       WHERE id = $1 AND status = 'OPEN'
       RETURNING id, event_type, work_order_code, loss_amount_usd`,
      [eventId]
    );
    if (result.rows.length === 0) throw new Error(`Event ${eventId} not found or not OPEN`);
    const evt = result.rows[0];
    console.log(`✅ Material event ${eventId} acknowledged | Type: ${evt.event_type} | Loss: $${fmt(evt.loss_amount_usd)}`);
    return evt;
  });
}

// ─────────────────────────────────────────
// AUTO-RECONCILE GL ACCOUNT
// ─────────────────────────────────────────
async function reconcile(accountCode) {
  return withClient(async (client) => {
    // Get account balance from gl_journal_lines
    const balResult = await client.query(
      `SELECT account_code, account_name,
              SUM(COALESCE(debit_amount,0)) AS total_debit,
              SUM(COALESCE(credit_amount,0)) AS total_credit
       FROM gl_journal_lines_v l
       JOIN gl_accounts a ON a.account_code = l.account_code
       WHERE l.account_code = $1
       GROUP BY l.account_code, a.account_name`,
      [accountCode]
    );
    if (balResult.rows.length === 0) {
      console.log(`⚠️  No entries found for account ${accountCode}`);
      return;
    }
    const bal = balResult.rows[0];
    const net = parseFloat(bal.total_debit) - parseFloat(bal.total_credit);
    console.log(`📊 Account ${accountCode} (${bal.account_name})`);
    console.log(`   Total Debit:  $${fmt(bal.total_debit)}`);
    console.log(`   Total Credit: $${fmt(bal.total_credit)}`);
    console.log(`   Net Balance:  $${fmt(net)} ${net === 0 ? "✅ BALANCED" : "⚠️  IMBALANCED"}`);
    return bal;
  });
}

// ─────────────────────────────────────────
async function main() {
  try {
    switch (action) {
      case "post-ar":
        if (!arg1) throw new Error("Usage: node finance-execute.js post-ar <invoice_id>");
        await postArInvoice(arg1);
        break;
      case "post-ap":
        if (!arg1) throw new Error("Usage: node finance-execute.js post-ap <invoice_id>");
        await postApInvoice(arg1);
        break;
      case "post-wo-cost":
        if (!arg1) throw new Error("Usage: node finance-execute.js post-wo-cost <wo_id>");
        await postWoCost(arg1);
        break;
      case "fx-reval":
        await fxReval(arg2); // arg2 is date
        break;
      case "close-period":
        if (!arg2 || !arg3) throw new Error("Usage: node finance-execute.js close-period <fiscal_year> <period>");
        await closePeriod(arg2, arg3);
        break;
      case "ack-material-event":
        if (!arg1) throw new Error("Usage: node finance-execute.js ack-material-event <event_id>");
        await ackMaterialEvent(arg1);
        break;
      case "reconcile":
        if (!arg1) throw new Error("Usage: node finance-execute.js reconcile <account_code>");
        await reconcile(arg1);
        break;
      default:
        console.log(`Unknown action: ${action}`);
        console.log("Available: post-ar, post-ap, post-wo-cost, fx-reval, close-period, ack-material-event, reconcile");
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  } finally {
    await shutdown();
  }
}

main();
