#!/usr/bin/env node
/**
 * The cadence executor for the virtual-employee org: the missing actor that
 * frequencies.js described. One process, one minute tick, deterministic probes
 * only — the model is never called from here (threshold-crossing judgement is
 * still a human-gated draft task).
 *
 *   npm run schedule:ve -- --once --dry-run      # one pass, nothing written
 *   npm run schedule:ve -- --once                # one pass, real
 *   npm run schedule:ve                          # loop (supervise it like the other services)
 *   npm run schedule:ve -- --no-rag              # skip memory recall/store
 *
 * EVENT and WATCH employees are due when their intervalSeconds elapsed; BATCH
 * employees fire on their cron minute in Asia/Ho_Chi_Minh; DEMAND employees are
 * never scheduled. Nightly jobs: corrections -> training cases (22:30), field
 * knowledge (23:00); weekly: competency (Mon 06:00). Every action is idempotent
 * through task_key / case_key, so a restarted loop cannot double-create work.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import pg from "pg";
import { dueNow, dueJobs, localParts, TICK_MS, loadLastRun, recordTick, SCHEDULER_OWNER } from "../services/api/src/agent/scheduler.js";
import { runEmployeeCycle } from "../services/api/src/agent/runner.js";
import { learnFromCorrections, allEmployeeIds } from "../services/api/src/agent/learning.js";
import { knowledgeCycle, collectControlledDocs, allKnowledgeEmployeeIds, defaultKnowledgeService } from "../services/api/src/agent/knowledge.js";
import { synthesizeCompetencies } from "../services/api/src/agent/competency.js";
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
const useRag = !args["no-rag"] && !dryRun;
const limit = Number(args.limit || 5);
const tickMs = Math.max(15, Number(args.tick || 60)) * 1000;

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});
const query = (text, params) => pool.query(text, params);
const knowledge = defaultKnowledgeService();
const lastRun = {};   // hydrated from SCHEDULER_TICK events on boot
let memoryOk = false;

const log = obj => console.log(JSON.stringify({ at: new Date().toISOString(), local: localParts().minuteKey, dryRun, ...obj }));

async function refreshMemoryHealth() {
  if (!useRag) { memoryOk = false; return; }
  try {
    const health = await memoryHealth();
    memoryOk = health?.ok === true;
  } catch {
    memoryOk = false;
  }
}

async function runCycle(employeeId) {
  const result = await runEmployeeCycle({ employeeId, query, limit, dryRun, knowledge: memoryOk ? knowledge : null });
  return result;
}

async function runJob(job) {
  if (job === "learn") {
    const out = [];
    for (const id of allEmployeeIds()) out.push(await learnFromCorrections({ employeeId: id, query }));
    return { cases: out.reduce((s, r) => s + (r.casesCreated || 0), 0), scanned: out.reduce((s, r) => s + (r.scanned || 0), 0) };
  }
  if (job === "knowledge") {
    const field = await knowledgeCycle({ employeeIds: allKnowledgeEmployeeIds(), query, knowledge: memoryOk ? knowledge : null, dryRun });
    const docs = await collectControlledDocs({ query, knowledge: memoryOk ? knowledge : null, dryRun });
    return { fieldStored: field.stored, docsScanned: docs.scanned, docsStored: docs.stored, memoryOk };
  }
  if (job === "competency") {
    const start = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const out = await synthesizeCompetencies({ query, periodStart: start, periodEnd: end, dryRun });
    return { employees: out.employees, rows: out.rows?.length ?? 0 };
  }
  if (job === "report") {
    if (dryRun) return { skipped: "dry-run" };
    const child = spawn(process.execPath, [join(ROOT, "scripts", "ve-report.mjs"), "--aggregate"], { stdio: "ignore", detached: false });
    const code = await new Promise(resolve => child.on("close", resolve));
    return { exitCode: code };
  }
  return { skipped: "UNKNOWN_JOB" };
}

async function tick() {
  await refreshMemoryHealth();
  const now = new Date();
  const due = dueNow({ now, lastRun });
  const jobs = dueJobs({ now, lastRun });
  const stamp = now.toISOString();
  const actions = [];
  for (const item of due) {
    if (item.reason === "FREQUENCY_NOT_DECLARED") { actions.push({ employeeId: item.employeeId, skipped: "FREQUENCY_NOT_DECLARED" }); continue; }
    const key = item.secondary ? `${item.employeeId}#secondary` : item.employeeId;
    const result = item.secondary
      ? await collectControlledDocs({ query, knowledge: memoryOk ? knowledge : null, dryRun })
      : await runCycle(item.employeeId);
    lastRun[key] = stamp;
    const effect = item.secondary
      ? { docsStored: result.stored }
      : { scanned: result.scanned, created: result.created, duplicate: result.duplicate, cited: result.cited, skipped: result.skipped || null };
    actions.push({ employeeId: item.employeeId, kind: item.kind, reason: item.reason, ...effect });
    // Only an effect is worth a durable record; a no-op repeat is harmless
    // because successor tasks are keyed by task_key.
    if (!dryRun && (effect.created > 0 || effect.docsStored > 0)) {
      await recordTick({ query, key, employeeId: item.employeeId, detail: effect });
    }
  }
  for (const job of jobs) {
    const result = await runJob(job.job);
    lastRun[job.job] = stamp;
    actions.push({ job: job.job, reason: job.reason, ...result });
    const produced = result.cases > 0 || result.fieldStored > 0 || result.docsStored > 0 || result.rows > 0 || result.exitCode === 0;
    if (!dryRun && produced) {
      await recordTick({ query, key: job.job, employeeId: SCHEDULER_OWNER, detail: { job: job.job, ...result } });
    }
  }
  if (actions.length) log({ memoryOk, actions });
  else log({ memoryOk, actions: [], idle: true });
  return actions.length;
}

try {
  Object.assign(lastRun, await loadLastRun({ query, hours: Number(args["rehydrate-hours"] || 24) }));
  log({ hydrated: Object.keys(lastRun).length, note: "last-run 状态从 SCHEDULER_TICK 事件恢复" });
  if (args.once) {
    await tick();
  } else {
    log({ started: true, tickMs, note: "Ctrl-C to stop; every action is idempotent" });
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await tick();
      } catch (err) {
        log({ tickError: String(err.message || err) });
      }
      await new Promise(resolve => setTimeout(resolve, tickMs));
    }
  }
} catch (err) {
  console.error(`SCHEDULER_FAILED ${err.message}`);
  process.exitCode = 1;
} finally {
  if (args.once) await pool.end();
}
