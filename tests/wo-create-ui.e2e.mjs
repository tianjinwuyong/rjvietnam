import "dotenv/config";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";

const WEB = process.env.TEST_WEB_URL ?? "http://192.168.6.155:5178/";
const API = process.env.TEST_API_URL ?? "http://192.168.6.155:8080";
const tag = `UIWO${Date.now().toString().slice(-9)}`;
const poNumber = `TEST-PO-${tag}`;
const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "smt_factory",
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
});
let poId = null;
let workOrderId = null;

async function cleanup() {
  if (!poId) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM work_order_number_audit WHERE work_order_id IN
       (SELECT id FROM work_orders WHERE customer_po_id=$1)`,
      [poId],
    );
    await client.query(
      `DELETE FROM work_order_code_allocations WHERE work_order_id IN
       (SELECT id FROM work_orders WHERE customer_po_id=$1)`,
      [poId],
    );
    await client.query("DELETE FROM work_orders WHERE customer_po_id=$1", [poId]);
    await client.query("DELETE FROM pmc_po_closure_audit WHERE customer_po_id=$1", [poId]);
    await client.query("DELETE FROM pmc_po_closure_decisions WHERE customer_po_id=$1", [poId]);
    await client.query("DELETE FROM customer_pos WHERE id=$1", [poId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));

try {
  const fixture = (await pool.query(
    `SELECT c.id customer_id,p.id product_id,p.code product_code,
            pl.internal_code line_code,b.id bom_id
       FROM customers c CROSS JOIN products p CROSS JOIN production_lines pl
       JOIN boms b ON b.product_id=p.id
      WHERE c.status='active' AND p.status='active'
      ORDER BY b.id LIMIT 1`,
  )).rows[0];
  assert.ok(fixture, "active customer/product/line/BOM fixture required");

  const loginResponse = await page.request.post(`${API}/auth/login`, {
    data: { username: "蒙营", password: "my" },
  });
  assert.equal(loginResponse.status(), 200);
  const login = await loginResponse.json();
  const token = login.data.token;

  const poResponse = await page.request.post(`${API}/erp/customer-pos`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      payload: {
        poNumber,
        customerId: fixture.customer_id,
        productId: fixture.product_id,
        orderQty: 8,
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      },
    },
  });
  assert.equal(poResponse.status(), 201, await poResponse.text());
  poId = (await poResponse.json()).data.item.id;

  await page.goto(WEB, { waitUntil: "networkidle", timeout: 30_000 });
  await page.locator("input[type=text]").first().fill("蒙营");
  await page.locator("input[type=password]").first().fill("my");
  await page.locator("form button[type=submit]").click();
  await page.getByRole("button", { name: /PMC 工单|PMC Orders/i }).click();
  await page.getByRole("button", { name: /创建工单|Create Work Order/i }).click();

  const form = page.locator("form");
  await form.locator("input[type=text]").fill(fixture.product_code);
  await page.waitForTimeout(800);
  const selects = form.locator("select");
  await selects.nth(0).selectOption(fixture.line_code);
  await selects.nth(1).selectOption(String(fixture.bom_id));
  await selects.nth(2).selectOption(String(poId));
  await selects.nth(3).selectOption("1");
  await form.locator("input[type=number]").fill("8");
  await form.locator("input[type=date]").fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));

  const createResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/pmc/work-orders") && response.request().method() === "POST",
  );
  await form.locator("button[type=submit]").click();
  const createResponse = await createResponsePromise;
  const createPayload = await createResponse.json();
  assert.equal(createResponse.status(), 201, JSON.stringify(createPayload));
  const code = createPayload.data.item.code;
  await page.getByText(code, { exact: true }).waitFor({ timeout: 10_000 });

  const row = (await pool.query(
    `SELECT id,code,status,customer_po_id,planned_qty,bom_id
       FROM work_orders WHERE code=$1`,
    [code],
  )).rows[0];
  assert.ok(row);
  workOrderId = row.id;
  assert.equal(row.status, "draft");
  assert.equal(String(row.customer_po_id), String(poId));
  assert.equal(Number(row.planned_qty), 8);
  assert.equal(String(row.bom_id), String(fixture.bom_id));
  assert.deepEqual(browserErrors, [], browserErrors.join(" | "));

  console.log(JSON.stringify({
    ok: true,
    login: "蒙营",
    poNumber,
    workOrderCode: code,
    status: row.status,
    uiCreated: true,
    cleanedAfterTest: true,
  }, null, 2));
} finally {
  await browser.close();
  await cleanup();
  const leftovers = Number((await pool.query(
    `SELECT COUNT(*) count FROM customer_pos WHERE po_number=$1`,
    [poNumber],
  )).rows[0].count);
  assert.equal(leftovers, 0, "UI WO test data must be removed");
  await pool.end();
}
