const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const c = await pool.connect();

  try {
    const r = await c.query("SELECT id FROM production_lines WHERE code = 'MANUAL-LINE'");
    console.log("MANUAL-LINE id:", r.rows[0]?.id);
  } catch(e) {
    console.log("Error getting line:", e.message);
  }

  try {
    const r2 = await c.query("SELECT id FROM station_types WHERE code = 'MAN_ICT'");
    console.log("MAN_ICT type:", r2.rows[0]);
  } catch(e) {
    console.log("Error getting type:", e.message);
  }

  try {
    const r3 = await c.query("SELECT id, code FROM station_types LIMIT 5");
    console.log("station_types sample:", r3.rows);
  } catch(e) {
    console.log("Error getting types:", e.message);
  }

  await c.release();
  await pool.end();
  console.log("DONE");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
