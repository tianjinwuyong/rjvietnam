const pg = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const c = new pg.Pool({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });

  const sql = fs.readFileSync('C:/Users/tianj/Desktop/越南工厂瑞晶/smt-factory-system/database/migrations/260_pda_user_apps.sql', 'utf8');

  console.log('Applying migration 260_pda_user_apps...');
  try {
    await c.query(sql);
    console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Migration error:', err.message);
  }

  // Verify
  const cats = await c.query("SELECT app_key, name_zh FROM pda_app_catalog ORDER BY sort_order");
  console.log('\n=== PDA App Catalog ===');
  console.log(JSON.stringify(cats.rows, null, 2));

  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
