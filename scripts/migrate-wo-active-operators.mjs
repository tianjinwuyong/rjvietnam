import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});

async function migrate() {
  const client = await pool.connect();
  try {
    // Check if active_operators column exists
    const col = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'work_orders' AND column_name = 'active_operators'`
    );
    if (col.rows.length > 0) {
      console.log("[OK] active_operators column already exists");
    } else {
      await client.query(
        `ALTER TABLE work_orders ADD COLUMN active_operators TEXT[] NOT NULL DEFAULT '{}'`
      );
      console.log("[OK] active_operators column added");
    }
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_wo_active_operators ON work_orders USING GIN (active_operators)`
    );
    console.log("[OK] GIN index created");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error(e.message); process.exit(1); });
