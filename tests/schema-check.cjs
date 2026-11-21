const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const c = await pool.connect();

  const cols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'stations' ORDER BY ordinal_position");
  console.log("stations columns:", cols.rows.map(r => r.column_name).join(', '));

  const idxs = await c.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'stations'");
  console.log("\nindexes:", idxs.rows.map(r => r.indexname + ': ' + r.indexdef).join('\n'));

  const lines = await c.query("SELECT id, code, internal_code FROM production_lines WHERE code = 'MANUAL-LINE'");
  console.log("\nMANUAL-LINE:", lines.rows);

  const types = await c.query("SELECT id, code, name_zh FROM station_types LIMIT 10");
  console.log("\nstation_types:", types.rows);

  await c.release();
  await pool.end();
  console.log("\nDONE");
})().catch(e => { console.error(e.message); process.exit(1); });
