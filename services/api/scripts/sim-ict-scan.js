// Simulate 10 ICT SN scans: insert into DB pass bucket + broadcast SSE
import { query } from '../src/db.js';
import { neuralBroadcast } from '../src/shared/neural-bus.js';

const STATION = 'manu_ict';
const NOW = Date.now();

const snList = Array.from({ length: 10 }, (_, i) => ({
  sn: `ICT-SIM-${String(i + 1).padStart(3, '0')}-${Date.now().toString().slice(-4)}`,
  time: NOW - (9 - i) * 4000,
  operator: 'SIM_OP',
  stationCode: STATION,
  stationName: 'ICT',
  batchId: `SIM-${Date.now()}`
}));

console.log('SNs:', snList.map(s => s.sn).join('\n'));

// Upsert pass bucket
const result = await query(`
  INSERT INTO station_bucket_snapshots (station_code, bucket_name, version, payload, updated_at)
  VALUES ($1, 'pass', 1, $2::jsonb, NOW())
  ON CONFLICT (station_code, bucket_name) DO UPDATE SET
    version = station_bucket_snapshots.version + 1,
    payload = EXCLUDED.payload,
    updated_at = NOW()
  RETURNING version, updated_at
`, [STATION, JSON.stringify(snList)]);

const { version, updated_at } = result.rows[0];
console.log(`\nBucket version=${version}`);

// Broadcast to all SSE clients
neuralBroadcast({
  from: 'mes_server',
  to: '*',
  type: 'BUCKET_SNAPSHOT_UPDATE',
  stationCode: STATION,
  payload: { stationCode: STATION, bucketName: 'pass', version, records: snList, updatedAt: updated_at },
  priority: 'info'
});

console.log('\n✅ SSE broadcast sent — check 3D dashboard ICT station');
