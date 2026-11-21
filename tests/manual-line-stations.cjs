const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const c = await pool.connect();
  const r = await c.query("SELECT station_code, sequence_order FROM station_sequences WHERE line_code = 'MANUAL-LINE' ORDER BY sequence_order");
  console.log("MANUAL-LINE stations:");
  r.rows.forEach(row => console.log("  seq=" + row.sequence_order + " " + row.station_code));
  await c.release();
  await pool.end();
  console.log("DONE");
})().catch(e => { console.error(e.message); process.exit(1); });
