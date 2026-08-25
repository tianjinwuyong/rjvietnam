import { query } from '../src/db.js';

// Check ICT actual scan events
const events = await query(`
  SELECT event_type, result, COUNT(*) as cnt,
    MIN(occurred_at) as first, MAX(occurred_at) as last
  FROM station_events se
  JOIN stations s ON se.station_id = s.id
  WHERE s.code = 'manu_ict'
  GROUP BY event_type, result
  ORDER BY cnt DESC
  LIMIT 20
`);
console.log('ICT events in station_events:');
for (const r of events.rows) console.log(`  ${r.event_type} / ${r.result}: ${r.cnt} records`);

// Check heartbeat
const hb = await query(`
  SELECT station_code, last_signal_at, status
  FROM station_heartbeats
  WHERE station_code = 'manu_ict'
`);
console.log('\nICT heartbeat:');
console.log(JSON.stringify(hb.rows[0] || 'none', null, 2));
