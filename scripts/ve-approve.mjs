#!/usr/bin/env node
/**
 * Human batch approval for gated virtual-employee tasks. The CLI is only a
 * driver: every rule lives in services/api/src/agent/approval.js, the same
 * module the HTTP approve route calls, so a batch cannot slip past a check the
 * UI enforces.
 *
 *   node scripts/ve-approve.mjs --list                       # queue by gate
 *   node scripts/ve-approve.mjs --gate=receive_variance --limit=5          # dry run
 *   node scripts/ve-approve.mjs --gate=receive_variance --reviewer=admin --confirm=admin
 *   node scripts/ve-approve.mjs --ids=175601,175602 --reviewer=admin --confirm=admin
 *
 * There is no default reviewer and no --reviewer=ve:... a virtual employee can
 * never approve, and `--confirm` must repeat the human's own username.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { approveTask, pendingQueue, reviewerPermissions } from "../services/api/src/agent/approval.js";
import { getFactoryVirtualEmployee } from "../services/api/src/virtual-employees/registry.js";

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
const limit = Number(args.limit || 20);
const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});
const query = (text, params) => pool.query(text, params);

function fail(code, message) {
  console.log(JSON.stringify({ ok: false, code, message }, null, 2));
  process.exitCode = 2;
}

try {
  const queue = await pendingQueue({ query, gate: args.gate || null, employeeId: args.employee || null, limit: 500 });
  if (args.list || !args.reviewer) {
    console.log(JSON.stringify({ action: "queue", note: "no reviewer supplied — nothing was approved", ...queue }, null, 2));
    if (!args.list) process.exitCode = 2;
  } else {
    if (/^ve:/i.test(args.reviewer)) fail("VE_CANNOT_APPROVE", "a virtual employee identity cannot approve");
    else if (String(args.confirm || "") !== String(args.reviewer)) {
      fail("CONFIRM_REQUIRED", `--confirm must repeat the reviewer username (${args.reviewer}); approvals are attributed to that human`);
    } else {
      const reviewer = await reviewerPermissions({ query, username: args.reviewer });
      if (!reviewer.ok) fail(reviewer.code, `reviewer ${args.reviewer}: ${reviewer.code}`);
      else {
        let candidates = [];
        if (args.ids) {
          const ids = String(args.ids).split(",").map(x => Number(x.trim())).filter(Boolean);
          candidates = (await query(
            `SELECT * FROM factory_virtual_employee_tasks WHERE id = ANY($1::int[]) ORDER BY id`, [ids])).rows;
        } else {
          // Same predicate and the same ordering as pendingQueue(), so the queue
          // --list shows is exactly the set this call approves.
          candidates = (await query(
            `SELECT * FROM factory_virtual_employee_tasks
              WHERE status='WAITING_APPROVAL' AND requires_human
                AND ($1::text IS NULL OR human_gate=$1)
                AND ($2::text IS NULL OR employee_id=$2)
              ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
                       created_at
              LIMIT $3`, [args.gate || null, args.employee || null, limit])).rows;
        }
        const results = [];
        for (const task of candidates) {
          const r = await approveTask({ query, task, employee: getFactoryVirtualEmployee(task.employee_id),
            actor: reviewer.username, permissions: reviewer.permissions });
          results.push({ taskId: task.id, gate: task.human_gate, ok: r.ok, code: r.code || null,
            required: r.required || null, writeback: r.writeback ? { applied: r.writeback.applied, code: r.writeback.code, targetTaskId: r.writeback.targetTaskId ?? null, duplicate: !!r.writeback.duplicate } : null });
        }
        console.log(JSON.stringify({
          action: "approve", reviewer: reviewer.username, displayName: reviewer.displayName,
          permissionCount: reviewer.permissions.length, attempted: results.length,
          approved: results.filter(r => r.ok).length,
          refused: results.filter(r => !r.ok).map(r => ({ taskId: r.taskId, code: r.code, required: r.required })),
          writeback: {
            applied: results.filter(r => r.writeback?.applied).length,
            unsupported: results.filter(r => r.writeback?.code === "WRITEBACK_UNSUPPORTED").length,
            noSuchGate: results.filter(r => r.writeback?.code === "WRITEBACK_NO_SUCH_GATE").length,
            failed: results.filter(r => r.writeback?.code === "WRITEBACK_FAILED").length,
          },
          results,
        }, null, 2));
        if (results.length && results.every(r => !r.ok)) process.exitCode = 1;
      }
    }
  }
} catch (err) {
  console.error(`APPROVE_FAILED ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
