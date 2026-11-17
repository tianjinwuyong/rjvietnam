import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "smt_factory_migration_test",
  max: 20,
});

const testAt = "2099-12-01T00:00:00Z";
const type = 3;
const line = "98";

try {
  await pool.query("DELETE FROM work_order_code_allocations WHERE yy='99' AND mm='12' AND work_order_type=$1 AND numeric_line_code=$2", [type, line]);
  await pool.query("DELETE FROM work_order_serial_counters WHERE yy='99' AND mm='12' AND work_order_type=$1 AND numeric_line_code=$2", [type, line]);

  const results = await Promise.all(Array.from({ length: 100 }, async () => {
    const result = await pool.query(
      "SELECT allocate_work_order_code($1::smallint,$2::char(2),NULL,$3::timestamptz) AS code",
      [type, line, testAt],
    );
    return String(result.rows[0].code).trim();
  }));

  const unique = new Set(results);
  if (unique.size !== 100) throw new Error(`Expected 100 unique codes, received ${unique.size}`);
  if (results.some((code) => !/^9912398\d{4}$/.test(code))) throw new Error("Malformed code allocated");

  console.log(JSON.stringify({ passed: true, requests: 100, unique: unique.size, first: [...unique].sort()[0], last: [...unique].sort().at(-1) }));
} finally {
  await pool.query("DELETE FROM work_order_code_allocations WHERE yy='99' AND mm='12' AND work_order_type=$1 AND numeric_line_code=$2", [type, line]);
  await pool.query("DELETE FROM work_order_serial_counters WHERE yy='99' AND mm='12' AND work_order_type=$1 AND numeric_line_code=$2", [type, line]);
  await pool.end();
}
