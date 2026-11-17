import { query, shutdown } from './services/_shared/db.js';

async function main() {
  console.log('=== Fix station_sequences station codes to match actual station codes ===');

  // Mapping: old generic name → new actual name (for L002 AUTO-LINE)
  const updates = [
    ['PDA-01', 'AUTO-LOAD-01'],
    ['AOI-01', 'AUTO-AOI-01'],
    ['ICT-01', 'AUTO-ICT-01'],
    ['FCT-01', 'AUTO-FCT-01'],
    ['DEPANEL-01', 'AUTO-PCBA-01'],
    ['SHELL-BIND-01', 'AUTO-ASM-01'],
    ['AGING-CAB-01', 'AGING-CAB-01'],
    ['ASSY-ATE-01', 'AUTO-ASM-01'],
    ['PACK-ATE-01', 'AUTO-ATE-01'],
    ['ULTRA-01', 'AUTO-USONIC-01'],
    ['AGING-01', 'AGING-CAB-01'],
    ['PALLET-BIND-01', 'AUTO-PACK-01'],
  ];

  let total = 0;
  for (const [old, newCode] of updates) {
    const r = await query(
      "UPDATE station_sequences SET station_code = $1 WHERE line_code = $2 AND station_code = $3 RETURNING station_code",
      [newCode, 'L002', old]
    );
    if (r.rows.length > 0) {
      console.log(`L002: ${old} → ${newCode} (${r.rows.length} rows)`);
      total += r.rows.length;
    }
  }

  // For L004 MANUAL-LINE
  const l004Updates = [
    ['PDA-01', 'PDA-01'],       // no AUTO prefix on manual
    ['AOI-01', 'manu_aio'],
    ['ICT-01', 'manu_ict'],
    ['FCT-01', 'manu_fct'],
    ['DEPANEL-01', 'manu_depanel'],
    ['SHELL-BIND-01', 'manu_shellbinding'],
    ['AGING-CAB-01', 'manu_agingcab'],
    ['ASSY-ATE-01', 'manu_assem_ate'],
    ['PACK-ATE-01', 'manu_package_ate'],
    ['ULTRA-01', 'manu_supersonic'],
    ['AGING-01', 'manu_agingcab'],
    ['HIPOT-01', 'manu_hivolt_ate'],
    ['CARTON-BIND-01', 'manu_outer_box_binding'],
    ['PALLET-BIND-01', 'manu_pallet_binding'],
    ['ASM-ATE1-01', 'manu_assem_ate'],
  ];

  for (const [old, newCode] of l004Updates) {
    const r = await query(
      "UPDATE station_sequences SET station_code = $1 WHERE line_code = $2 AND station_code = $3 RETURNING station_code",
      [newCode, 'L004', old]
    );
    if (r.rows.length > 0) {
      console.log(`L004: ${old} → ${newCode} (${r.rows.length} rows)`);
      total += r.rows.length;
    }
  }

  console.log(`\nTotal rows updated: ${total}`);

  // Verify final state
  const seq = await query("SELECT line_code, station_code, sequence_order FROM station_sequences WHERE line_code IN ('L002', 'L004') ORDER BY line_code, sequence_order");
  console.log('\n=== L002 & L004 station_sequences after fix ===');
  console.table(seq.rows);

  await shutdown();
}

main().catch(e => { console.error(e); process.exit(1); });
