const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const c = await pool.connect();

  // Check MANUAL-LINE line_id
  const lineR = await c.query("SELECT id FROM production_lines WHERE code = 'MANUAL-LINE'");
  const lineId = lineR.rows[0]?.id;
  console.log("MANUAL-LINE id:", lineId);

  // Check what station_types exist
  const typesR = await c.query("SELECT id, code FROM station_types");
  console.log("station_types:", typesR.rows.map(r => r.code + '=' + r.id).join(', '));

  // Check if missing stations already exist
  const existing = await c.query("SELECT code, line_id FROM stations WHERE code IN ('ASSY-ATE-01', 'AGING-01', 'CARTON-BIND-01')");
  console.log("\nExisting:", existing.rows);

  // Check if there's a unique constraint on (line_id, code)
  const cons = await c.query("SELECT conname FROM pg_constraint WHERE conrelid = 'stations'::regclass");
  console.log("\nstations constraints:", cons.rows.map(r => r.conname).join(', '));

  await c.release();
  await pool.end();
  console.log("\nDONE");
})().catch(e => { console.error(e.message); process.exit(1); });
