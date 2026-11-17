import assert from "node:assert/strict";
import pg from "pg";

const code = "26072019999";
const machine = "VTEST-SMT-BYPASS";
const feeder = "VTEST-SMT-BYPASS-FD";
const client = new pg.Client({
  host: "127.0.0.1", user: "postgres", password: "postgres", database: "smt_factory"
});

async function cleanup() {
  await client.query("DELETE FROM smt_loading_audit WHERE session_id IN (SELECT id FROM smt_loading_sessions WHERE work_order_code=$1)", [code]);
  await client.query("DELETE FROM feeder_binding_events WHERE work_order_code=$1", [code]);
  await client.query("DELETE FROM smt_loading_sessions WHERE work_order_code=$1", [code]);
  await client.query("DELETE FROM machine_slots WHERE machine_code=$1", [machine]);
  await client.query("DELETE FROM feeders WHERE feeder_code=$1", [feeder]);
  await client.query("DELETE FROM work_orders WHERE code=$1", [code]);
}

await client.connect();
try {
  await cleanup();
  const columns = (await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='work_orders' AND column_name<>'id'
    ORDER BY ordinal_position
  `)).rows.map(row => row.column_name);
  const expressions = columns.map(column => ({
    code: "$1", planned_qty: "1", completed_qty: "0", status: "'released'",
    released_at: "now()", closed_at: "NULL", created_at: "now()"
  }[column] || `"${column}"`));
  await client.query(
    `INSERT INTO work_orders(${columns.map(c => `"${c}"`).join(",")})
     SELECT ${expressions.join(",")} FROM work_orders WHERE code='26072010004'`,
    [code]
  );
  const material = (await client.query(`
    SELECT m.code FROM work_orders wo
    JOIN bom_lines bl ON bl.bom_id=wo.bom_id JOIN materials m ON m.id=bl.material_id
    WHERE wo.code=$1 ORDER BY m.code LIMIT 1
  `, [code])).rows[0].code;
  await client.query(
    "INSERT INTO feeders(feeder_code,feeder_type,width_mm,status) VALUES($1,'SMT','8mm','available')",
    [feeder]
  );
  await client.query(
    `INSERT INTO machine_slots(machine_code,slot_no,slot_type,expected_material_code,feeder_width)
     VALUES($1,'F001','SMT',$2,'8mm')`,
    [machine, material]
  );
  const started = await fetch("http://127.0.0.1:8080/api/smt/loading/start", {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({payload: {
      workOrderCode: code, lineCode: "L001", machineCode: machine,
      operatorBadge: "PDA-L001", deviceId: "REGRESSION"
    }})
  }).then(r => r.json());
  const response = await fetch("http://127.0.0.1:8080/api/smt/loading/bind", {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({payload: {
      sessionId: started.data.id, machineCode: machine, slotNo: "F001",
      feederCode: feeder, materialSn: "VTEST-NO-REAL-LOT", materialCode: material,
      qty: 1, operatorBadge: "PDA-L001", testBypassAllChecks: true,
      testBypassReason: "regression", testBypassAuthorizedBy: "RJ033",
      testBypassedActions: ["MATERIAL_APPROVAL"], deferWoApproval: false
    }})
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.data.status, "active");
  assert.equal(body.data.allMaterialsBound, true);
  const pending = await client.query(
    "SELECT COUNT(*)::int n FROM feeder_binding_events WHERE work_order_code=$1 AND status='pending_approval'",
    [code]
  );
  assert.equal(pending.rows[0].n, 0);
  console.log(JSON.stringify({ok: true, status: body.data.status, pendingApproval: 0}));
} finally {
  await cleanup();
  await client.end();
}
