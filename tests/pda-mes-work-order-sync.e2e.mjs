import "dotenv/config";
import assert from "node:assert/strict";
import pg from "pg";

const API = process.env.TEST_API_URL ?? "http://127.0.0.1:8080";
const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "smt_factory", user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
});
const fixture = (await pool.query(`
  SELECT p.code AS product_code,b.id AS bom_id,pl.internal_code AS line_code
  FROM products p JOIN boms b ON b.product_id=p.id
  CROSS JOIN LATERAL (
    SELECT internal_code FROM production_lines
    WHERE internal_code='L001' LIMIT 1
  ) pl
  WHERE p.status='active' AND b.status='active'
  ORDER BY p.id,b.id DESC LIMIT 1
`)).rows[0];
assert.ok(fixture, "active product, BOM and SMT line L001 are required");

const loginResponse = await fetch(`${API}/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "蒙营", password: "my" }),
});
assert.equal(loginResponse.status, 200);
const token = (await loginResponse.json()).data.token;
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const createdResponse = await fetch(`${API}/pmc/work-orders`, {
  method: "POST", headers: auth,
  body: JSON.stringify({ payload: { workOrder: {
    woType: 2, productCode: fixture.product_code, lineCode: fixture.line_code,
    plannedQty: 10, bomId: fixture.bom_id, dueDate: "2026-12-31",
  } } }),
});
assert.equal(createdResponse.status, 201);
const created = (await createdResponse.json()).data.item;

const releaseResponse = await fetch(`${API}/pmc/work-orders/${created.code}`, {
  method: "PATCH", headers: auth,
  body: JSON.stringify({ payload: { status: "released", reason: "PDA MES synchronization verification" } }),
});
assert.equal(releaseResponse.status, 200);

const pdaResponse = await fetch(`${API}/api/smt/loading/work-orders?lineCode=${fixture.line_code}`);
assert.equal(pdaResponse.status, 200);
const pda = await pdaResponse.json();
const delivered = pda.data.find((item) => item.workOrderCode === created.code);
assert.ok(delivered, "released MES work order must be delivered to PDA");
assert.equal(delivered.productCode, fixture.product_code);
assert.equal(delivered.lineCode, fixture.line_code);

console.log(JSON.stringify({
  ok: true, workOrderCode: created.code, mesStatus: "released",
  pdaReceived: true, endpoint: "/api/smt/loading/work-orders",
}));
await pool.end();
