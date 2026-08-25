/**
 * procurement-execute.js
 * Write/execute operations for the Procurement AI Manager.
 *
 * Usage: node procurement-execute.js <action> [options]
 *
 * Actions:
 *   create-rfq --reqno <no> --title <s>    Create RFQ from requisition
 *   submit-quote --rfqno <no> --supcode <s> --total <n>  Submit supplier quote
 *   award-rfq --rfqno <no> --supcode <s>  Award RFQ to supplier
 *   generate-po --rfqno <no>              Generate PO from awarded RFQ
 *   submit-contract --po <no> --title <s> --value <n>  Submit contract for approval
 *   approve-contract --id <n>              Approve current step
 *   reject-contract --id <n> --reason <s>  Reject current step
 *   close-po --pono <no>                  Force close PO
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args[process.argv[i].slice(2)] = process.argv[i + 1] ?? null;
    i++;
  }
}

async function sql(sqlStr, params = []) {
  const client = await pool.connect();
  try {
    const r = await client.query(sqlStr, params);
    return r.rows[0] ?? r.rows;
  } finally {
    client.release();
  }
}

async function tx(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function nextSeq(pattern, rows) {
  const nums = rows
    .map(r => {
      const m = r[Object.keys(r)[0]].match(new RegExp(pattern + "-(\\d+)$"));
      return m ? parseInt(m[1], 10) : 0;
    });
  return (Math.max(0, ...nums) + 1).toString().padStart(4, "0");
}

// ── Create RFQ from Purchase Requisition ─────────────────────────────────────

async function createRfq(reqNo, title) {
  return tx(async (c) => {
    // Find requisition
    const req = await c.query(
      `SELECT pr.*, u.id AS user_id FROM purchase_requisitions pr
       JOIN users u ON u.id = pr.requester_id
       WHERE pr.requisition_no = $1`, [reqNo]
    );
    if (!req.rows.length) throw new Error(`Requisition ${reqNo} not found`);

    const r = req.rows[0];

    // Get requisition lines
    const lines = await c.query(
      `SELECT prl.*, m.name_zh FROM purchase_requisition_lines prl
       LEFT JOIN materials m ON m.id = prl.material_id
       WHERE prl.requisition_id = $1`, [r.id]
    );

    // Generate RFQ no
    const seqRows = await c.query(`SELECT rfq_no FROM rfq_headers ORDER BY id DESC LIMIT 10`);
    const seq = nextSeq("RFQ", seqRows.rows);
    const rfqNo = `RFQ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${seq}`;

    // Insert RFQ header
    const rfq = await c.query(`
      INSERT INTO rfq_headers (rfq_no, requisition_id, title, requested_by, department, status)
      VALUES ($1, $2, $3, $4, $5, 'draft')
      RETURNING id, rfq_no`, [rfqNo, r.id, title, r.user_id, r.department]
    );

    // Insert RFQ lines
    for (const ln of lines.rows) {
      await c.query(`
        INSERT INTO rfq_lines (rfq_header_id, line_no, material_id, material_code,
          material_name_zh, qty_requested, unit, target_unit_price, delivery_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [rfq.rows[0].id, ln.line_no, ln.material_id, ln.material_code,
          ln.material_name_zh, ln.qty_requested, ln.unit,
          ln.target_unit_cost, r.target_date]);
    }

    // Update requisition status
    await c.query(
      `UPDATE purchase_requisitions SET status = 'submitted', submitted_at = now()
       WHERE id = $1`, [r.id]
    );

    return rfq.rows[0];
  });
}

// ── Submit Supplier Quote ──────────────────────────────────────────────────────

async function submitQuote(rfqNo, supplierCode, totalAmount, currencyCode = "USD",
  leadTimeDays = null, paymentTerms = null) {

  return tx(async (c) => {
    // Find RFQ + supplier
    const rfq = await c.query(`SELECT id FROM rfq_headers WHERE rfq_no = $1`, [rfqNo]);
    if (!rfq.rows.length) throw new Error(`RFQ ${rfqNo} not found`);

    const sup = await c.query(`SELECT id FROM suppliers WHERE code = $1`, [supplierCode]);
    if (!sup.rows.length) throw new Error(`Supplier ${supplierCode} not found`);

    const rfqId = rfq.rows[0].id;
    const supId = sup.rows[0].id;

    // Seq for quote no
    const seqRows = await c.query(
      `SELECT quote_no FROM supplier_quote_headers WHERE rfq_header_id = $1
       ORDER BY id DESC LIMIT 10`, [rfqId]
    );
    const seq = nextSeq("QT", seqRows.rows);
    const quoteNo = `QT-${rfqNo}-${seq}`;

    const result = await c.query(`
      INSERT INTO supplier_quote_headers
        (rfq_header_id, supplier_id, quote_no, total_amount, currency_code,
         lead_time_days, payment_terms, status, submitted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', now())
      RETURNING id, quote_no
    `, [rfqId, supId, quoteNo, totalAmount, currencyCode, leadTimeDays, paymentTerms]);

    // Update RFQ status
    await c.query(
      `UPDATE rfq_headers SET status = 'quotes_received' WHERE id = $1 AND status = 'draft'`,
      [rfqId]
    );

    return result.rows[0];
  });
}

// ── Award RFQ to Supplier ─────────────────────────────────────────────────────

async function awardRfq(rfqNo, supplierCode) {
  return tx(async (c) => {
    const rfq = await c.query(`SELECT id FROM rfq_headers WHERE rfq_no = $1`, [rfqNo]);
    if (!rfq.rows.length) throw new Error(`RFQ ${rfqNo} not found`);
    const sup = await c.query(`SELECT id FROM suppliers WHERE code = $1`, [supplierCode]);
    if (!sup.rows.length) throw new Error(`Supplier ${supplierCode} not found`);

    const rfqId = rfq.rows[0].id;
    const supId = sup.rows[0].id;

    await c.query(`
      UPDATE rfq_headers
      SET status = 'awarded', awarded_supplier_id = $1, awarded_at = now()
      WHERE id = $2`, [supId, rfqId]);

    return { rfq_no: rfqNo, awarded_supplier_id: supId, status: "awarded" };
  });
}

// ── Generate PO from Awarded RFQ ───────────────────────────────────────────────

async function generatePo(rfqNo) {
  return tx(async (c) => {
    const rfq = await c.query(`
      SELECT rh.*, sqh.supplier_id, sqh.grand_total, sqh.currency_code
      FROM rfq_headers rh
      JOIN supplier_quote_headers sqh ON sqh.rfq_header_id = rh.id AND sqh.is_winner = true
      WHERE rh.rfq_no = $1 AND rh.status = 'awarded'
    `, [rfqNo]);

    if (!rfq.rows.length) throw new Error(`Awarded RFQ ${rfqNo} not found — award supplier first`);

    const h = rfq.rows[0];

    // Seq for PO no
    const seqRows = await c.query(`SELECT po_no FROM purchase_order_headers ORDER BY id DESC LIMIT 10`);
    const seq = nextSeq("PO", seqRows.rows);
    const poNo = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${seq}`;

    // Get RFQ lines
    const lines = await c.query(
      `SELECT rfl.*, sql.unit_price AS quoted_price
       FROM rfq_lines rfl
       JOIN supplier_quote_lines sql ON sql.rfq_line_id = rfl.id
       JOIN supplier_quote_headers sqh ON sqh.id = sql.quote_header_id
       WHERE rfl.rfq_header_id = $1 AND sqh.supplier_id = $2 AND sqh.is_winner = true`,
      [h.id, h.supplier_id]
    );

    if (!lines.rows.length) throw new Error(`No quote lines found for ${rfqNo}`);

    // Default user (system operator id=1)
    const userRows = await c.query(`SELECT id FROM users ORDER BY id ASC LIMIT 1`);
    const userId = userRows.rows[0]?.id ?? 1;

    const po = await c.query(`
      INSERT INTO purchase_order_headers
        (po_no, requisition_id, supplier_id, order_date, total_amount, currency_code,
         status, created_by)
      VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, 'draft', $6)
      RETURNING id, po_no
    `, [poNo, h.requisition_id, h.supplier_id, h.grand_total, h.currency_code, userId]);

    const poId = po.rows[0].id;
    let subtotal = 0;

    for (const ln of lines.rows) {
      const lineTotal = (ln.qty_requested * ln.quoted_price).toFixed(2);
      subtotal += parseFloat(lineTotal);
      await c.query(`
        INSERT INTO purchase_order_lines
          (po_header_id, line_no, material_id, material_code, qty_ordered,
           unit_price, line_total, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      `, [poId, ln.line_no, ln.material_id, ln.material_code,
          ln.qty_requested, ln.quoted_price, lineTotal]);
    }

    await c.query(
      `UPDATE purchase_order_headers SET subtotal = $1, total_amount = $1
       WHERE id = $2`, [subtotal, poId]
    );

    // Update requisition
    if (h.requisition_id) {
      await c.query(
        `UPDATE purchase_requisitions SET status = 'po_created' WHERE id = $1`, [h.requisition_id]
      );
    }

    return po.rows[0];
  });
}

// ── Submit Contract for Approval ───────────────────────────────────────────────

async function submitContract(poNo, title, totalValue, currencyCode = "USD",
  contractType = "purchase", paymentTerms = null) {

  return tx(async (c) => {
    const po = await c.query(`SELECT id, supplier_id FROM purchase_order_headers WHERE po_no = $1`, [poNo]);
    if (!po.rows.length) throw new Error(`PO ${poNo} not found`);

    const seqRows = await c.query(
      `SELECT contract_no FROM procurement_contracts ORDER BY id DESC LIMIT 10`
    );
    const seq = nextSeq("PC", seqRows.rows);
    const contractNo = `PC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${seq}`;

    const userRows = await c.query(`SELECT id FROM users ORDER BY id ASC LIMIT 1`);
    const userId = userRows.rows[0]?.id ?? 1;

    const contract = await c.query(`
      INSERT INTO procurement_contracts
        (contract_no, po_header_id, supplier_id, title, contract_type,
         total_value, currency_code, payment_terms, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_approval', $9)
      RETURNING id, contract_no
    `, [contractNo, po.rows[0].id, po.rows[0].supplier_id, title, contractType,
        totalValue, currencyCode, paymentTerms, userId]);

    // Lookup routing rules and create approval tasks
    const rules = await c.query(`
      SELECT step_1_role, step_2_role, step_3_role, step_4_role, step_5_role
      FROM approval_routing_rules
      WHERE contract_type = $1 AND active = true
        AND ($2 >= COALESCE(min_value, 0))
        AND (max_value IS NULL OR $2 <= max_value)
      LIMIT 1
    `, [contractType, totalValue]);

    if (rules.rows.length) {
      const r = rules.rows[0];
      let step = 1;
      for (const role of [r.step_1_role, r.step_2_role, r.step_3_role,
                           r.step_4_role, r.step_5_role]) {
        if (!role) break;
        await c.query(`
          INSERT INTO contract_approval_tasks (contract_id, step, approver_role, status)
          VALUES ($1, $2, $3, 'pending')
        `, [contract.rows[0].id, step++, role]);
      }
    } else {
      // Default single-step approval
      await c.query(`
        INSERT INTO contract_approval_tasks (contract_id, step, approver_role, status)
        VALUES ($1, 1, 'purchasing_supervisor', 'pending')
      `, [contract.rows[0].id]);
    }

    return contract.rows[0];
  });
}

// ── Approve Contract Step ─────────────────────────────────────────────────────

async function approveContract(contractId) {
  return tx(async (c) => {
    const task = await c.query(`
      SELECT cat.*, pc.status AS contract_status
      FROM contract_approval_tasks cat
      JOIN procurement_contracts pc ON pc.id = cat.contract_id
      WHERE cat.id = $1 AND cat.status = 'pending'
      FOR UPDATE OF cat
    `, [contractId]);

    if (!task.rows.length) throw new Error(`Approval task ${contractId} not found or already resolved`);

    const t = task.rows[0];

    // Find next pending step
    const next = await c.query(`
      SELECT id FROM contract_approval_tasks
      WHERE contract_id = $1 AND step = $2 AND status = 'pending'
    `, [t.contract_id, t.step + 1]);

    const isLast = !next.rows.length;

    // Resolve current step
    await c.query(`
      UPDATE contract_approval_tasks
      SET status = 'approved', decision = 'approve', decided_at = now()
      WHERE id = $1
    `, [contractId]);

    // Log history
    await c.query(`
      INSERT INTO contract_approval_history (contract_id, step, approver_role, action, acted_at)
      VALUES ($1, $2, $3, 'approve', now())
    `, [t.contract_id, t.step, t.approver_role]);

    if (isLast) {
      // Final approval — activate contract
      await c.query(`
        UPDATE procurement_contracts
        SET status = 'active', approved_at = now()
        WHERE id = $1
      `, [t.contract_id]);
    }

    return {
      task_id: contractId,
      decision: "approved",
      is_final: isLast,
      next_step: next.rows[0]?.id ?? null,
    };
  });
}

// ── Reject Contract ──────────────────────────────────────────────────────────

async function rejectContract(contractId, reason) {
  return tx(async (c) => {
    const task = await c.query(`
      SELECT cat.* FROM contract_approval_tasks cat
      WHERE cat.id = $1 AND cat.status = 'pending'
      FOR UPDATE OF cat
    `, [contractId]);

    if (!task.rows.length) throw new Error(`Approval task ${contractId} not found`);

    const t = task.rows[0];

    await c.query(`
      UPDATE contract_approval_tasks
      SET status = 'rejected', decision = 'reject', notes = $2, decided_at = now()
      WHERE id = $1
    `, [contractId, reason]);

    await c.query(`
      INSERT INTO contract_approval_history (contract_id, step, approver_role, action, notes, acted_at)
      VALUES ($1, $2, $3, 'reject', $4, now())
    `, [t.contract_id, t.step, t.approver_role, reason]);

    // Reject the contract itself
    await c.query(`
      UPDATE procurement_contracts
      SET status = 'rejected', rejected_at = now(), rejection_reason = $2
      WHERE id = $1
    `, [t.contract_id, reason]);

    return { task_id: contractId, decision: "rejected" };
  });
}

// ── Close PO ─────────────────────────────────────────────────────────────────

async function closePo(poNo) {
  return sql(`
    UPDATE purchase_order_headers
    SET status = 'closed', closed_at = now()
    WHERE po_no = $1 AND status NOT IN ('cancelled', 'closed')
    RETURNING po_no, status
  `, [poNo]);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const action = process.argv[2];

async function main() {
  try {
    let result;
    switch (action) {
      case "create-rfq":
        result = await createRfq(args.reqno, args.title ?? "Untitled RFQ");
        break;
      case "submit-quote":
        result = await submitQuote(
          args.rfqno, args.supcode,
          parseFloat(args.total),
          args.currency ?? "USD",
          args.leadtime ? parseInt(args.leadtime) : null,
          args.payment ?? null
        );
        break;
      case "award-rfq":
        result = await awardRfq(args.rfqno, args.supcode);
        break;
      case "generate-po":
        result = await generatePo(args.rfqno);
        break;
      case "submit-contract":
        result = await submitContract(
          args.po, args.title,
          parseFloat(args.value),
          args.currency ?? "USD",
          args.type ?? "purchase",
          args.payment ?? null
        );
        break;
      case "approve-contract":
        result = await approveContract(parseInt(args.id));
        break;
      case "reject-contract":
        result = await rejectContract(parseInt(args.id), args.reason ?? "No reason provided");
        break;
      case "close-po":
        result = await closePo(args.pono);
        break;
      default:
        console.error(`Unknown action: ${action}`);
        console.error(`Usage: node procurement-execute.js <action> ...`);
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
