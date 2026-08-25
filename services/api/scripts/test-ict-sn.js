// Test script: inject 10 SNs into manu_ict pass bucket and broadcast SSE
import { neuralBroadcast } from '../src/shared/neural-bus.js';
import { query } from '../src/db.js';

const STATION = 'manu_ict';
const BUCKET = 'pass';
const NOW = Date.now();

const testSnList = Array.from({ length: 10 }, (_, i) => ({
  sn: `ICT-TEST-${String(i + 1).padStart(3, '0')}`,
  time: NOW - (9 - i) * 3000, // spread across last 30 seconds
  operator: 'TEST_OP',
  stationCode: STATION,
  stationName: 'ICT Station',
  batchId: `BATCH-${Date.now()}`
}));

console.log('Inserting SNs:', testSnList.map(s => s.sn).join(', '));

// Upsert into station_bucket_snapshots
const result = await query(`
  INSERT INTO station_bucket_snapshots (station_code, bucket_name, version, payload, updated_at)
  VALUES ($1, $2, 1, $3::jsonb, NOW())
  ON CONFLICT (station_code, bucket_name) DO UPDATE SET
    version = station_bucket_snapshots.version + 1,
    payload = EXCLUDED.payload,
    updated_at = NOW()
  RETURNING version, updated_at
`, [STATION, BUCKET, JSON.stringify(testSnList)]);

const { version, updated_at } = result.rows[0];
console.log(`Bucket updated: version=${version}, updated_at=${updated_at}`);

// Broadcast SSE event to all connected clients (including 3D dashboard)
neuralBroadcast({
  from: 'mes_server',
  to: '*',
  type: 'BUCKET_SNAPSHOT_UPDATE',
  stationCode: STATION,
  payload: {
    stationCode: STATION,
    bucketName: BUCKET,
    version,
    records: testSnList,
    updatedAt: updated_at
  },
  priority: 'info'
});

console.log('SSE broadcast sent. Check the 3D dashboard for ICT station SNs.');
