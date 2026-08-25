/**
 * pda-iqc.js — PDA IQC 检验接口
 * Incoming Quality Control — scan, measure, verdict.
 *
 * Usage:
 *   node pda-iqc.js check   --lot <lot> (show lot IQC data)
 *   node pda-iqc.js record  --lot <lot> --measurement <value> [--specMin <n> --specMax <n> --result PASS|FAIL|RWORK]
 *                            [--photo <path>]
 *   node pda-iqc.js verdict --lot <lot> --verdict PASS|FAIL|REWORK [--remark <text>]
 *   node pda-iqc.js history --material <code>
 */

import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  host     : process.env.PGHOST     ?? "127.0.0.1",
  port     : Number(process.env.PGPORT ?? 5432),
  user     : process.env.PGUSER     ?? "postgres",
  password : process.env.PGPASSWORD ?? "postgres",
  database : process.env.PGDATABASE ?? "smt_factory",
  max      : 3,
});

// ── Ensure table exists ─────────────────────────────────────────────────
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS iqc_records (
      id            bigserial PRIMARY KEY,
      lot_no        varchar(60) NOT NULL,
      measurement   numeric(12,4),
      spec_min      numeric(12,4),
      spec_max      numeric(12,4),
      result        varchar(20),       -- PASS|FAIL|RWORK
      photo_path    varchar(255),
      inspector     varchar(80) DEFAULT 'pda-iqc',
      checked_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_iqc_lot ON iqc_records(lot_no);
  `).catch(() => {});
}

// ── Check IQC data for a lot ─────────────────────────────────────────────
async function checkIqc(lotNo) {
  const lots = await pool.query(
    `SELECT * FROM material_lots WHERE lot_no = $1`, [lotNo]
  );
  const records = await pool.query(
    `SELECT * FROM iqc_records WHERE lot_no = $1 ORDER BY checked_at`, [lotNo]
  );
  return {
    lot: lots.rows[0] ?? null,
    iqcRecords: records.rows,
    totalChecks: records.rows.length,
    passCount: records.rows.filter(r => r.result === "PASS").length,
    failCount: records.rows.filter(r => r.result === "FAIL").length,
  };
}

// ── Record measurement ───────────────────────────────────────────────────
async function recordIqc(lotNo, measurement, specMin, specMax, result, photoPath) {
  await pool.query(
    `INSERT INTO iqc_records (lot_no, measurement, spec_min, spec_max, result, photo_path)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [lotNo, measurement ?? null, specMin ?? null, specMax ?? null, result ?? null, photoPath ?? null]
  );

  // If FAIL or RWORK recorded, update lot status
  if (result === "FAIL" || result === "RWORK") {
    await pool.query(
      `UPDATE material_lots SET iqc_status = $1, updated_at = now() WHERE lot_no = $2`,
      [result === "FAIL" ? "iqc_failed" : "iqc_rework", lotNo]
    );
  }

  return { lot_no: lotNo, measurement, result };
}

// ── Final verdict ────────────────────────────────────────────────────────
async function verdictIqc(lotNo, verdict, remark) {
  const newStatus = verdict === "PASS" ? "released" : verdict === "FAIL" ? "iqc_failed" : "iqc_rework";
  await pool.query(
    `UPDATE material_lots
     SET iqc_status = $1, status = $1, remark = $2, checked_at = now(), updated_at = now()
     WHERE lot_no = $3`,
    [newStatus, remark ?? null, lotNo]
  );
  return { lot_no: lotNo, verdict, status: newStatus };
}

// ── History by material code ─────────────────────────────────────────────
async function historyByMaterial(materialCode) {
  const rows = await pool.query(`
    SELECT ml.*, iqr.measurement, iqr.result AS iqc_result, iqr.checked_at AS iqc_at
    FROM material_lots ml
    LEFT JOIN iqc_records iqr ON iqr.lot_no = ml.lot_no
    WHERE ml.material_code = $1
    ORDER BY ml.created_at DESC
    LIMIT 20
  `, [materialCode]);
  return rows.rows;
}

// ── CLI ──────────────────────────────────────────────────────────────────
async function main() {
  await ensureTable();

  const [action, ...args] = process.argv.slice(2);
  const get = (name, fallback = "") => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i+1]??fallback : fallback;
  };

  try {
    let result;
    switch (action) {
      case "check":
        result = await checkIqc(get("lot"));
        break;
      case "record":
        result = await recordIqc(
          get("lot"),
          Number(get("measurement", 0)),
          Number(get("specMin", 0)),
          Number(get("specMax", 0)),
          get("result"),
          get("photo")
        );
        break;
      case "verdict":
        result = await verdictIqc(get("lot"), get("verdict"), get("remark"));
        break;
      case "history":
        result = await historyByMaterial(get("material"));
        break;
      default:
        console.error("Usage: pda-iqc.js check|record|verdict|history [--key val]");
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
