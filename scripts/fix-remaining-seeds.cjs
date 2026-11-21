const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
c.connect().then(async () => {
  const results = [];

  // 1. product_stagnation_logs — use hardcoded station IDs for L001
  try {
    // Upsert pcb_serials
    await c.query(`
      insert into pcb_serials (serial_no, work_order_id, status, created_at, source_work_order_code) values
        ('NV48A2545D8532', 14, 'wip', '2025-01-09 12:00:00', '26061020007'),
        ('NV48A2545D8541', 14, 'wip', '2025-01-20 18:00:00', '26061020007'),
        ('NV48A2545D8555', 15, 'wip', '2025-02-10 11:00:00', '26061030009'),
        ('NV36B1234A0012', 2,  'wip', '2025-03-01 14:00:00', '26061010008'),
        ('NV36B1234A0023', 2,  'wip', '2025-05-15 10:00:00', '26061010008'),
        ('NV36B1234A0028', 2,  'scrapped', '2025-06-21 09:00:00', '26061010008')
      on conflict (serial_no) do update set status = excluded.status
    `);

    const ps1 = (await c.query("select id from pcb_serials where serial_no='NV48A2545D8532'")).rows[0]?.id;
    const ps2 = (await c.query("select id from pcb_serials where serial_no='NV48A2545D8541'")).rows[0]?.id;
    const ps3 = (await c.query("select id from pcb_serials where serial_no='NV36B1234A0012'")).rows[0]?.id;

    // ICT-01=13, FCT-01=14, AOI-01=9 on L001 (line_id=5)
    await c.query(`
      insert into product_stagnation_logs
        (pcb_serial_id, from_station_id, to_station_id, station_code, line_code,
         customer_code, product_model, sn, pcb_no, laser_qr_date,
         stagnation_minutes, stagnation_level, status, notes, created_at)
      values
        ($1, 13, null, 'ICT-01', 'L001', 'NetBit', 'EPS48R1-36',
         'NV48A2545D8532', '3FAC02670A', '2025-01-09 08:00:00',
         525600, 'critical', 'open', 'Overdue 12 months awaiting scrap', '2025-01-09 12:00:00'),
        ($2, 14, null, 'FCT-01', 'L001', 'NetBit', 'EPS48R1-36',
         'NV48A2545D8541', '3FAC02670B', '2025-01-20 08:00:00',
         43200, 'warning', 'open', 'Stalled 30 days awaiting material', '2025-01-20 18:00:00'),
        ($3, 9, null, 'AOI-01', 'L001', 'NetBit', 'EPS18R1G',
         'NV36B1234A0012', '3FAC02671A', '2025-03-01 08:00:00',
         10080, 'warning', 'investigating', 'Stalled 7 days fixture issue', '2025-03-01 14:00:00')
    `, [ps1, ps2, ps3]);
    console.log('  ✓ product_stagnation_logs (3 rows)');
  } catch(e) { console.log('  ✗ product_stagnation_logs:', e.message.split('\n')[0]); }

  // 2. sn_duplicate_attempts — use correct column names: sn, line_name, station_code
  try {
    const existing = (await c.query("select id from pcb_serials where serial_no='PCBA-RUIJ-260619-0001'")).rows[0];
    await c.query(`
      insert into sn_duplicate_attempts
        (attempted_sn, attempted_action, line_name, station_code, operator, decision, attempted_at)
      values
        ('PCBA-RUIJ-260619-0001', 'bind', 'L001', 'SN-BIND-01', 'VN_OP_001', 'blocked', now() - interval '3 hours'),
        ('PCBA-RUIJ-260619-0001', 'scan_only', 'L001', 'FCT-01', 'VN_OP_001', 'allowed', now() - interval '1 hour')
    `);
    console.log('  ✓ sn_duplicate_attempts (2 rows)');
  } catch(e) { console.log('  ✗ sn_duplicate_attempts:', e.message.split('\n')[0]); }

  // 3. Verify all counts
  console.log('\n=== Final counts ===');
  const tables = ['product_stagnation_logs','sn_duplicate_attempts','traceability_events','fool_proof_rules','first_article_inspections','material_verifications','product_scraps','pcb_serials'];
  for (const t of tables) {
    const r = await c.query('SELECT count(*)::int as cnt FROM ' + t);
    console.log('  ' + t + ': ' + r.rows[0].cnt);
  }

  c.end();
  console.log('\nDone.');
}).catch(e => { console.error('Fatal:', e.message); process.exit(1); });