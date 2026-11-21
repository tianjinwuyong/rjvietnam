import { query, shutdown } from './services/_shared/db.js';

async function main() {
  console.log('=== Step 1: Update manu_ict / manu_fct line_id 3 → 1 ===');

  // Verify current state first
  const before = await query("SELECT code, line_id FROM stations WHERE code IN ('manu_ict', 'manu_fct', 'manu_aio', 'manu_fct', 'nam-fct')");
  console.log('Before:', before.rows);

  // Update stations line_id
  const r1 = await query("UPDATE stations SET line_id = 1 WHERE code IN ('manu_ict', 'manu_fct') RETURNING code, line_id");
  console.log('Updated stations:', r1.rows);

  // Verify after
  const after = await query("SELECT code, line_id FROM stations WHERE code IN ('manu_ict', 'manu_fct')");
  console.log('After:', after.rows);

  console.log('\n=== Step 2: Update station_sequences line_code names ===');

  // Update MANUAL-LINE → L004
  const r2 = await query("UPDATE station_sequences SET line_code = 'L004' WHERE line_code = 'MANUAL-LINE' RETURNING line_code, station_code, sequence_order");
  console.log('MANUAL-LINE → L004:', r2.rows.length, 'rows updated');

  // Update AUTO-LINE → L002
  const r3 = await query("UPDATE station_sequences SET line_code = 'L002' WHERE line_code = 'AUTO-LINE' RETURNING line_code, station_code, sequence_order");
  console.log('AUTO-LINE → L002:', r3.rows.length, 'rows updated');

  // Verify final station_sequences state
  const seqCheck = await query("SELECT line_code, station_code, sequence_order FROM station_sequences ORDER BY line_code, sequence_order");
  console.log('\n=== Final station_sequences ===');
  console.table(seqCheck.rows);

  await shutdown();
}

main().catch(e => { console.error(e); process.exit(1); });
