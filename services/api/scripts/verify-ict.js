// Verify: check manu_ict pass bucket and send SSE
import { query } from '../src/db.js';
import { neuralBroadcast } from '../src/shared/neural-bus.js';

const r = await query(`SELECT payload, version FROM station_bucket_snapshots WHERE station_code='manu_ict' AND bucket_name='pass'`);
console.log('DB pass bucket:', r.rows[0]?.payload?.length ?? 0, 'records, version:', r.rows[0]?.version);

if (r.rows[0]?.payload?.length > 0) {
  const version = Number(r.rows[0].version) + 1;
  const updated_at = new Date().toISOString();
  await query(`UPDATE station_bucket_snapshots SET version=$1, updated_at=NOW() WHERE station_code='manu_ict' AND bucket_name='pass'`, [version]);

  neuralBroadcast({
    from: 'mes_server',
    to: '*',
    type: 'BUCKET_SNAPSHOT_UPDATE',
    stationCode: 'manu_ict',
    payload: { stationCode: 'manu_ict', bucketName: 'pass', version, records: r.rows[0].payload, updatedAt: updated_at },
    priority: 'info'
  });
  console.log(`Broadcast: manu_ict pass v${version}, ${r.rows[0].payload.length} SNs`);
} else {
  console.log('pass bucket is empty in DB!');
}
