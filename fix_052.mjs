import pg from "pg";
import { readFileSync } from "node:fs";

const pool = new pg.Pool({
  host: "127.0.0.1",
  port: 5432,
  database: "smt_factory",
  user: "smt_factory",
  password: "smt_factory",
});

async function fix() {
  // 1. Check if bom_id column exists
  const col = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'work_orders' AND column_name = 'bom_id'"
  );
  if (col.rows.length === 0) {
    console.log("Adding bom_id column to work_orders...");
    await pool.query("ALTER TABLE work_orders ADD COLUMN bom_id bigint REFERENCES boms(id)");
    await pool.query("CREATE INDEX IF NOT EXISTS idx_work_orders_bom_id ON work_orders(bom_id)");
    console.log("Column added with index.");
  } else {
    console.log("Column bom_id already exists, skipping.");
  }

  // 2. Apply 052
  const sql = readFileSync("./database/migrations/052_fix_wo_bom_linkage.sql", "utf8");
  console.log("Running 052_fix_wo_bom_linkage.sql...");
  await pool.query(sql);
  console.log("Migration 052 applied successfully.");

  await pool.end();
}

fix().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
