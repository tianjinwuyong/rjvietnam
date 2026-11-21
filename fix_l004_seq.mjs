import { query, shutdown } from './services/_shared/db.js';

async function main() {
  // Get all L004 actual stations
  const l004stations = await query("SELECT code, name_zh FROM stations WHERE line_id = 3 ORDER BY code");
  console.log('L004 actual stations:');
  console.table(l004stations.rows);

  // Get current L004 station_sequences
  const l004seq = await query("SELECT station_code, sequence_order FROM station_sequences WHERE line_code = 'L004' ORDER BY sequence_order");
  console.log('\nCurrent L004 station_sequences:');
  console.table(l004seq.rows);

  // Mapping: old generic → actual for L004
  const mapping = {
    'PDA-01':        'PDA-01',
    'AOI-01':        'manu_aio',
    'ICT-01':        'manu_ict',
    'FCT-01':        'manu_fct',
    'nam-fct':       'nam-fct',
    'DEPANEL-01':    'manu_depanel',
    'SHELL-BIND-01': 'manu_shellbinding',
    'ASSY-ATE-01':   'manu_assem_ate',
    'ULTRA-01':      'manu_supersonic',
    'AGING-01':      'manu_agingcab',
    'HIPOT-01':      'manu_hivolt_ate',
    'PACK-ATE-01':   'manu_package_ate',
    'ASM-ATE1-01':   'manu_assem_ate',
    'CARTON-BIND-01':'manu_outer_box_binding',
    'PALLET-BIND-01':'manu_pallet_binding',
  };

  // Delete all existing L004 entries and re-insert with correct codes
  console.log('\n=== Replacing L004 station_sequences ===');
  await query("DELETE FROM station_sequences WHERE line_code = 'L004'");

  // Re-insert from the actual stations with proper sequence
  const insertOrder = [
    { code: 'PDA-01',           seq: 1 },
    { code: 'manu_aio',         seq: 2 },
    { code: 'manu_ict',         seq: 3 },
    { code: 'manu_fct',         seq: 4 },
    { code: 'nam-fct',          seq: 4 },
    { code: 'manu_depanel',     seq: 5 },
    { code: 'manu_shellbinding', seq: 6 },
    { code: 'manu_assem_ate',   seq: 7 },
    { code: 'manu_supersonic',   seq: 8 },
    { code: 'manu_agingcab',     seq: 9 },
    { code: 'manu_hivolt_ate',  seq: 10 },
    { code: 'manu_package_ate', seq: 11 },
    { code: 'manu_outer_box_binding', seq: 12 },
    { code: 'manu_pallet_binding', seq: 13 },
  ];

  for (const { code, seq } of insertOrder) {
    await query(
      "INSERT INTO station_sequences (line_code, station_code, sequence_order) VALUES ('L004', $1, $2) ON CONFLICT DO NOTHING",
      [code, seq]
    );
    console.log(`  Inserted L004: ${code} seq=${seq}`);
  }

  // Verify
  const after = await query("SELECT station_code, sequence_order FROM station_sequences WHERE line_code = 'L004' ORDER BY sequence_order, station_code");
  console.log('\nFinal L004 station_sequences:');
  console.table(after.rows);

  await shutdown();
}

main().catch(e => { console.error(e); process.exit(1); });
