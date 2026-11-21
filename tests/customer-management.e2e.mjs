import "dotenv/config";
import assert from "node:assert/strict";
import pg from "pg";

const API = process.env.TEST_API_URL ?? "http://127.0.0.1:8080";
const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "smt_factory", user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
});
const code = `TESTC${Date.now().toString().slice(-8)}`;
let customerId;

async function call(path, method = "GET", token = "", payload) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify({ payload }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "蒙营", password: "my" }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.token;

  const created = await call("/erp/customers", "POST", token, {
    code, nameZh: `测试客户${code}`, email: `${code.toLowerCase()}@example.test`,
    contactName: "测试联系人", paymentTermsDays: 30, riskLevel: "MEDIUM",
  });
  assert.equal(created.status, 201);
  customerId = created.body.data.item.id;
  assert.equal(created.body.data.item.lifecycleStatus, "DRAFT");

  const duplicate = await call("/erp/customers", "POST", token, {
    code: `${code}X`, nameZh: `测试客户${code}`,
  });
  assert.equal(duplicate.status, 409, "duplicate customer name must be blocked");

  const products = await call("/erp/products", "GET", token);
  const product = products.body.data.items.find((item) => item.code === "EPS18R1G-36");
  assert.ok(product);
  const blockedPo = await call("/erp/customer-pos", "POST", token, {
    poNumber: `TEST-PO-${code}`, customerId, productId: product.id, orderQty: 1, dueDate: "2026-12-31",
  });
  assert.equal(blockedPo.status, 400, "draft customer must not create PO");

  assert.equal((await call(`/erp/customers/${customerId}/transition`, "POST", token, { action: "submit", reason: "资料完整" })).status, 200);
  assert.equal((await call(`/erp/customers/${customerId}/transition`, "POST", token, { action: "approve", reason: "经理批准" })).status, 200);

  const list = await call("/erp/customers", "GET", token);
  const active = list.body.data.items.find((item) => item.id === customerId);
  assert.equal(active.lifecycleStatus, "ACTIVE");
  assert.equal(active.status, "active");

  const audit = await call(`/erp/customers/${customerId}/audit`, "GET", token);
  assert.ok(audit.body.data.items.length >= 3);
  assert.deepEqual(audit.body.data.items.slice(0, 2).map((item) => item.toStatus), ["ACTIVE", "PENDING_APPROVAL"]);

  assert.equal((await call(`/erp/customers/${customerId}/transition`, "POST", token, { action: "hold", reason: "测试冻结" })).status, 200);
  assert.equal((await call(`/erp/customers/${customerId}/transition`, "POST", token, { action: "reactivate", reason: "测试恢复" })).status, 200);
  assert.equal((await call(`/erp/customers/${customerId}/transition`, "POST", token, { action: "archive", reason: "测试归档" })).status, 200);

  console.log(JSON.stringify({ ok: true, customer: code, duplicateBlocked: true, poGateBlockedDraft: true, auditRecorded: true }));
} finally {
  if (customerId) {
    await pool.query("DELETE FROM erp_customer_audit WHERE customer_id=$1", [customerId]);
    await pool.query("DELETE FROM customers WHERE id=$1", [customerId]);
  }
  await pool.end();
}
