import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase = process.env.SALES_API_BASE || "http://127.0.0.1:8080";
const live = process.env.RUN_SALES_CLOSED_LOOP_LIVE === "1";

describe.skipIf(!live)("Sales order end-to-end closed loop", () => {
  it("drives open → confirmed → released → shipped → delivered → invoiced → paid → closed", async () => {
    const db = new pg.Pool({ host: "127.0.0.1", database: "smt_factory", user: "postgres", password: "postgres" });
    const login = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "Factory@123" }),
    });
    expect(login.ok).toBe(true);
    const token = (await login.json() as any).data.token;
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

    const fixture = (
      await db.query(
        `SELECT c.id customer_id, p.id product_id, cur.code currency,
                l.id line_id, l.numeric_line_code
         FROM customers c
         JOIN products p ON true
         JOIN boms b ON b.product_id = p.id AND b.status = 'active'
         JOIN currencies cur ON true
         CROSS JOIN LATERAL (SELECT id, numeric_line_code FROM production_lines ORDER BY id LIMIT 1) l
         ORDER BY c.id, p.id LIMIT 1`
      )
    ).rows[0];
    expect(fixture, "need a customer, an active-BOM product, a currency and a production line").toBeTruthy();

    let soId: number | undefined;
    try {
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`${apiBase}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
        const json = (await response.json()) as any;
        expect(response.ok, JSON.stringify(json)).toBe(true);
        return json.data;
      };
      const get = async (path: string) => {
        const response = await fetch(`${apiBase}${path}`, { headers });
        const json = (await response.json()) as any;
        expect(response.ok, JSON.stringify(json)).toBe(true);
        return json.data;
      };

      const created = await post("/api/sales/orders", {
        customer_id: fixture.customer_id,
        currency: fixture.currency,
        lines: [{ product_id: fixture.product_id, qty: 10, unit_price: 100 }],
      });
      soId = Number(created.id);
      expect(created.status).toBe("open");

      const confirmed = await post(`/api/sales/orders/${soId}/confirm`, {});
      expect(confirmed.workOrders.length).toBeGreaterThanOrEqual(1);

      await post(`/api/sales/orders/${soId}/release`, {});
      await post(`/api/sales/orders/${soId}/ship`, {});
      await post(`/api/sales/orders/${soId}/deliver`, {});

      const invoiced = await post(`/api/sales/orders/${soId}/invoice`, {});
      expect(invoiced.invoice).toBeTruthy();

      await post(`/api/sales/orders/${soId}/pay`, {});
      await post(`/api/sales/orders/${soId}/close`, {});

      const so = await get(`/api/sales/orders/${soId}`);
      expect(so.status).toBe("closed");

      const history = await get(`/api/sales/orders/${soId}/history`);
      expect(history.history.length).toBeGreaterThanOrEqual(7);

      const inv = (
        await db.query(`SELECT id FROM ar_invoices WHERE sales_order_id = $1`, [soId])
      ).rows[0];
      expect(inv, "ar_invoice must be linked to the sales order").toBeTruthy();

      const wo = (
        await db.query(`SELECT id FROM work_orders WHERE sales_order_id = $1`, [soId])
      ).rows[0];
      expect(wo, "work order must be linked to the sales order").toBeTruthy();
    } finally {
      if (soId) {
        await db.query("DELETE FROM ar_invoices WHERE sales_order_id = $1", [soId]);
        await db.query(
          "DELETE FROM work_order_number_audit WHERE work_order_id IN (SELECT id FROM work_orders WHERE sales_order_id = $1)",
          [soId]
        );
        await db.query(
          "DELETE FROM work_order_code_allocations WHERE work_order_id IN (SELECT id FROM work_orders WHERE sales_order_id = $1)",
          [soId]
        );
        await db.query("DELETE FROM work_orders WHERE sales_order_id = $1", [soId]);
        await db.query("DELETE FROM sales_order_lines WHERE so_id = $1", [soId]);
        await db.query("DELETE FROM sales_order_status_history WHERE so_id = $1", [soId]);
        await db.query("DELETE FROM sales_orders WHERE id = $1", [soId]);
      }
      await db.end();
    }
  });
});
