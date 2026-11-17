import { query, shutdown } from './services/_shared/db.js';

async function main() {
  console.log('=== Current station_sequences for L002 ===');
  const r0 = await query("SELECT line_code, station_code, sequence_order, station_name_zh FROM station_sequences WHERE line_code = 'L002' ORDER BY sequence_order, station_code");
  console.table(r0.rows);

  console.log('\n=== Current L002 stations ===');
  const r00 = await query("SELECT code, name_zh, sequence_order FROM stations WHERE line_id = 1 AND code LIKE 'manu%' OR code LIKE 'auto%' ORDER BY code");
  console.table(r00.rows);

  // Find the sequence_order of AUTO-ICT-01 and AUTO-FCT-01 in station_sequences L002
  const r01 = await query("SELECT station_code, sequence_order FROM station_sequences WHERE line_code = 'L002' AND station_code IN ('AUTO-ICT-01', 'AUTO-FCT-01')");
  console.log('\nICT/FCT sequence in station_sequences:', r01.rows);

  // Insert manu_ict and manu_fct entries for L002 (they now report to L002 after line_id change)
  // Give them the same sequence_order as their AUTO- counterparts
  const ictSeq = r01.rows.find(r => r.station_code === 'AUTO-ICT-01')?.sequence_order;
  const fctSeq = r01.rows.find(r => r.station_code === 'AUTO-FCT-01')?.sequence_order;
  console.log(`\nWill insert manu_ict at seq=${ictSeq}, manu_fct at seq=${fctSeq}`);

  // Insert OR ignore if already exists
  const r1 = await query(`
    INSERT INTO station_sequences (line_code, station_code, sequence_order, station_name_zh)
    VALUES ('L002', 'manu_ict', $1, '手动ICT')
    ON CONFLICT (line_code, station_code) DO UPDATE SET line_code = EXCLUDED.line_code, sequence_order = EXCLUDED.sequence_order
    RETURNING line_code, station_code, sequence_order
  `, [ictSeq]);
  console.log('manu_ict insert:', r1.rows);

  const r2 = await query(`
    INSERT INTO station_sequences (line_code, station_code, sequence_order, station_name_zh)
    VALUES ('L002', 'manu_fct', $1, '手动FCT')
    ON CONFLICT (line_code, station_code) DO UPDATE SET line_code = EXCLUDED.line_code, sequence_order = EXCLUDED.sequence_order
    RETURNING line_code, station_code, sequence_order
  `, [fctSeq]);
  console.log('manu_fct insert:', r2.rows);

  // Verify
  console.log('\n=== Final L002 station_sequences ===');
  const r3 = await query("SELECT line_code, station_code, sequence_order, station_name_zh FROM station_sequences WHERE line_code = 'L002' ORDER BY sequence_order, station_code");
  console.table(r3.rows);

  // Also check L004
  console.log('\n=== Final L004 station_sequences ===');
  const r4 = await query("SELECT line_code, station_code, sequence_order, station_name_zh FROM station_sequences WHERE line_code = 'L004' ORDER BY sequence_order, station_code");
  console.table(r4.rows);

  await shutdown();
}

main().catch(e => { console.error(e); process.exit(1); });
