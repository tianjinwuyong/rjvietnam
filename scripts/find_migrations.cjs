const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  // Find the migrations table
  const t = await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%migrat%'");
  console.log('Migration tables:', JSON.stringify(t.rows));

  // Also check for any table with 'migration' or 'schema' in name
  const t2 = await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  console.log('All tables:', JSON.stringify(t2.rows.map(r => r.table_name)));

  await p.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
