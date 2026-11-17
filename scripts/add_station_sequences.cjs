const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  // Insert missing station_sequences
  const missing = [
    // ASM-ATE1-01 in MANUAL-LINE at seq 12 (between PACK-ATE-01=11 and PALLET-BIND-01=13)
    ["ASM-ATE1-01", "MANUAL-LINE", 12],
    // AGING-CAB-01 in AUTO-LINE at seq 7 (after SHELL-BIND-01=6)
    ["AGING-CAB-01", "AUTO-LINE", 7],
  ];

  for (const [stationCode, lineCode, seqOrder] of missing) {
    try {
      const r = await p.query(`
        INSERT INTO station_sequences (station_code, line_code, sequence_order, parent_line_code)
        VALUES ($1, $2, $3, NULL)
        ON CONFLICT (station_code, line_code) DO UPDATE SET sequence_order = EXCLUDED.sequence_order
        RETURNING station_code, line_code, sequence_order
      `, [stationCode, lineCode, seqOrder]);
      console.log(`Added/updated: ${JSON.stringify(r.rows[0])}`);
    } catch (e) {
      console.error(`Error for ${stationCode}: ${e.message}`);
    }
  }

  // Also check PACK-ATE-01, PALLET-BIND-01, SHELL-BIND-01 in AUTO-LINE
  // They might be in MANUAL-LINE but not in AUTO-LINE for cross-line queries
  const crossLine = [
    ["PACK-ATE-01", "AUTO-LINE", 8],
    ["PALLET-BIND-01", "AUTO-LINE", 9],
  ];
  for (const [stationCode, lineCode, seqOrder] of crossLine) {
    try {
      const r = await p.query(`
        INSERT INTO station_sequences (station_code, line_code, sequence_order, parent_line_code)
        VALUES ($1, $2, $3, NULL)
        ON CONFLICT (station_code, line_code) DO UPDATE SET sequence_order = EXCLUDED.sequence_order
        RETURNING station_code, line_code, sequence_order
      `, [stationCode, lineCode, seqOrder]);
      console.log(`Added/updated cross-line: ${JSON.stringify(r.rows[0])}`);
    } catch (e) {
      console.error(`Error for ${stationCode}: ${e.message}`);
    }
  }

  await p.end();
  console.log('Done.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
