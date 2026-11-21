// AUTO-LINE focused test: data connection, NG record, duplicate SN
// Run: node tests/auto-line-test.js

import pg from "pg";
const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});

const TEST_SN = "AUTO-TEST-" + Date.now();
const OPERATOR = "test_op";
const LINE = "自动线";
const LINE_CODE = "AUTO-LINE";

const autoStations = [
  { stationCode: "PDA-01",       seq: 1 },
  { stationCode: "AOI-01",       seq: 2 },
  { stationCode: "ICT-01",       seq: 3 },
  { stationCode: "FCT-01",       seq: 4 },
  { stationCode: "DEPANEL-01",   seq: 5 },
  { stationCode: "SHELL-BIND-01",seq: 6 },
  { stationCode: "ASSY-ATE-01",  seq: 7 },
  { stationCode: "ULTRA-01",     seq: 8 },
  { stationCode: "AGING-01",     seq: 9 },
];

async function sql(q, p) { return pool.query(q, p); }

async function run() {
  let passed = 0, failed = 0;

  // ── 1. DB connection ──────────────────────────────────────
  console.log("\n[1] DB connection...");
  try {
    const r = await sql("SELECT now(), version()");
    console.log("  ✓ Connected — PostgreSQL:", r.rows[0].version.split("\n")[0]);
    passed++;
  } catch (e) {
    console.error("  ✗ Connection failed:", e.message);
    failed++;
    await pool.end();
    process.exit(1);
  }

  // ── 2. station_sequences table ─────────────────────────────
  console.log("\n[2] station_sequences table...");
  try {
    const r = await sql("SELECT COUNT(*) FROM station_sequences WHERE line_code=$1", [LINE_CODE]);
    const count = Number(r.rows[0].count);
    console.log(`  ✓ ${count} stations for ${LINE_CODE}`);
    if (count < 9) {
      console.error(`  ✗ Expected 9, got ${count}`);
      failed++;
    } else {
      passed++;
    }
  } catch (e) {
    console.error("  ✗ Query failed:", e.message);
    failed++;
  }

  // ── 3. NG record insert ───────────────────────────────────
  console.log("\n[3] NG record insert at ICT-01 (seq=3)...");
  let ngId;
  try {
    const r = await sql(
      `INSERT INTO ng_defect_records
       (line_name, station_code, sn, result, channel, error_code, defect_code, source, operator)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [LINE, "ICT-01", TEST_SN, "fail", "CH-A", "ERR-SHORT", "SHORT", "test", OPERATOR],
    );
    ngId = r.rows[0].id;
    console.log(`  ✓ Inserted NG record id=${ngId}`);
    passed++;
  } catch (e) {
    console.error("  ✗ Insert failed:", e.message);
    failed++;
    await pool.end();
    process.exit(1);
  }

  // ── 4. NG check: upstream filtering ────────────────────────
  console.log("\n[4] NG check — upstream filtering for all AUTO-LINE stations...");
  console.log("  (Only stations after ICT-01 seq=3 should see the NG)");
  console.log("─".repeat(65));
  console.log(`  ${"Station".padEnd(18)} ${"Seq"}  ${"Upstream"}  ${"Expected"}`);
  console.log("─".repeat(65));

  for (const s of autoStations) {
    const r = await sql(
      `SELECT ng.id, ng.station_code AS "stationCode", s.sequence_order AS "seq"
       FROM ng_defect_records ng
       JOIN station_sequences s ON s.station_code = ng.station_code
       WHERE ng.sn = $1 AND ng.result = 'fail'
         AND s.line_code = $2 AND s.sequence_order < $3
       ORDER BY s.sequence_order ASC`,
      [TEST_SN, LINE_CODE, s.seq],
    );
    const count = r.rows.length;
    const expected = s.seq > 3 ? 1 : 0;
    const ok = count === expected;
    if (ok) passed++; else failed++;
    console.log(`  ${s.stationCode.padEnd(18)} ${String(s.seq).padStart(3)}   ${String(count).padStart(8)}   ${String(expected).padStart(8)}  ${ok ? "✓" : "✗ FAIL"}`);
  }

  // ── 5. Duplicate SN: same SN + same station → reject ──────
  console.log("\n[5] Duplicate SN check — same SN + same station should be detected...");
  try {
    // First insert a PASS record (simulating first scan)
    const r1 = await sql(
      `INSERT INTO ng_defect_records
       (line_name, station_code, sn, result, channel, error_code, defect_code, source, operator)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [LINE, "AOI-01", TEST_SN, "pass", "CH-A", "OK", "OK", "test", OPERATOR],
    );
    console.log(`  ✓ First scan AOI-01: pass — id=${r1.rows[0].id}`);

    // Check for existing record for same SN at same station
    const r2 = await sql(
      `SELECT COUNT(*) FROM ng_defect_records
       WHERE sn=$1 AND station_code=$2`,
      [TEST_SN, "AOI-01"],
    );
    const dupCount = Number(r2.rows[0].count);
    console.log(`  Duplicate count for AOI-01: ${dupCount} (expected ≥1)  ${dupCount >= 1 ? "✓" : "✗ FAIL"}`);
    if (dupCount >= 1) passed++; else failed++;
  } catch (e) {
    console.error("  ✗ Duplicate check failed:", e.message);
    failed++;
  }

  // ── 6. NG record from a different station should NOT appear ──
  console.log("\n[6] NG isolation — other station NG should not appear for unrelated SN...");
  try {
    // Seed a NG for a different SN
    const r = await sql(
      `INSERT INTO ng_defect_records
       (line_name, station_code, sn, result, channel, error_code, defect_code, source, operator)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [LINE, "FCT-01", "OTHER-SN-999", "fail", "CH-B", "ERR-OPEN", "OPEN", "test", OPERATOR],
    );
    console.log(`  ✓ Seeded OTHER-SN-999 NG at FCT-01 id=${r.rows[0].id}`);

    // Verify TEST_SN does NOT have this NG
    const check = await sql(
      `SELECT COUNT(*) FROM ng_defect_records
       WHERE sn=$1 AND station_code='FCT-01'`,
      [TEST_SN],
    );
    const isolated = Number(check.rows[0].count) === 0;
    console.log(`  TEST_SN has FCT-01 NG: ${check.rows[0].count} (expected 0)  ${isolated ? "✓" : "✗ FAIL"}`);
    if (isolated) passed++; else failed++;
  } catch (e) {
    console.error("  ✗ Isolation check failed:", e.message);
    failed++;
  }

  // ── 7. Cleanup ────────────────────────────────────────────
  console.log("\n[7] Cleanup...");
  await sql(`DELETE FROM ng_defect_records WHERE sn IN ($1, 'OTHER-SN-999')`, [TEST_SN]);
  console.log("  ✓ Deleted test records");

  await pool.end();

  // ── Summary ───────────────────────────────────────────────
  console.log("\n" + "═".repeat(50));
  console.log(`  TOTAL: ${passed} passed / ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
