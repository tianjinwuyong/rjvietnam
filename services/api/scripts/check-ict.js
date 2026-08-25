import { query } from '../src/db.js';

const r = await query(`SELECT payload FROM station_bucket_snapshots WHERE station_code='manu_ict' AND bucket_name='pass'`);
const payload = r.rows[0]?.payload || [];
console.log(`manu_ict pass: ${payload.length} records`);
if (payload.length > 0) {
  console.log('SNs:', payload.map(r => r.sn).join(', '));
}
