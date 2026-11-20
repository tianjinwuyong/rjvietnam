#!/usr/bin/env node
/**
 * Collect field knowledge for virtual employees through the shared knowledge
 * policy. One RAG service, one namespace per employee.
 *   node scripts/ve-knowledge.mjs --dry-run --all
 *   node scripts/ve-knowledge.mjs --employee=IQC-VIRTUAL-01 --remember
 *   node scripts/ve-knowledge.mjs --docs --dry-run          # OA 受控文件（L1）
 *   node scripts/ve-knowledge.mjs --docs --levels=1,2,3 --remember
 * Without --remember nothing is written to mem0: collection is reported only,
 * so a stopped memory server can never be mistaken for a successful store.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { knowledgeCycle, collectFieldKnowledge, collectControlledDocs, DOC_LEVELS_DEFAULT, allKnowledgeEmployeeIds, defaultKnowledgeService } from "../services/api/src/agent/knowledge.js";
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
const remember = Boolean(args.remember) && !dryRun;

const docs = Boolean(args.docs);
const ids = args.all ? allKnowledgeEmployeeIds() : args.employee ? [args.employee] : [];
if (!docs && !ids.length) {
  console.error(`Choose --employee=<id>, --all, or --docs. There are ${allKnowledgeEmployeeIds().length} employees in the registry.`);
  process.exit(2);
}

let memory = null;
if (remember) {
  try {
    memory = await memoryHealth();
  } catch (err) {
    console.error(`MEMORY_SERVER_UNREACHABLE ${err.message} — run without --remember to collect only.`);
    process.exit(1);
  }
}

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});
const query = (text, params) => pool.query(text, params);
const knowledge = remember ? defaultKnowledgeService() : null;

try {
  const result = docs
    ? await collectControlledDocs({ query, knowledge, dryRun,
        levels: args.levels ? String(args.levels).split(",").map(Number) : DOC_LEVELS_DEFAULT })
    : ids.length === 1
      ? await collectFieldKnowledge({ employeeId: ids[0], query, knowledge, dryRun })
      : await knowledgeCycle({ employeeIds: ids, query, knowledge, dryRun });
  console.log(JSON.stringify({ dryRun, remember, memoryServer: memory, ...result }, null, 2));
  if (remember && result.stored === 0 && result.collected > 0) process.exitCode = 1;
} catch (err) {
  console.error(`KNOWLEDGE_FAILED ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
