const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
async function main() {
  const client = await pool.connect();
  const loaded = await client.query(`SELECT COUNT(*) as c FROM material_dispatch_assignments WHERE dispatch_session_id=4 AND status='loaded'`);
  const pending = await client.query(`SELECT COUNT(*) as c FROM material_dispatch_assignments WHERE dispatch_session_id=4 AND status='pending'`);
  console.log('DB state - loaded:', loaded.rows[0].c, '| pending:', pending.rows[0].c);
  await client.release();
  await pool.end();
}
main().catch(e => console.error(e.message));
