const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
c.connect().then(async () => {
  // Find key stations on L001 (line_id=5)
  const r = await c.query("SELECT id, code, line_id FROM stations WHERE code IN ('ICT-01','FCT-01','AOI-01','LASER-01','SN-BIND-01','AI1-01','SPI-01','NXT-01','REFLOW-01') AND line_id = 5 ORDER BY code");
  console.log('Stations on L001 (id=5):');
  r.rows.forEach(row => console.log(' ', row.code, 'id='+row.id));
  c.end();
}).catch(e => console.error(e.message));