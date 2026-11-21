/**
 * migrate-aoi-now.mjs — One-shot MySQL AOI → PG migration
 * Runs from MES server. Connects directly to MySQL 192.168.6.90, migrates ALL records.
 *
 * Usage: node migrate-aoi-now.mjs
 */

import pg from 'pg';
import mysql from 'mysql2/promise';

const PG = new pg.Pool({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });
const MY = mysql.createPool({
  host: '192.168.6.90', port: 3306, user: 'root', password: 'root1234',
  database: 'pcb_detection', charset: 'utf8', connectionLimit: 5, connectTimeout: 10000,
});

async function migrate() {
  const stationCode = 'manu_aio';

  // Resolve station
  const st = (await PG.query("SELECT id, code FROM stations WHERE code=$1", [stationCode])).rows[0];
  if (!st) { console.error(`Station '${stationCode}' not found!`); process.exit(1); }
  console.log(`Station: ${stationCode} → id=${st.id}`);

  // Check existing PG events for this station
  const existing = (await PG.query(
    "SELECT COUNT(*) FROM station_events WHERE station_id=$1", [st.id]
  )).rows[0].count;
  console.log(`Existing PG events: ${existing}`);

  // If already migrated with real data, skip
  if (existing > 0) {
    console.log(`Already has data. Clear with: DELETE FROM station_events WHERE station_id=${st.id}`);
    process.exit(0);
  }

  // Fetch all AOI records from MySQL
  const [rows] = await MY.query(
    `SELECT id, number, total, ng, good, less_tin, half_weld, miss,
            error_direction, pin_bend, error, other, tin_bead, lian_tin, hole, miss_spot,
            pass, bcr_codes, template_name, finish_time, repair_user, repair_time, create_time
     FROM detection_board ORDER BY id`
  );
  console.log(`MySQL records: ${rows.length}`);
  if (rows.length === 0) { process.exit(0); }

  // Batch insert
  const BATCH = 100;
  let inserted = 0, skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const client = await PG.connect();
    try {
      await client.query('BEGIN');
      for (const r of batch) {
        // Determine PASS/FAIL: ng=0 and total>0 → PASS, else FAIL
        const t = Number(r.total) || 0;
        const n = Number(r.ng) || 0;
        const result = (t > 0 && n === 0) ? 'pass' : 'fail';

        // SN: use number column as serial, fall back to bcr_codes
        const sn = String(r.number || r.bcr_codes || '').trim() || null;
        if (!sn) { skipped++; continue; }

        // Parse time
        let occurredAt;
        if (r.finish_time) {
          occurredAt = new Date(String(r.finish_time).replace(' ', 'T') + '.000Z');
          if (isNaN(occurredAt.getTime())) occurredAt = new Date();
        } else if (r.create_time) {
          occurredAt = new Date(r.create_time);
          if (isNaN(occurredAt.getTime())) occurredAt = new Date();
        } else {
          occurredAt = new Date();
        }

        await client.query(
          `INSERT INTO station_events (station_id, event_type, result, traceability_key, occurred_at)
           VALUES ($1, 'aoi_test', $2, $3, $4)`,
          [st.id, result, sn, occurredAt]
        );
        inserted++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`Batch ${i} error: ${e.message}`);
    } finally {
      client.release();
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH, rows.length)}/${rows.length}  inserted=${inserted}  skipped=${skipped}`);
  }

  console.log(`\nDone. inserted=${inserted}  skipped=${skipped}`);
  await PG.end();
  await MY.end();
}

migrate().catch(e => { console.error('FATAL:', e); process.exit(1); });
