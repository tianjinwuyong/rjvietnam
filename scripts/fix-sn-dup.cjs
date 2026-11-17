const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
c.connect().then(async () => {
  try {
    // sn_duplicate_attempts — correct cols: id, attempted_at, line_name, station_code, sn, action, decision, operator
    await c.query(`
      insert into sn_duplicate_attempts
        (sn, action, line_name, station_code, operator, decision, attempted_at)
      values
        ('PCBA-RUIJ-260619-0001', 'bind', 'L001', 'SN-BIND-01', 'VN_OP_001', 'blocked', now() - interval '3 hours'),
        ('PCBA-RUIJ-260619-0001', 'scan_only', 'L001', 'FCT-01', 'VN_OP_001', 'allowed', now() - interval '1 hour'),
        ('PCBA-RUIJ-260619-9999', 'bind', 'L001', 'PACK-01', 'VN_OP_001', 'overridden', now() - interval '30 minutes')
    `);
    console.log('  ✓ sn_duplicate_attempts (3 rows)');
  } catch(e) { console.log('  ✗ sn_duplicate_attempts:', e.message.split('\n')[0]); }

  const r = await c.query('SELECT count(*)::int as cnt FROM sn_duplicate_attempts');
  console.log('  sn_duplicate_attempts total:', r.rows[0].cnt);
  c.end();
}).catch(e => { console.error('Fatal:', e.message); process.exit(1); });