#!/usr/bin/env node
/**
 * Run one cycle (or all configured probes) of the virtual-employee runner.
 *   node scripts/ve-runner.mjs --dry-run --all
 * --rag recalls each employee's own experience plus the shared corpus and
 * attaches what was cited to the task input as evidence.
 *   node scripts/ve-runner.mjs --employee=IQC-VIRTUAL-01 --limit=3
 * Writes only to factory_virtual_employee_tasks / _events. No auto-approval.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runEmployeeCycle, runAllCycles, PROBES } from "../services/api/src/agent/runner.js";
import { defaultKnowledgeService } from "../services/api/src/agent/knowledge.js";
import { memoryHealth } from "../services/_shared/memory-client.js";

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
const limit = Number(args.limit || 5);
const rag = Boolean(args.rag);
const ids = args.all ? Object.keys(PROBES) : args.employee ? [args.employee] : [];
if (!ids.length) {
  console.error(`Choose --employee=<id> or --all. Available: ${Object.keys(PROBES).join(", ")}`);
  process.exit(2);
}

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});
const query = (text, params) => pool.query(text, params);
let knowledge = null;
if (rag) {
  knowledge = defaultKnowledgeService();
  try {
    const health = await memoryHealth();
    if (health?.ok !== true) console.error(`MEMORY_SERVER_UNHEALTHY ${JSON.stringify(health)} — tasks will record the recall error`);
  } catch (err) {
    console.error(`MEMORY_SERVER_UNREACHABLE ${err.message} — evidence will carry recallError`);
  }
}

try {
  const results = ids.length === 1
    ? [await runEmployeeCycle({ employeeId: ids[0], query, limit, dryRun, knowledge })]
    : await runAllCycles({ employeeIds: ids, query, limit, dryRun, knowledge });
  console.log(JSON.stringify({ dryRun, limit, rag, results }, null, 2));
} catch (err) {
  console.error(`RUNNER_FAILED ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
