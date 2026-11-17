import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "smt_factory",
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
});

const count = await pool.query("SELECT COUNT(*)::int count FROM work_orders");
const refs = await pool.query(`
  SELECT tc.table_name, kcu.column_name, rc.delete_rule, tc.constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name=tc.constraint_name AND rc.constraint_schema=tc.constraint_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
  WHERE tc.constraint_type='FOREIGN KEY'
    AND ccu.table_name='work_orders'
  ORDER BY tc.table_name,kcu.column_name
`);
console.log(JSON.stringify({ workOrders: count.rows[0].count, references: refs.rows }, null, 2));
await pool.end();
