const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const c = await pool.connect();

  // Find line_id for MANUAL-LINE
  const lineR = await c.query("SELECT id FROM production_lines WHERE code = 'MANUAL-LINE' LIMIT 1");
  const lineId = lineR.rows[0]?.id;
  console.log("MANUAL-LINE line_id:", lineId);
  if (!lineId) { console.log("MANUAL-LINE not found!"); await c.release(); await pool.end(); return; }

  // Find station_type_id for the missing stations
  const typeR = await c.query("SELECT id FROM station_types WHERE code = 'MAN_ICT' LIMIT 1");
  const typeId = typeR.rows[0]?.id;
  console.log("MAN_ICT type_id:", typeId);

  // Insert missing stations
  const missing = [
    { code: 'ASSY-ATE-01', name_zh: '组装ATE-01' },
    { code: 'AGING-01', name_zh: '老化-01' },
    { code: 'CARTON-BIND-01', name_zh: '卡通绑定-01' },
  ];

  for (const st of missing) {
    try {
      const ins = await c.query(
        `INSERT INTO stations (code, name_zh, line_id, station_type_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (line_id, code) DO NOTHING RETURNING id`,
        [st.code, st.name_zh, lineId, typeId]
      );
      if (ins.rows.length > 0) console.log("Inserted:", st.code, "id=", ins.rows[0].id);
      else console.log("Already exists (or no type):", st.code);
    } catch(e) {
      console.log("Error inserting", st.code + ":", e.message);
    }
  }

  await c.release();
  await pool.end();
  console.log("DONE");
})().catch(e => { console.error(e.message); process.exit(1); });
