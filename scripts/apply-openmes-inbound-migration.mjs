import fs from "node:fs";
import pg from "pg";
const pool = new pg.Pool({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "smt_factory", password: process.env.PGPASSWORD ?? "smt_factory", database: process.env.PGDATABASE ?? "smt_factory" });
try {
  await pool.query("BEGIN");
  await pool.query(fs.readFileSync("database/migrations/239_openmes_inbound_events.sql", "utf8"));
  await pool.query("INSERT INTO _migrations(filename,hash) VALUES($1,$2) ON CONFLICT(filename) DO NOTHING", ["239_openmes_inbound_events.sql", "manual-openmes-v1"]);
  await pool.query("COMMIT");
  console.log("239_openmes_inbound_events.sql applied");
} catch (error) { await pool.query("ROLLBACK"); throw error; } finally { await pool.end(); }
