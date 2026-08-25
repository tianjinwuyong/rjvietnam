import { query } from '../src/db.js';

// Check heartbeat table structure
const hbCols = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'station_heartbeats' AND table_schema = 'public'`);
console.log('heartbeat columns:', hbCols.rows.map(r => r.column_name).join(', '));

// Check recent ICT events
const events = await query(`
  SELECT event_type, result, COUNT(*) as cnt
  FROM station_events se
  JOIN stations s ON se.station_id = s.id
  WHERE s.code = 'manu_ict'
  GROUP BY event_type, result
`);
console.log('\nICT station_events:');
for (const r of events.rows) console.log(`  ${r.event_type} / ${r.result}: ${r.cnt}`);

// Check bucket snapshots raw payload for manu_ict pass
const pass = await query(`SELECT payload, version FROM station_bucket_snapshots WHERE station_code='manu_ict' AND bucket_name='pass'`);
console.log(`\nmanu_ict pass bucket: ${pass.rows[0]?.payload?.length ?? 0} records, version=${pass.rows[0]?.version}`);

// Check recent events for manu_ict
const recent = await query(`
  SELECT se.event_type, se.result, se.occurred_at, s.code
  FROM station_events se
  JOIN stations s ON se.station_id = s.id
  WHERE s.code = 'manu_ict'
  ORDER BY se.occurred_at DESC
  LIMIT 5
`);
console.log('\nRecent ICT events:');
for (const r of recent.rows) console.log(`  ${r.occurred_at}: ${r.event_type} / ${r.result}`);
