import { Router } from "express";
import { query } from "./src/db.js";

// ── Envelope helpers (mirror server.js) ─────────────────────────────
function env(data) { return { data, meta: { serverTime: new Date().toISOString() } }; }
function listEnv(items, total) { return env({ items, total: total ?? items.length }); }
function errEnv(code, message) { return { error: { code, message }, meta: { serverTime: new Date().toISOString() } }; }

// ── nextDocNo helper ───────────────────────────────────────────────
// Uses per-table sequences: inbound_orders_seq, outbound_orders_seq, etc.
async function nextDocNo(prefix, seqName) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = await query(`SELECT nextval($1) AS n`, [seqName]);
  const n = r.rows[0]?.n ?? 1;
  return `${prefix}-${ymd}-${String(n).padStart(6, "0")}`;
}

// ── State machine ───────────────────────────────────────────────────
const transitions = {
  inbound_order:    { DRAFT: ["SUBMITTED"],              SUBMITTED: ["APPROVED","REJECTED"], APPROVED: ["EXECUTING","REJECTED"], EXECUTING: ["COMPLETED"], COMPLETED: [], REJECTED: [], CANCELLED: [] },
  outbound_order:  { DRAFT: ["SUBMITTED"],              SUBMITTED: ["APPROVED","REJECTED"], APPROVED: ["EXECUTING","REJECTED"], EXECUTING: ["COMPLETED"], COMPLETED: [], REJECTED: [], CANCELLED: [] },
  requisition:     { DRAFT: ["SUBMITTED"],              SUBMITTED: ["APPROVED","REJECTED"], APPROVED: ["EXECUTING","REJECTED"], EXECUTING: ["COMPLETED"], COMPLETED: [], REJECTED: [], CANCELLED: [] },
  return_slip:     { DRAFT: ["SUBMITTED"],              SUBMITTED: ["EXECUTING"],            EXECUTING: ["COMPLETED"],            COMPLETED: [], REJECTED: [], CANCELLED: [] },
  replenishment:   { DRAFT: ["SUBMITTED"],              SUBMITTED: ["APPROVED","REJECTED"], APPROVED: ["EXECUTING","REJECTED"], EXECUTING: ["COMPLETED"], COMPLETED: [], REJECTED: [], CANCELLED: [] },
};

function canTransition(table, from, to) {
  const allowed = transitions[table]?.[from] ?? [];
  return allowed.includes(to);
}

// ── Apply inventory transaction ─────────────────────────────────────
// action values from CHECK constraint: RECEIVE, IQC_RELEASE, PUT_AWAY,
// RESERVE, PICK, ISSUE_TO_LINE, RETURN, SCRAP, ADJUST
const txActionMap = {
  inbound_order:   "PUT_AWAY",
  outbound_order:  "ISSUE_TO_LINE",
  requisition:     "PICK",
  return_slip:     "RETURN",
  replenishment:   "PUT_AWAY",   // same as inbound — replenishment restores stock
};

async function applyInventoryTx(doc, table, lines, operator) {
  const action = txActionMap[table];
  const opId = 1; // system operator — TODO: resolve from req.user
  for (const line of lines.rows) {
    if (!line.material_id) continue;
    const locCode = line.location_code;
    // resolve location id
    let fromId = null, toId = null;
    if (action === "ISSUE_TO_LINE" || action === "PICK" || action === "RETURN") {
      fromId = locCode ? (await query(`SELECT id FROM storage_locations WHERE location_code = $1`, [locCode])).rows[0]?.id : null;
    } else {
      toId = locCode ? (await query(`SELECT id FROM storage_locations WHERE location_code = $1`, [locCode])).rows[0]?.id : null;
    }
    const qty = line.executed_qty ?? line.requested_qty ?? 0;
    const refNo = `${table.toUpperCase()}-${doc.id}`;
    await query(
      `INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, from_location_id, to_location_id, operator_id, reference_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [refNo, action, line.material_id, qty, fromId, toId, opId, refNo]
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Router factory — works for any document table
// ═══════════════════════════════════════════════════════════════════
function makeDocRouter({ table, tableLines, prefix, tableKey, mainFields, lineFields, seqName }) {
  const router = Router();
  const fk = `${tableKey}_id`;  // e.g. "inbound_order_id"
  const pk = "id";

  // LIST /wms/{prefix}
  router.get("/", async (req, res, next) => {
    try {
      const { status, from, to, page = 1, pageSize = 20 } = req.query;
      const params = [];
      const cond = [];
      if (status) { cond.push(`d.status = $${params.length + 1}`); params.push(status); }
      if (from)   { cond.push(`d.created_at >= $${params.length + 1}`); params.push(from); }
      if (to)     { cond.push(`d.created_at <= $${params.length + 1}`); params.push(to); }
      const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
      const offset = (Number(page) - 1) * Number(pageSize);
      const limit = Number(pageSize);
      const cols = ["d.id","d.doc_no","d.status","d.created_at","d.created_by",
        ...mainFields.filter(f => !["id","doc_no","status","created_at","created_by","updated_at"].includes(f))];
      const sel = cols.join(", ");
      const items = await query(
        `SELECT ${sel} FROM ${table} d ${where} ORDER BY d.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, offset]
      );
      const cnt = await query(`SELECT count(*)::int AS t FROM ${table} d ${where}`, params);
      res.json(listEnv(items.rows, cnt.rows[0]?.t ?? 0));
    } catch (err) { next(err); }
  });

  // GET /wms/{prefix}/:id
  router.get("/:id", async (req, res, next) => {
    try {
      const main = await query(`SELECT * FROM ${table} WHERE ${pk} = $1`, [req.params.id]);
      if (!main.rows.length) return res.status(404).json(errEnv("NOT_FOUND", "Document not found"));
      const lines = await query(
        `SELECT l.*, m.material_code, m.name_zh AS material_name, s.location_code, s.location_name
         FROM ${tableLines} l
         LEFT JOIN materials m ON m.id = l.material_id
         LEFT JOIN storage_locations s ON s.id = l.location_code
         WHERE l.${fk} = $1 ORDER BY l.id`,
        [req.params.id]
      );
      res.json(env({ ...main.rows[0], lines: lines.rows }));
    } catch (err) { next(err); }
  });

  // POST /wms/{prefix}  (create DRAFT)
  router.post("/", async (req, res, next) => {
    try {
      const { lines = [], ...mainFieldsInput } = req.body;
      const docNo = await nextDocNo(prefix.toUpperCase(), seqName);
      const insertFields = mainFields.filter(f => !["id","doc_no","doc_type","status","created_at","updated_at"].includes(f));
      const colNames = ["doc_no", ...insertFields].join(", ");
      const placeholders = insertFields.map((_, i) => `$${i + 2}`).join(", ");
      const vals = insertFields.map(f => mainFieldsInput[f] ?? null).map((v, i) => {
        const f = insertFields[i];
        if (v === null && (f === 'created_by' || f === 'warehouse_operator_id')) return 1; // system default
        return v;
      });
      const r = await query(
        `INSERT INTO ${table} (${colNames}) VALUES ($1, ${placeholders}) RETURNING *`,
        [docNo, ...vals]
      );
      const doc = r.rows[0];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const lCols = lineFields.filter(f => f !== "id" && f !== fk && f !== "created_at" && f !== "line_status");
        const lVals = lCols.map(c => l[c] ?? null);
        await query(
          `INSERT INTO ${tableLines} (${fk}, ${lCols.join(", ")}, line_status) VALUES ($1, ${lCols.map((_,j)=>`$${j+2}`).join(", ")}, $${lCols.length+2})`,
          [doc.id, ...lVals, 'DRAFT']
        );
      }
      res.status(201).json(env(doc));
    } catch (err) { next(err); }
  });

  // PATCH /wms/{prefix}/:id  (update DRAFT only)
  router.patch("/:id", async (req, res, next) => {
    try {
      const curr = await query(`SELECT status FROM ${table} WHERE ${pk} = $1`, [req.params.id]);
      if (!curr.rows.length) return res.status(404).json(errEnv("NOT_FOUND", "Document not found"));
      if (curr.rows[0].status !== "DRAFT")
        return res.status(400).json(errEnv("INVALID_STATUS", "Only DRAFT documents can be edited"));
      const { lines = [], ...mainFieldsInput } = req.body;
      const updFields = mainFields.filter(f => !["id","doc_no","created_at","created_by"].includes(f));
      if (updFields.length) {
        const sets = updFields.map((f,i) => `${f} = $${i+2}`).join(", ");
        await query(`UPDATE ${table} SET ${sets}, updated_at = NOW() WHERE ${pk} = $1`,
          [req.params.id, ...updFields.map(f => mainFieldsInput[f] ?? null)]);
      }
      if (lines.length) {
        await query(`DELETE FROM ${tableLines} WHERE ${fk} = $1`, [req.params.id]);
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const lCols = lineFields.filter(f => f !== "id" && f !== fk && f !== "created_at" && f !== "line_status");
          const lVals = lCols.map(c => l[c] ?? null);
          await query(
          `INSERT INTO ${tableLines} (${fk}, ${lCols.join(", ")}, line_status) VALUES ($1, ${lCols.map((_,j)=>`$${j+2}`).join(", ")}, $${lCols.length+2})`,
            [req.params.id, ...lVals, 'DRAFT']
          );
        }
      }
      const updated = await query(`SELECT * FROM ${table} WHERE ${pk} = $1`, [req.params.id]);
      res.json(env(updated.rows[0]));
    } catch (err) { next(err); }
  });

  // DELETE /wms/{prefix}/:id  (DRAFT only)
  router.delete("/:id", async (req, res, next) => {
    try {
      const curr = await query(`SELECT status FROM ${table} WHERE ${pk} = $1`, [req.params.id]);
      if (!curr.rows.length) return res.status(404).json(errEnv("NOT_FOUND", "Document not found"));
      if (curr.rows[0].status !== "DRAFT")
        return res.status(400).json(errEnv("INVALID_STATUS", "Only DRAFT documents can be deleted"));
      await query(`DELETE FROM ${tableLines} WHERE ${fk} = $1`, [req.params.id]);
      await query(`DELETE FROM ${table} WHERE ${pk} = $1`, [req.params.id]);
      res.json(env({ success: true }));
    } catch (err) { next(err); }
  });

  // ── Lifecycle actions ────────────────────────────────────────────
  const action = (verb, targetStatus, extraCols = {}) => {
    router.post(`/${verb}/:id`, async (req, res, next) => {
      try {
        const curr = await query(`SELECT * FROM ${table} WHERE ${pk} = $1`, [req.params.id]);
        if (!curr.rows.length) return res.status(404).json(errEnv("NOT_FOUND", "Document not found"));
        const doc = curr.rows[0];
        if (!canTransition(tableKey, doc.status, targetStatus))
          return res.status(400).json(errEnv("INVALID_TRANSITION", `Cannot ${verb} from ${doc.status}`));
        const actor = req.user?.id?.toString() ?? "0";
        const setCols = ["status = $1", "updated_at = NOW()"];
        const v = [targetStatus];
        let p = 2;
        for (const [k, val] of Object.entries(extraCols)) {
          setCols.push(`${k} = $${p++}`);
          v.push(typeof val === "function" ? val(req, doc) : val);
        }
        await query(`UPDATE ${table} SET ${setCols.join(", ")} WHERE ${pk} = $${p}`, [...v, req.params.id]);
        if (targetStatus === "EXECUTING") {
          const lines = await query(`SELECT * FROM ${tableLines} WHERE ${fk} = $1`, [req.params.id]);
          await applyInventoryTx(doc, tableKey, lines.rows, actor);
        }
        const updated = await query(`SELECT * FROM ${table} WHERE ${pk} = $1`, [req.params.id]);
        res.json(env(updated.rows[0]));
      } catch (err) { next(err); }
    });
  };

  action("submit",   "SUBMITTED", { submitted_at: () => new Date() });
  action("approve",  "APPROVED",  { approved_at: () => new Date(), approved_by: (r) => { const n=Number(r.user?.id); return isNaN(n)?null:n; } });
  action("reject",   "REJECTED",  { rejected_at: () => new Date(), rejected_by: (r) => { const n=Number(r.user?.id); return isNaN(n)?null:n; }, rejection_reason: (r) => r.body?.reason });
  action("execute",  "EXECUTING", { executed_at: () => new Date(), executed_by: (r) => { const n=Number(r.user?.id); return isNaN(n)?null:n; } });
  action("complete", "COMPLETED", { completed_at: () => new Date(), completed_by: (r) => { const n=Number(r.user?.id); return isNaN(n)?null:n; } });
  action("cancel",   "CANCELLED", { cancelled_at: () => new Date(), cancelled_by: (r) => { const n=Number(r.user?.id); return isNaN(n)?null:n; } });

  return router;
}

// ── Column definitions matching actual DB migrations 062-066 ────────
const inboundFields    = ["id","doc_no","doc_type","status","supplier_id","supplier_code","supplier_name","warehouse_operator_id","warehouse_operator_name","submitted_at","approved_at","approved_by","rejected_at","rejected_by","rejection_reason","executed_at","completed_at","cancelled_at","cancelled_by","notes","created_by","created_at","updated_at"];
const inboundLineFields = ["id","inbound_order_id","material_id","material_code","material_name_zh","unit","requested_qty","approved_qqty","executed_qty","lot_no","location_code","location_name","line_status","remarks","created_at"];

const outboundFields    = ["id","doc_no","doc_type","status","work_order_code","work_order_id","requestor_id","requestor_name","warehouse_operator_id","warehouse_operator_name","submitted_at","approved_at","approved_by","rejected_at","rejected_by","rejection_reason","executed_at","completed_at","cancelled_at","cancelled_by","notes","created_by","created_at","updated_at"];
const outboundLineFields = ["id","outbound_order_id","material_id","material_code","material_name_zh","unit","requested_qty","approved_qty","executed_qty","lot_no","location_code","location_name","line_status","remarks","created_at"];

const reqFields        = ["id","doc_no","doc_type","status","work_order_code","work_order_id","line_code","requestor_id","requestor_name","approver_id","approver_name","warehouse_operator_id","warehouse_operator_name","submitted_at","approved_at","approved_by","rejected_at","rejected_by","rejection_reason","executed_at","completed_at","cancelled_at","cancelled_by","notes","created_by","created_at","updated_at"];
const reqLineFields    = ["id","requisition_id","material_id","material_code","material_name_zh","unit","requested_qty","approved_qty","executed_qty","lot_no","location_code","location_name","line_status","remarks","created_at"];

const retFields        = ["id","doc_no","doc_type","status","work_order_code","work_order_id","line_code","requestor_id","requestor_name","warehouse_operator_id","warehouse_operator_name","submitted_at","approved_at","approved_by","rejected_at","rejected_by","rejection_reason","executed_at","completed_at","cancelled_at","cancelled_by","notes","created_by","created_at","updated_at"];
const retLineFields   = ["id","return_slip_id","material_id","material_code","material_name_zh","unit","requested_qty","approved_qty","executed_qty","lot_no","location_code","location_name","line_status","remarks","created_at"];

const repFields        = ["id","doc_no","doc_type","status","work_order_code","work_order_id","original_requisition_id","reason_code","line_code","requestor_id","requestor_name","approver_id","approver_name","warehouse_operator_id","warehouse_operator_name","submitted_at","approved_at","approved_by","rejected_at","rejected_by","rejection_reason","executed_at","completed_at","cancelled_at","cancelled_by","notes","created_by","created_at","updated_at"];
const repLineFields   = ["id","replenishment_id","material_id","material_code","material_name_zh","unit","requested_qty","approved_qty","executed_qty","lot_no","location_code","location_name","line_status","remarks","created_at"];

const inboundRouter   = makeDocRouter({ table: "inbound_orders",   tableLines: "inbound_order_lines",    prefix: "inbound",        tableKey: "inbound_order",   mainFields: inboundFields,   lineFields: inboundLineFields,   seqName: "inbound_orders_seq" });
const outboundRouter  = makeDocRouter({ table: "outbound_orders",  tableLines: "outbound_order_lines",   prefix: "outbound",      tableKey: "outbound_order",  mainFields: outboundFields,  lineFields: outboundLineFields,  seqName: "outbound_orders_seq" });
const reqRouter       = makeDocRouter({ table: "requisitions",     tableLines: "requisition_lines",     prefix: "requisition",  tableKey: "requisition",    mainFields: reqFields,      lineFields: reqLineFields,      seqName: "requisitions_seq" });
const retRouter       = makeDocRouter({ table: "return_slips",     tableLines: "return_slip_lines",     prefix: "return",       tableKey: "return_slip",     mainFields: retFields,      lineFields: retLineFields,     seqName: "return_slips_seq" });
const repRouter       = makeDocRouter({ table: "replenishments",   tableLines: "replenishment_lines",   prefix: "replenishment",tableKey: "replenishment",  mainFields: repFields,      lineFields: repLineFields,     seqName: "replenishments_seq" });

export { inboundRouter, outboundRouter, reqRouter, retRouter, repRouter };
