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
    // Check if repair_status column exists
    const col = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ng_defect_records' AND column_name = 'repair_status'`
    );
    if (col.rows.length > 0) {
      console.log('[OK] repair_status column already exists');
    } else {
      await client.query(
        `ALTER TABLE ng_defect_records ADD COLUMN repair_status varchar(20) NOT NULL DEFAULT 'pending'`
      );
      console.log('[OK] repair_status column added');
    }
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_ng_repair_status ON ng_defect_records(repair_status, occurred_at DESC)`
    );
    console.log('[OK] index created');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error(e.message); process.exit(1); });
