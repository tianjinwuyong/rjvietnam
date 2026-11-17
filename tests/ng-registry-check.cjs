// Test: NG registry check for all stations
// Run: node tests/ng-registry-check.test.js
// Tests upstream NG lookup directly via pg (bypasses server HTTP auth issues).

const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});

const TEST_SN = "TEST-NG-CHECK-" + Date.now();
const OPERATOR = "test_operator";

const stations = [
  // SMT-LINE
  { stationCode: "LASER-01",     lineCode: "SMT-LINE",   seq: 1, parent: null },
  { stationCode: "AI-VERT-01",   lineCode: "SMT-LINE",   seq: 2, parent: null },
  { stationCode: "PRINT-01",     lineCode: "SMT-LINE",   seq: 3, parent: null },
  { stationCode: "SPI-01",       lineCode: "SMT-LINE",   seq: 4, parent: null },
  { stationCode: "NXT-01",       lineCode: "SMT-LINE",   seq: 5, parent: null },
  { stationCode: "SMT-AOI-01",   lineCode: "SMT-LINE",   seq: 6, parent: null },
  { stationCode: "PDA-01",       lineCode: "SMT-LINE",   seq: 7, parent: null },
  // AUTO-LINE
  { stationCode: "PDA-01",       lineCode: "AUTO-LINE",  seq: 1, parent: null },
  { stationCode: "AOI-01",       lineCode: "AUTO-LINE",  seq: 2, parent: null },
  { stationCode: "ICT-01",       lineCode: "AUTO-LINE",  seq: 3, parent: null },
  { stationCode: "FCT-01",       lineCode: "AUTO-LINE",  seq: 4, parent: null },
  { stationCode: "DEPANEL-01",   lineCode: "AUTO-LINE",  seq: 5, parent: null },
  { stationCode: "SHELL-BIND-01",lineCode: "AUTO-LINE",  seq: 6, parent: null },
  { stationCode: "ASSY-ATE-01",  lineCode: "AUTO-LINE",  seq: 7, parent: null },
  { stationCode: "ULTRA-01",     lineCode: "AUTO-LINE",  seq: 8, parent: null },
  { stationCode: "AGING-01",     lineCode: "AUTO-LINE",  seq: 9, parent: null },
  // MANUAL-LINE
  { stationCode: "PDA-01",       lineCode: "MANUAL-LINE", seq: 1,  parent: null },
  { stationCode: "AOI-01",       lineCode: "MANUAL-LINE", seq: 2,  parent: null },
  { stationCode: "ICT-01",       lineCode: "MANUAL-LINE", seq: 3,  parent: null },
  { stationCode: "FCT-01",       lineCode: "MANUAL-LINE", seq: 4,  parent: null },
  { stationCode: "DEPANEL-01",   lineCode: "MANUAL-LINE", seq: 5,  parent: null },
  { stationCode: "SHELL-BIND-01",lineCode: "MANUAL-LINE", seq: 6,  parent: null },
  { stationCode: "ASSY-ATE-01",  lineCode: "MANUAL-LINE", seq: 7,  parent: null },
  { stationCode: "ULTRA-01",     lineCode: "MANUAL-LINE", seq: 8,  parent: null },
  { stationCode: "AGING-01",     lineCode: "MANUAL-LINE", seq: 9,  parent: null },
  { stationCode: "HIPOT-01",     lineCode: "MANUAL-LINE", seq: 10, parent: null },
  { stationCode: "PACK-ATE-01",  lineCode: "MANUAL-LINE", seq: 11, parent: null },
  { stationCode: "CARTON-BIND-01",lineCode:"MANUAL-LINE",seq: 12, parent: null },
  { stationCode: "PALLET-BIND-01",lineCode:"MANUAL-LINE",seq: 13, parent: null },
  // PACK-LINE (parent = AUTO-LINE)
  { stationCode: "HIPOT-PACK-01", lineCode: "PACK-LINE",  seq: 1, parent: "AUTO-LINE" },
  { stationCode: "PACK-ATE-01",   lineCode: "PACK-LINE",  seq: 2, parent: "AUTO-LINE" },
  { stationCode: "CARTON-BIND-01",lineCode: "PACK-LINE",  seq: 3, parent: "AUTO-LINE" },
  { stationCode: "PALLET-BIND-01",lineCode: "PACK-LINE",  seq: 4, parent: "AUTO-LINE" },
];

async function query(sql, params) {
  const r = await pool.query(sql, params);
  return r;
}

async function run() {
  let passed = 0, failed = 0;

  // Step 1: Seed FAIL NG at ICT-01 (AUTO-LINE seq=3)
  console.log("\n[1] Seed FAIL NG at ICT-01 (AUTO-LINE seq=3)...");
  try {
    await query(
      `INSERT INTO ng_defect_records
       (line_name, station_code, sn, result, channel, error_code, defect_code, source, operator)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      ["AUTO-LINE", "ICT-01", TEST_SN, "fail", "CH-A", "ERR-SEQ3", "OPEN", "test", OPERATOR],
    );
    console.log("    ✓ Seeded");
  } catch (e) { console.error("    ✗ Seed failed:", e.message); process.exit(1); }

  // Step 2: Test all stations
  console.log("\n[2] Upstream NG check for all 33 stations...");
  console.log("─".repeat(90));
  console.log(`${"Station".padEnd(20)} ${"Line".padEnd(14)} ${"Seq"} ${"Upstream"}  ${"Expected"}`);
  console.log("─".repeat(90));

  for (const s of stations) {
    let count, records;
    try {
      // Replicate the server's upstream query logic
      let data;
      if (!s.stationCode) { count = 0; records = []; }
      else {
        const caller = await query(
          `SELECT line_code, sequence_order, parent_line_code FROM station_sequences WHERE station_code=$1 AND line_code=$2 LIMIT 1`,
          [s.stationCode, s.lineCode],
        );
        if (caller.rows.length === 0) { count = -2; records = []; }
        else {
          const { line_code, sequence_order, parent_line_code } = caller.rows[0];
          const ownUpstream = `(ng.line_name = s.line_code AND s.line_code = '${line_code}' AND s.sequence_order < ${sequence_order})
`;
          const parentUpstream = parent_line_code
            ? `UNION ALL
               SELECT ng.id, ng.occurred_at, ng.line_name, ng.station_code, ps.station_name_zh,
                      ps.sequence_order, ps.line_code, ng.sn, ng.result, ng.channel, ng.error_code,
                      ng.defect_code, ng.defect_desc, ng.file, ng.row, ng.time, ng.source, ng.operator
               FROM ng_defect_records ng
               JOIN station_sequences ps ON ps.station_code = ng.station_code
               WHERE ng.sn = $1 AND ng.result = 'fail' AND ng.line_name = ps.line_code AND ps.line_code = '${parent_line_code}'`
            : "";
          data = await query(
            `SELECT * FROM (
               SELECT ng.id, ng.occurred_at, ng.line_name, ng.station_code, s.station_name_zh,
                      s.sequence_order, s.line_code, ng.sn, ng.result, ng.channel, ng.error_code,
                      ng.defect_code, ng.defect_desc, ng.file, ng.row, ng.time, ng.source, ng.operator
               FROM ng_defect_records ng
               JOIN station_sequences s ON s.station_code = ng.station_code
               WHERE ng.sn = $1 AND ng.result = 'fail' AND ${ownUpstream}
               ${parentUpstream}
             ) upstream ORDER BY sequence_order ASC, occurred_at DESC LIMIT 100`,
            [TEST_SN],
          );
          records = data.rows;
          count = records.length;
        }
      }
    } catch (e) { count = -3; records = []; console.error(`    DB error for ${s.stationCode}: ${e.message}`); }

    let expected;
    if (s.lineCode === "AUTO-LINE" && s.seq > 3) expected = 1;
    else if (s.lineCode === "PACK-LINE") expected = 1;
    else expected = 0;

    const ok = count === expected;
    if (ok) passed++; else failed++;
    console.log(
      `${s.stationCode.padEnd(20)} ${s.lineCode.padEnd(14)} ${String(s.seq).padStart(3)} ${String(count).padStart(8)}  ${String(expected).padStart(8)}  ${ok ? "✓" : "✗ FAIL"}`,
    );
  }

  // Step 3: PACK-LINE parent inheritance
  console.log("\n[3] PACK-LINE parent inheritance (HIPOT-PACK-01 should see AUTO-LINE NG)...");
  const packData = await query(
    `SELECT ng.id, ng.station_code, s.line_code, s.parent_line_code
     FROM ng_defect_records ng
     JOIN station_sequences s ON s.station_code = ng.station_code
     WHERE ng.sn = $1 AND ng.result = 'fail' AND s.line_code = 'PACK-LINE' AND s.sequence_order < 1
     UNION ALL
     SELECT ng.id, ng.station_code, s.line_code, s.parent_line_code
     FROM ng_defect_records ng
     JOIN station_sequences s ON s.station_code = ng.station_code
     WHERE ng.sn = $1 AND ng.result = 'fail' AND s.line_code = 'AUTO-LINE'`,
    [TEST_SN],
  );
  console.log(`    Total upstream NG for PACK-LINE stations: ${packData.rows.length}`);
  packData.rows.forEach(r => console.log(`    → ${r.station_code} (line=${r.line_code})`));

  // Step 4: FCT-01 upstream
  console.log("\n[4] FCT-01 (AUTO-LINE seq=4) should see 1 upstream NG (ICT-01 seq=3)...");
  const fctData = await query(
    `SELECT ng.id, ng.station_code, s.sequence_order
     FROM ng_defect_records ng
     JOIN station_sequences s ON s.station_code = ng.station_code
     WHERE ng.sn = $1 AND ng.result = 'fail'
       AND s.line_code = 'AUTO-LINE' AND s.sequence_order < 4
     ORDER BY s.sequence_order ASC LIMIT 100`,
    [TEST_SN],
  );
  console.log(`    count=${fctData.rows.length}  expected=1  ${fctData.rows.length === 1 ? "✓" : "✗ FAIL"}`);
  fctData.rows.forEach(r => console.log(`    → ${r.station_code} (seq=${r.sequence_order})`));

  // Step 5: AOI-01 upstream (should be 0)
  console.log("\n[5] AOI-01 (AUTO-LINE seq=2) should see 0 upstream NG...  ");
  const aoiData = await query(
    `SELECT ng.id, ng.station_code, s.sequence_order
     FROM ng_defect_records ng
     JOIN station_sequences s ON s.station_code = ng.station_code
     WHERE ng.sn = $1 AND ng.result = 'fail'
       AND s.line_code = 'AUTO-LINE' AND s.sequence_order < 2
     LIMIT 100`,
    [TEST_SN],
  );
  console.log(`    count=${aoiData.rows.length}  expected=0  ${aoiData.rows.length === 0 ? "✓" : "✗ FAIL"}`);

  // Cleanup
  await query(`DELETE FROM ng_defect_records WHERE sn=$1`, [TEST_SN]);
  console.log("\n[6] Cleanup done.");

  console.log("\n" + "═".repeat(50));
  console.log(`TOTAL: ${passed} passed / ${failed} failed / ${stations.length} stations`);
  await pool.end();
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });