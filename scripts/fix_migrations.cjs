const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  // Mark 066 as applied (station data already exists from add_stations.cjs)
  await p.query(`INSERT INTO _migrations (filename, hash) VALUES ('066_factory_stations_add.sql', '40d68197') ON CONFLICT DO NOTHING`);
  console.log('Marked 066 as applied');

  // Apply 067 (make work_order_id nullable)
  await p.query(`ALTER TABLE pcb_serials ALTER COLUMN work_order_id DROP NOT NULL`);
  console.log('Made work_order_id nullable in pcb_serials');

  await p.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
