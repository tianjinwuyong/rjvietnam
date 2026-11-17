const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
c.connect().then(async () => {
  const tables = ['role_permissions','permissions','process_routes','process_route_steps','customer_po_lines','stations','materials','products','material_lots','storage_locations','users','roles','boms','bom_lines','customer_pos','production_lines','alert_rules','alerts'];
  for (const t of tables) {
    try {
      const r = await c.query('SELECT count(*)::int as cnt FROM ' + t);
      console.log(t + ': ' + r.rows[0].cnt);
    } catch(e) {
      console.log(t + ': ERROR - ' + e.message.split('\n')[0]);
    }
  }
  c.end();
}).catch(e => console.error('FAIL:', e.message));