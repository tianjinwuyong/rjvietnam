// Direct DB insert: write 10 SNs to manu_ict pass bucket
import { query } from '../src/db.js';
import { neuralBroadcast } from '../src/shared/neural-bus.js';

const NOW = Date.now();
const SNs = Array.from({ length: 10 }, (_, i) => ({
  sn: `ICT-SIM-${String(i + 1).padStart(3, '0')}`,
  time: NOW - (9 - i) * 4000,
  operator: 'SIM',
  stationCode: 'manu_ict',
  stationName: 'ICT',
  batchId: `SIM-${NOW}`
}));

const result = await query(`
  INSERT INTO station_bucket_snapshots (station_code, bucket_name, version, payload, updated_at)
  VALUES ('manu_ict', 'pass', 999, $1::jsonb, NOW())
  ON CONFLICT (station_code, bucket_name) DO UPDATE SET
    version = 999,
    payload = EXCLUDED.payload,
    updated_at = NOW()
  RETURNING version, updated_at
`, [JSON.stringify(SNs)]);

const { version, updated_at } = result.rows[0];
console.log(`Inserted ${SNs.length} SNs, version=${version}`);

const check = await query(`SELECT jsonb_array_length(payload) as cnt FROM station_bucket_snapshots WHERE station_code='manu_ict' AND bucket_name='pass'`);
console.log(`pass bucket count: ${check.rows[0].cnt}`);

neuralBroadcast({
  from: 'mes_server',
  to: '*',
  type: 'BUCKET_SNAPSHOT_UPDATE',
  stationCode: 'manu_ict',
  payload: { stationCode: 'manu_ict', bucketName: 'pass', version, records: SNs, updatedAt: updated_at },
  priority: 'info'
});

console.log('SSE broadcast sent');
