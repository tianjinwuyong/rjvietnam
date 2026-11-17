import "dotenv/config";
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "smt_factory",
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
});
const client = await pool.connect();
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;

try {
  const workOrders = (await client.query("SELECT * FROM work_orders ORDER BY id")).rows;
  const backupDir = resolve("backups");
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = resolve(backupDir, `work-orders-before-delete-${stamp}.json`);
  await writeFile(backupPath, JSON.stringify(workOrders, null, 2), "utf8");

  if (!workOrders.length) {
    console.log(JSON.stringify({ deletedWorkOrders: 0, backupPath }));
    process.exitCode = 0;
  } else {
    const ids = workOrders.map((row) => row.id);
    const refs = (await client.query(`
      SELECT DISTINCT ns.nspname AS schema_name, rel.relname AS table_name,
             att.attname AS column_name, patt.attname AS parent_column,
             con.confdeltype AS delete_rule
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      JOIN pg_class parent ON parent.oid=con.confrelid
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum,ord) ON true
      JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk(attnum,ord) ON pk.ord=ck.ord
      JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=ck.attnum
      JOIN pg_attribute patt ON patt.attrelid=con.confrelid AND patt.attnum=pk.attnum
      WHERE con.contype='f' AND parent.relname='work_orders'
        AND ns.nspname='public'
      ORDER BY rel.relname,att.attname
    `)).rows;

    await client.query("BEGIN");
    const affected = [];
    const closureCases = await client.query(
      `SELECT id FROM wms_closure_cases
        WHERE work_order_id=ANY($1::bigint[])`,
      [ids],
    );
    if (closureCases.rows.length) {
      const caseIds = closureCases.rows.map((row) => row.id);
      const auditDelete = await client.query(
        `DELETE FROM wms_closed_loop_audit WHERE case_id=ANY($1::bigint[])
          OR handover_id IN(SELECT id FROM wms_custody_handovers WHERE case_id=ANY($1::bigint[]))`,
        [caseIds],
      );
      if (auditDelete.rowCount) affected.push({ table: "wms_closed_loop_audit", rows: auditDelete.rowCount });
      for (const table of ["wms_inventory_freezes", "wms_closure_approvals", "wms_custody_handovers"]) {
        const result = await client.query(`DELETE FROM ${quote(table)} WHERE case_id=ANY($1::bigint[])`, [caseIds]);
        if (result.rowCount) affected.push({ table, rows: result.rowCount });
      }
    }
    for (const ref of refs) {
      if (ref.delete_rule === "c") continue;
      const useCode = ref.parent_column === "code";
      const values = useCode ? workOrders.map((row) => row.code) : ids;
      const cast = useCode ? "text[]" : "bigint[]";
      const sql = `DELETE FROM ${quote(ref.schema_name)}.${quote(ref.table_name)}
        WHERE ${quote(ref.column_name)}=ANY($1::${cast})`;
      const result = await client.query(sql, [values]);
      if (result.rowCount) affected.push({ table: ref.table_name, rows: result.rowCount });
    }
    const deleted = await client.query("DELETE FROM work_orders RETURNING id,code");
    await client.query("COMMIT");
    const remaining = await client.query("SELECT COUNT(*)::int count FROM work_orders");
    console.log(JSON.stringify({
      deletedWorkOrders: deleted.rowCount,
      deletedCodes: deleted.rows.map((row) => row.code),
      relatedRowsDeleted: affected,
      remainingWorkOrders: remaining.rows[0].count,
      backupPath,
    }, null, 2));
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
