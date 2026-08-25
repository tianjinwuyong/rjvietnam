import { query } from '../src/db.js';

const r = await query(`SELECT station_code, bucket_name, jsonb_array_length(payload) as cnt, version FROM station_bucket_snapshots WHERE bucket_name IN ('pass','pending_ng','confirmed_ng') ORDER BY station_code, bucket_name`);
console.log('Current bucket data:');
for (const row of r.rows) {
  console.log(`  ${row.station_code} / ${row.bucket_name}: ${row.cnt} records (v${row.version})`);
}
