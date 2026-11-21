#!/usr/bin/env node
/**
 * Self-learning cycle for virtual employees (uses the existing HR training tables).
 *   node scripts/ve-learn.mjs --dry-run --all
 *   node scripts/ve-learn.mjs --employee=WMS-RECEIVING-VIRTUAL-01
 *   node scripts/ve-learn.mjs --review=12 --reviewer=admin --pass
 * Cases are created as DRAFT; only a human reviewer can approve them.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { learningCycle, learnFromCorrections, reviewTrainingRun, allEmployeeIds } from "../services/api/src/agent/learning.js";

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

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});
const query = (text, params) => pool.query(text, params);

try {
  if (args.review) {
    const result = await reviewTrainingRun({
      query, runId: Number(args.review), reviewer: args.reviewer,
      pass: Boolean(args.pass), feedback: args.feedback || "",
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else {
    const ids = args.all ? allEmployeeIds() : args.employee ? [args.employee] : [];
    if (!ids.length) {
      console.error(`Choose --employee=<id> or --all. There are ${allEmployeeIds().length} employees in the registry.`);
      process.exit(2);
    }
    const result = ids.length === 1
      ? await learnFromCorrections({ employeeId: ids[0], query, limit, dryRun })
      : await learningCycle({ employeeIds: ids, query, limit, dryRun });
    console.log(JSON.stringify({ dryRun, limit, ...result }, null, 2));
  }
} catch (err) {
  console.error(`LEARN_FAILED ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
