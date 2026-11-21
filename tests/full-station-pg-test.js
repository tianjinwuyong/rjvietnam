// Full 33-station test via pg (bypasses HTTP server DB connection issues)
// Run: node tests/full-station-pg-test.js

import pg from "pg";
const pool = new pg.Pool({
  host: "127.0.0.1", port: 5432, user: "postgres",
  password: "postgres", database: "smt_factory",
});

const TEST_SN = "FULL-PG-TEST-" + Date.now();

// Station list (32 real stations)
const stations = [
  { stationCode: "LASER-01",      lineCode: "SMT-LINE",   seq: 1 },
  { stationCode: "AI-VERT-01",    lineCode: "SMT-LINE",   seq: 2 },
  { stationCode: "PRINT-01",      lineCode: "SMT-LINE",   seq: 3 },
  { stationCode: "SPI-01",        lineCode: "SMT-LINE",   seq: 4 },
  { stationCode: "NXT-01",        lineCode: "SMT-LINE",   seq: 5 },
  { stationCode: "SMT-AOI-01",    lineCode: "SMT-LINE",   seq: 6 },
  { stationCode: "PDA-01",        lineCode: "SMT-LINE",   seq: 7 },
  { stationCode: "PDA-01",        lineCode: "AUTO-LINE",  seq: 1 },
  { stationCode: "AOI-01",        lineCode: "AUTO-LINE",  seq: 2 },
  { stationCode: "ICT-01",        lineCode: "AUTO-LINE",  seq: 3 },
  { stationCode: "FCT-01",        lineCode: "AUTO-LINE",  seq: 4 },
  { stationCode: "DEPANEL-01",    lineCode: "AUTO-LINE",  seq: 5 },
  { stationCode: "SHELL-BIND-01", lineCode: "AUTO-LINE",  seq: 6 },
  { stationCode: "ASSY-ATE-01",   lineCode: "AUTO-LINE",  seq: 7 },
  { stationCode: "ULTRA-01",      lineCode: "AUTO-LINE",  seq: 8 },
  { stationCode: "AGING-01",      lineCode: "AUTO-LINE",  seq: 9 },
  { stationCode: "PDA-01",        lineCode: "MANUAL-LINE", seq: 1 },
  { stationCode: "AOI-01",        lineCode: "MANUAL-LINE", seq: 2 },
  { stationCode: "ICT-01",        lineCode: "MANUAL-LINE", seq: 3 },
  { stationCode: "FCT-01",        lineCode: "MANUAL-LINE", seq: 4 },
  { stationCode: "DEPANEL-01",    lineCode: "MANUAL-LINE", seq: 5 },
  { stationCode: "SHELL-BIND-01", lineCode: "MANUAL-LINE", seq: 6 },
  { stationCode: "ASSY-ATE-01",   lineCode: "MANUAL-LINE", seq: 7 },
  { stationCode: "ULTRA-01",      lineCode: "MANUAL-LINE", seq: 8 },
  { stationCode: "AGING-01",      lineCode: "MANUAL-LINE", seq: 9 },
  { stationCode: "HIPOT-01",      lineCode: "MANUAL-LINE", seq: 10 },
  { stationCode: "PACK-ATE-01",   lineCode: "MANUAL-LINE", seq: 11 },
  { stationCode: "CARTON-BIND-01",lineCode: "MANUAL-LINE", seq: 12 },
  { stationCode: "PALLET-BIND-01",lineCode: "MANUAL-LINE", seq: 13 },
  { stationCode: "HIPOT-PACK-01", lineCode: "PACK-LINE",   seq: 1, parent: "AUTO-LINE" },
  { stationCode: "PACK-ATE-01",   lineCode: "PACK-LINE",   seq: 2, parent: "AUTO-LINE" },
  { stationCode: "CARTON-BIND-01",lineCode: "PACK-LINE",   seq: 3, parent: "AUTO-LINE" },
  { stationCode: "PALLET-BIND-01",lineCode: "PACK-LINE",   seq: 4, parent: "AUTO-LINE" },
];

async function query(sql, params) {
  const r = await pool.query(sql, params);
  return r;
}

async function run() {
  let passed = 0, failed = 0;

  // Step 1: DB check
  console.log("\n[1] DB connection...");
  try {
    const r = await query("SELECT current_database() as db, version() as v");
    console.log(`    DB: ${r.rows[0].db}`);
    console.log("    ✓");
    passed++;
  } catch (e) { console.log(`    ✗ ${e.message}`); failed++; }

  // Step 2: Station sequences check
  console.log("\n[2] station_sequences count...");
  try {
    const r = await query("SELECT COUNT(*) as cnt FROM station_sequences");
    console.log(`    ${r.rows[0].cnt} rows`);
    if (parseInt(r.rows[0].cnt) >= 32) { console.log("    ✓"); passed++; }
    else { console.log("    ✗ expected >= 32"); failed++; }
  } catch (e) { console.log(`    ✗ ${e.message}`); failed++; }

  // Step 3: Insert NG at ICT-01 (AUTO-LINE seq=3)
  console.log("\n[3] Seed NG record at ICT-01 (AUTO-LINE seq=3)...");
  try {
    const r = await query(
      `INSERT INTO ng_defect_records (occurred_at, line_name, station_code, sn, result, channel, error_code, operator)
       VALUES (NOW(), 'AUTO-LINE', 'ICT-01', $1, 'fail', 'CH-A', 'ERR-ICT', 'test_op') RETURNING id`,
      [TEST_SN]
    );
    console.log(`    ✓ NG id=${r.rows[0].id}`);
    passed++;
  } catch (e) { console.log(`    ✗ ${e.message}`); failed++; }

  // Step 4: Check all stations
  console.log("\n[4] NG upstream check — all 32 stations...");
  console.log("─".repeat(85));
  console.log(`${"Station".padEnd(20)} ${"Line".padEnd(14)} ${"Seq"} ${"Count"}  ${"Expected"}`);
  console.log("─".repeat(85));

  for (const s of stations) {
    let count, expected;
    try {
      // Query upstream NGs (replicate server.js logic)
      const caller = await query(
        `SELECT line_code, sequence_order, parent_line_code FROM station_sequences
         WHERE station_code = $1 AND line_code = $2 LIMIT 1`,
        [s.stationCode, s.lineCode]
      );
      if (caller.rows.length === 0) {
        console.log(`${s.stationCode.padEnd(20)} ${s.lineCode.padEnd(14)} ${String(s.seq).padStart(3)}    ?  ${"N/A".padStart(8)}  ✗ station not found`);
        failed++;
        continue;
      }
      const { line_code, sequence_order, parent_line_code } = caller.rows[0];

      let sql = `SELECT COUNT(*) as cnt FROM ng_defect_records ng
                 JOIN station_sequences s ON s.station_code = ng.station_code
                 WHERE ng.sn = $1 AND ng.result = 'fail'
                   AND ng.line_name = s.line_code
                   AND s.line_code = $2 AND s.sequence_order < $3`;
      let params = [TEST_SN, line_code, sequence_order];

      if (parent_line_code) {
        sql = `SELECT COUNT(*) as cnt FROM (
                 SELECT ng.id FROM ng_defect_records ng
                 JOIN station_sequences s ON s.station_code = ng.station_code
                 WHERE ng.sn = $1 AND ng.result = 'fail'
                   AND s.line_code = $2 AND s.sequence_order < $3
                 UNION ALL
                 SELECT ng.id FROM ng_defect_records ng
                 JOIN station_sequences ps ON ps.station_code = ng.station_code
                 WHERE ng.sn = $1 AND ng.result = 'fail'
                   AND ng.line_name = ps.line_code
                   AND ps.line_code = $4
               ) t`;
        params = [TEST_SN, line_code, sequence_order, parent_line_code];
      }

      const r = await query(sql, params);
      count = parseInt(r.rows[0].cnt);

      // Expected: NG at ICT-01 (AUTO-LINE seq=3)
      if (s.lineCode === "AUTO-LINE" && s.seq > 3) expected = 1;
      else if (s.lineCode === "PACK-LINE") expected = 1;
      else if (s.lineCode === "MANUAL-LINE") expected = 0;
      else if (s.lineCode === "SMT-LINE") expected = 0;
      else expected = 0;

      const ok = count === expected;
      if (ok) passed++; else failed++;
      console.log(
        `${s.stationCode.padEnd(20)} ${s.lineCode.padEnd(14)} ${String(s.seq).padStart(3)} ${String(count).padStart(5)}  ${String(expected).padStart(8)}  ${ok ? "✓" : "✗ FAIL"}`
      );
    } catch (e) {
      console.log(`${s.stationCode.padEnd(20)} ${s.lineCode.padEnd(14)} ${String(s.seq).padStart(3)}    -  ${"ERR".padStart(8)}  ✗ ${e.message.substring(0, 60)}`);
      failed++;
    }
  }

  // Step 5: PACK-LINE parent check
  console.log("\n[5] PACK-LINE parent inheritance (HIPOT-PACK-01 sees AUTO-LINE NG)...");
  try {
    const r = await query(
      `SELECT ng.id, ng.line_name as "lineCode" FROM ng_defect_records ng
       JOIN station_sequences ps ON ps.station_code = ng.station_code
       WHERE ng.sn = $1 AND ng.result = 'fail' AND ps.line_code = 'AUTO-LINE'`,
      [TEST_SN]
    );
    const fromParent = r.rows.length;
    if (fromParent === 1) { console.log(`    ✓ from AUTO-LINE: ${fromParent}`); passed++; }
    else { console.log(`    ✗ expected 1, got ${fromParent}`); failed++; }
  } catch (e) { console.log(`    ✗ ${e.message}`); failed++; }

  // Step 6: Duplicate SN check
  console.log("\n[6] Duplicate SN detection...");
  try {
    await query(
      `INSERT INTO sn_duplicate_attempts (line_name, station_code, sn, action, decision)
       VALUES ('AUTO-LINE', 'AOI-01', $1, 'station_scan', 'BLOCKED')`,
      [TEST_SN]
    );
    const r = await query(
      `SELECT COUNT(*) as cnt FROM sn_duplicate_attempts WHERE sn = $1 AND station_code = 'AOI-01'`,
      [TEST_SN]
    );
    if (parseInt(r.rows[0].cnt) >= 1) { console.log(`    ✓ dup count=${r.rows[0].cnt}`); passed++; }
    else { console.log(`    ✗`); failed++; }
  } catch (e) { console.log(`    ✗ ${e.message}`); failed++; }

  // Cleanup
  console.log("\n[7] Cleanup...");
  try {
    await query(`DELETE FROM ng_defect_records WHERE sn = $1`, [TEST_SN]);
    await query(`DELETE FROM sn_duplicate_attempts WHERE sn = $1`, [TEST_SN]);
    console.log("    ✓");
    passed++;
  } catch (e) { console.log(`    ✗ ${e.message}`); failed++; }

  console.log("\n" + "═".repeat(50));
  console.log(`TOTAL: ${passed} passed / ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().finally(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
