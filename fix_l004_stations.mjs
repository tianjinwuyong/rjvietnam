import { query, shutdown } from './services/_shared/db.js';

async function main() {
  // 1. Fix manu_ict and manu_fct line_id → 3 (L004)
  console.log('=== Fixing line_id for manu_ict and manu_fct ===');
  await query(`UPDATE stations SET line_id = 3 WHERE code IN ('manu_ict', 'manu_fct') RETURNING code, line_id`);

  // 2. Clean L004 station_sequences: remove duplicates and old naming
  console.log('\n=== Cleaning L004 station_sequences ===');

  // Remove nam-fct (old duplicate of manu_fct) and PDA-01 (old naming)
  await query(`DELETE FROM station_sequences WHERE line_code = 'L004' AND station_code IN ('nam-fct', 'PDA-01')`);

  // Verify and show final L004 sequences
  const seq = await query(`
    SELECT ss.line_code, ss.station_code, ss.sequence_order, s.line_id
    FROM station_sequences ss
    JOIN stations s ON s.code = ss.station_code
    WHERE ss.line_code = 'L004'
    ORDER BY ss.sequence_order
  `);
  console.log('\nFinal L004 station_sequences:');
  console.table(seq.rows);

  // 3. Verify manu_ict / manu_fct now on line 3
  const stations = await query(`SELECT code, line_id FROM stations WHERE code IN ('manu_ict', 'manu_fct')`);
  console.log('\nmanu_ict/manu_fct line_id after fix:');
  console.table(stations.rows);

  await shutdown();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
