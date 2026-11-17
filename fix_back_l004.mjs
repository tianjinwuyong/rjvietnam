import { query, shutdown } from './services/_shared/db.js';

async function main() {
  // Move manu_ict / manu_fct back to L004 (line_id=3)
  const r = await query("UPDATE stations SET line_id = 3 WHERE code IN ('manu_ict', 'manu_fct') RETURNING code, line_id");
  console.log('Moved back to L004 (line_id=3):');
  console.table(r.rows);

  // Verify
  const v = await query("SELECT code, line_id FROM stations WHERE code IN ('manu_ict', 'manu_fct')");
  console.table(v.rows);

  await shutdown();
}

main().catch(e => { console.error(e); process.exit(1); });
