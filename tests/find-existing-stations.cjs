const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const c = await pool.connect();

  // Find stations in station_sequences for MANUAL-LINE that also exist in stations table
  const r = await c.query(`
    SELECT ss.station_code, ss.sequence_order
    FROM station_sequences ss
    JOIN stations s ON s.code = ss.station_code
    WHERE ss.line_code = 'MANUAL-LINE'
    ORDER BY ss.sequence_order
  `);
  console.log("MANUAL-LINE stations in stations table:");
  r.rows.forEach(row => console.log("  seq=" + row.sequence_order + " " + row.station_code));

  // Also show which ones are missing from stations table
  const missing = await c.query(`
    SELECT ss.station_code, ss.sequence_order
    FROM station_sequences ss
    LEFT JOIN stations s ON s.code = ss.station_code
    WHERE ss.line_code = 'MANUAL-LINE' AND s.code IS NULL
    ORDER BY ss.sequence_order
  `);
  console.log("\nMANUAL-LINE stations NOT in stations table (missing):");
  missing.rows.forEach(row => console.log("  seq=" + row.sequence_order + " " + row.station_code));

  await c.release();
  await pool.end();
  console.log("\nDONE");
})().catch(e => { console.error(e.message); process.exit(1); });
