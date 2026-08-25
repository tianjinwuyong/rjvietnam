import { query } from '../src/db.js';
import { neuralBroadcast } from '../src/shared/neural-bus.js';

const NOW = Date.now();
const SNs = Array.from({ length: 10 }, (_, i) => ({
  sn: `ICT-SIM-${String(i + 1).padStart(3, '0')}-${NOW}`,
  time: NOW - (9 - i) * 4000,
  operator: 'SIM',
  stationCode: 'manu_ict',
  stationName: 'ICT',
  batchId: `SIM-${NOW}`
}));

await query(`
  INSERT INTO station_bucket_snapshots (station_code, bucket_name, version, payload, updated_at)
  VALUES ('manu_ict', 'pass', 9999, $1::jsonb, NOW())
  ON CONFLICT (station_code, bucket_name) DO UPDATE SET
    version = 9999, payload = EXCLUDED.payload, updated_at = NOW()
`, [JSON.stringify(SNs)]);

const r = await query(`SELECT payload FROM station_bucket_snapshots WHERE station_code='manu_ict' AND bucket_name='pass'`);
console.log(`DB has ${r.rows[0]?.payload?.length ?? 0} records`);

// Broadcast SSE
neuralBroadcast({
  from: 'mes_server', to: '*', type: 'BUCKET_SNAPSHOT_UPDATE',
  stationCode: 'manu_ict',
  payload: { stationCode: 'manu_ict', bucketName: 'pass', version: 9999, records: r.rows[0]?.payload || [], updatedAt: new Date().toISOString() },
  priority: 'info'
});
console.log('SSE broadcast sent');
