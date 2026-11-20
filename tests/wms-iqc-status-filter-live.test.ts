import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase = process.env.WMS_API_BASE;
const live = process.env.RUN_IQC_FILTER_LIVE === "1" && Boolean(apiBase);
const { Pool } = pg;

type List = { rows: any[]; total: number };

// POST /api/qms/iqc/inspections is what moves a lot to 'rejected'; this covers the
// read side: rejected stock has to be reachable through the API, not only through
// the database. Before the iqc_status predicate existed, any status value returned
// the whole unfiltered page and its unfiltered total.
describe.skipIf(!live)("raw material inventory is filterable by IQC status", () => {
  const pool = new Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "smt_factory" });

  const login = async (): Promise<string> => {
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "Factory@123" }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as any;
    expect(body.data?.token).toBeTruthy();
    return body.data.token as string;
  };

  const getList = async (token: string, params = ""): Promise<List> => {
    const res = await fetch(`${apiBase}/wms/raw-material-inventory${params}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as any;
    return { rows: body.data?.items ?? [], total: Number(body.data?.total ?? 0) };
  };

  it("returns only the requested status, and its total matches PostgreSQL", async () => {
    const token = await login();

    const unfiltered = await getList(token);
    expect(unfiltered.rows.length).toBeLessThanOrEqual(unfiltered.total);
    for (const row of unfiltered.rows) {
      expect(["pending", "released", "rejected"]).toContain(String(row.iqc_status));
    }

    for (const status of ["rejected", "pending", "released"]) {
      const filtered = await getList(token, `?iqc_status=${status}&limit=500`);
      expect(filtered.rows.every((row) => String(row.iqc_status) === status)).toBe(true);
      const dbTotal = (await pool.query(
        `SELECT count(*)::int AS total FROM v_wms_raw_material_inventory WHERE iqc_status=$1`,
        [status],
      )).rows[0].total;
      expect(filtered.total).toBe(dbTotal);
    }

    // A status nobody uses must be empty rather than "everything".
    const none = await getList(token, "?iqc_status=__none__");
    expect(none.rows).toHaveLength(0);
    expect(none.total).toBe(0);
  });

  it("keeps the rejected lot visible in the full list it belongs to", async () => {
    const token = await login();
    const rejected = await getList(token, "?iqc_status=rejected&limit=500");
    if (!rejected.rows.length) return; // nothing has been rejected in this database yet
    const wanted = String(rejected.rows[0].material_lot_id);
    const page = await getList(token, "?limit=500");
    expect(page.rows.map((row) => String(row.material_lot_id))).toContain(wanted);
  });

  it("still pages: a small limit shortens the page, not the total", async () => {
    const token = await login();
    const first = await getList(token, "?limit=5");
    const second = await getList(token, "?limit=5&offset=5");
    expect(first.rows.length).toBeLessThanOrEqual(5);
    expect(second.total).toBe(first.total);
    const ids = new Set([...first.rows, ...second.rows].map((row) => String(row.material_lot_id)));
    expect(ids.size).toBe(first.rows.length + second.rows.length);
  });

  it("counts rejected stock the same way the material_lots table does", async () => {
    const token = await login();
    const rejected = await getList(token, "?iqc_status=rejected&limit=500");
    const dbRejected = (await pool.query(
      `SELECT count(*)::int AS total FROM material_lots WHERE iqc_status='rejected'`,
    )).rows[0].total;
    // The view only counts RAW_MATERIAL warehouses, so the API may legitimately see fewer.
    expect(rejected.total).toBeLessThanOrEqual(dbRejected);
    for (const row of rejected.rows) {
      const lot = (await pool.query(`SELECT iqc_status FROM material_lots WHERE id=$1`, [row.material_lot_id])).rows[0];
      expect(lot?.iqc_status).toBe("rejected");
    }
  });
});
