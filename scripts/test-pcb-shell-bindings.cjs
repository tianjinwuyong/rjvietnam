const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  // Check table exists
  const cols = await p.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pcb_shell_bindings' ORDER BY ordinal_position`);
  console.log('pcb_shell_bindings columns:', JSON.stringify(cols.rows, null, 2));

  // Insert test record
  await p.query(`DELETE FROM pcb_shell_bindings WHERE pcb_sn = 'TEST-PCBA-001'`);
  await p.query(`INSERT INTO pcb_shell_bindings (pcb_sn, shell_sn, operator, station_code, line_name) VALUES ('TEST-PCBA-001', 'TEST-SHELL-001', 'VN_OP_001', 'SHELL-BIND-01', 'L004')`);
  console.log('Insert OK');

  // Query back
  const rows = await p.query(`SELECT * FROM pcb_shell_bindings WHERE pcb_sn = 'TEST-PCBA-001'`);
  console.log('Records:', JSON.stringify(rows.rows, null, 2));

  // Cleanup
  await p.query(`DELETE FROM pcb_shell_bindings WHERE pcb_sn = 'TEST-PCBA-001'`);
  console.log('Cleanup OK');

  await p.end();
}
main().catch(e => { console.error(e.message); p.end(); });
