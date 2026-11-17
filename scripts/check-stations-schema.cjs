const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  const types = await p.query(`SELECT * FROM station_types WHERE id IN (249,250,251,14,61) ORDER BY id`);
  console.log('station_types:', JSON.stringify(types.rows, null, 2));
  const lines = await p.query(`SELECT * FROM production_lines LIMIT 5`);
  console.log('production_lines:', JSON.stringify(lines.rows, null, 2));
  const existing = await p.query(`SELECT code FROM stations WHERE code IN ('ASSY-ATE-01','AGING-01','CARTON-BIND-01')`);
  console.log('existing:', JSON.stringify(existing.rows, null, 2));
  await p.end();
}
main().catch(e => { console.error(e); p.end(); });
