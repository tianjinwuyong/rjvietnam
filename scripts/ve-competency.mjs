#!/usr/bin/env node
/**
 * Synthesize the four competencies (四力) for every enabled virtual employee
 * from real rows. Deterministic: thresholds over tasks, training, knowledge and
 * retrieval evidence — no model judgement.
 *   node scripts/ve-competency.mjs --dry-run
 *   node scripts/ve-competency.mjs --week            # last 7 days
 *   node scripts/ve-competency.mjs --start=2026-11-01 --end=2026-11-07
 * Computed rows never overwrite a human-signed row (see competency.js WHERE
 * clause); --show prints computed vs signed side by side.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { synthesizeCompetencies, signCompetency, FORCES } from "../services/api/src/agent/competency.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");
if (existsSync(ENV_PATH)) {
  for (const raw of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^PG[A-Z_]+$/.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v = "1"] = a.replace(/^--/, "").split("=");
  return [k, v];
}));
const dryRun = Boolean(args["dry-run"]);
const iso = d => d.toISOString().slice(0, 10);
const today = new Date();
let periodStart = args.start ? new Date(`${args.start}T00:00:00Z`) : new Date(today.getTime() - 6 * 86400000);
let periodEnd = args.end ? new Date(`${args.end}T00:00:00Z`) : today;
const startS = iso(periodStart), endS = iso(periodEnd);

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});
const query = (text, params) => pool.query(text, params);

try {
  if (args.sign) {
    const [employeeId, force, level, ...rest] = String(args.sign).split(":");
    const reviewer = args.reviewer;
    if (!FORCES.includes(force)) throw new Error(`UNKNOWN_FORCE ${force} (expected one of ${FORCES.join(", ")})`);
    const result = await signCompetency({ query, employeeId, force, level: Number(level), reviewer, periodStart: startS, periodEnd: endS });
    console.log(JSON.stringify({ action: "sign", periodStart: startS, periodEnd: endS, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else {
    const result = await synthesizeCompetencies({ query, periodStart: startS, periodEnd: endS, dryRun });
    const summary = {};
    for (const row of result.rows) summary[row.employeeId] = { ...(summary[row.employeeId] || {}), [row.force]: row.level };
    console.log(JSON.stringify({
      dryRun, periodStart: startS, periodEnd: endS,
      employees: result.employees, forces: FORCES,
      levelsBelow2: Object.values(summary).flat().filter(v => v < 2).length,
      summary,
    }, null, 2));
  }

  if (args.show) {
    const stored = await query(`SELECT employee_id, force, level, assessed_by,
        COALESCE(metric->>'signed','false') AS signed
      FROM ve_competency_snapshots WHERE period_start=$1 AND period_end=$2
      ORDER BY employee_id, force`, [startS, endS]);
    console.log(JSON.stringify({ stored: stored.rowCount, rows: stored.rows.slice(0, Number(args.show) * 4 || 20) }, null, 2));
  }
} catch (err) {
  console.error(`COMPETENCY_FAILED ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
