const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
c.connect().then(async () => {
  const tables = [
    'users','roles','permissions','role_permissions',
    'products','production_lines','stations',
    'material_lots','storage_locations','inventory_transactions',
    'boms','bom_lines','work_orders',
    'process_routes','process_route_steps',
    'customer_pos','customer_po_lines',
    'quality_inspections','ng_defect_records',
    'pcb_serials','traceability_events','sn_duplicate_attempts','sn_binding_records',
    'product_stagnation_logs','product_scraps',
    'fool_proof_rules','first_article_inspections','first_article_check_items','material_verifications',
    'defect_codes','alerts','alert_rules','audit_logs'
  ];
  console.log('=== Final DB Status ===\n');
  for (const t of tables) {
    try {
      const r = await c.query('SELECT count(*)::int as cnt FROM ' + t);
      console.log(String(r.rows[0].cnt).padStart(4), t);
    } catch(e) {
      console.log(' ----', t, '(table missing)');
    }
  }
  // Show migrations count
  const m = await c.query('SELECT count(*)::int as cnt FROM _migrations');
  console.log('\n' + String(m.rows[0].cnt).padStart(4), '_migrations (applied)');
  c.end();
}).catch(e => { console.error('FAIL:', e.message); process.exit(1); });