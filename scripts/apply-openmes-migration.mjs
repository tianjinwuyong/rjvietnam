import fs from "node:fs";
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "smt_factory",
  password: process.env.PGPASSWORD ?? "smt_factory",
  database: process.env.PGDATABASE ?? "smt_factory",
});
const sql = fs.readFileSync("database/migrations/238_openmes_integration_sync.sql", "utf8");
try {
  await pool.query("BEGIN");
  await pool.query(sql);
  await pool.query("INSERT INTO _migrations(filename,hash) VALUES($1,$2) ON CONFLICT(filename) DO NOTHING", ["238_openmes_integration_sync.sql", "manual-openmes-v1"]);
  await pool.query("COMMIT");
  console.log("238_openmes_integration_sync.sql applied");
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}
