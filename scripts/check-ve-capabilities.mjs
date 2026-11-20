#!/usr/bin/env node
/**
 * Capability-contract gate for the virtual-employee org.
 *   npm run check:ve-capabilities            static only
 *   npm run check:ve-capabilities -- --db    also re-read the live permission
 *                                            table and ve_reporting_lines
 * Fails on: unknown skill/mcp ids, permission keys that are not in the catalog,
 * write skills with no human gate, gates the runtime would refuse
 * (WRITE_GATE_NOT_IN_REGISTRY), registry capabilities missing from the matrix,
 * roles with no skills, skills assigned to nobody, and — with --db — any drift
 * between the mirrored PERMISSION_CODES and `permissions`, or a role in
 * `ve_reporting_lines` with no capability row.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const useDb = process.argv.includes("--db");

const [{ auditCapabilities, PERMISSION_CODES, ALL_ROLE_IDS, MCP_SERVERS, SKILLS, ROLE_CAPABILITIES },
        { FACTORY_VIRTUAL_EMPLOYEES }] = await Promise.all([
  import("../services/api/src/virtual-employees/capabilities.js"),
  import("../services/api/src/virtual-employees/registry.js"),
]);

const { problems, warnings, skills, roles } = auditCapabilities({ registryEntries: FACTORY_VIRTUAL_EMPLOYEES });
const lines = [];
lines.push(`CAPABILITY_CONTRACT roles=${roles} skills=${skills} registry=${FACTORY_VIRTUAL_EMPLOYEES.length} mcp=${Object.keys(MCP_SERVERS).length}`);

if (useDb) {
  const { default: pg } = await import("pg");
  const ENV_PATH = join(ROOT, ".env");
  const env = {};
  if (existsSync(ENV_PATH)) {
    for (const raw of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!/^PG[A-Z_]+$/.test(key)) continue;
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      env[key] = value;
    }
  }
  const pool = new pg.Pool({
    host: env.PGHOST ?? "127.0.0.1", port: Number(env.PGPORT ?? 5432),
    user: env.PGUSER ?? "postgres", password: env.PGPASSWORD ?? "postgres",
    database: env.PGDATABASE ?? "smt_factory",
  });
  try {
    const live = (await pool.query("SELECT code FROM permissions ORDER BY 1")).rows.map(r => r.code);
    const missing = PERMISSION_CODES.filter(c => !live.includes(c));
    const added = live.filter(c => !PERMISSION_CODES.includes(c));
    if (missing.length) problems.push({ code: "PERMISSION_MIRROR_STALE", permissions: missing });
    if (added.length) warnings.push({ code: "PERMISSION_NOT_MIRRORED", count: added.length, sample: added.slice(0, 8) });
    lines.push(`PERMISSIONS live=${live.length} mirrored=${PERMISSION_CODES.length} stale=${missing.length}`);

    const dbRoles = (await pool.query("SELECT employee_id FROM ve_reporting_lines ORDER BY 1")).rows.map(r => r.employee_id);
    const undeclared = dbRoles.filter(id => !ALL_ROLE_IDS.includes(id));
    if (undeclared.length) problems.push({ code: "ROLE_UNDECLARED_IN_DB", roles: undeclared });
    const extra = ALL_ROLE_IDS.filter(id => !dbRoles.includes(id));
    if (extra.length) problems.push({ code: "ROLE_NOT_IN_REPORTING_LINES", roles: extra });
    lines.push(`ROLES db=${dbRoles.length} declared=${ALL_ROLE_IDS.length} undeclared=${undeclared.length} extra=${extra.length}`);

    // Parity of the enabled flag between registry.js and the reporting lines.
    // DATA-QUALITY and UI-DESIGN-QA are org placeholders while the code
    // registry still marks them enabled — reported, not silently fixed.
    const flags = (await pool.query("SELECT employee_id, enabled, staffing FROM ve_reporting_lines ORDER BY 1")).rows;
    const byId = new Map(flags.map(f => [f.employee_id, f]));
    const conflicts = FACTORY_VIRTUAL_EMPLOYEES
      .filter(e => byId.has(e.id) && byId.get(e.id).enabled !== e.enabled)
      .map(e => `${e.id} registry=${e.enabled} lines=${byId.get(e.id).enabled}(${byId.get(e.id).staffing})`);
    if (conflicts.length) warnings.push({ code: "ENABLED_FLAG_CONFLICT", employees: conflicts });
    lines.push(`ENABLED flags=${flags.length} conflicts=${conflicts.length}`);

    // Gates the runner might mark on tasks must exist on the drafting employee.
    // Only live work counts: a cancelled synthetic row from the earlier gate
    // probe must not be mistaken for a gate the org is actually using.
    const gatesInUse = (await pool.query(
      `SELECT DISTINCT human_gate FROM factory_virtual_employee_tasks
       WHERE human_gate IS NOT NULL AND status IN ('OPEN','IN_PROGRESS','WAITING_APPROVAL','COMPLETED')
         AND employee_id IN (SELECT employee_id FROM ve_reporting_lines WHERE enabled)`)).rows.map(r => r.human_gate);
    const knownGates = new Set(SKILLS.filter(s => s.gate).map(s => s.gate)
      .concat(FACTORY_VIRTUAL_EMPLOYEES.flatMap(e => e.humanGates || [])));
    const orphanGates = gatesInUse.filter(g => !knownGates.has(g));
    if (orphanGates.length) problems.push({ code: "GATE_IN_USE_NOT_IN_CONTRACT", gates: orphanGates });
    lines.push(`GATES in_use=${gatesInUse.length} unknown=${orphanGates.length}`);
  } finally {
    await pool.end();
  }
}

for (const w of warnings) lines.push(`WARN ${w.code} ${JSON.stringify(w).slice(0, 220)}`);
for (const p of problems) lines.push(`FAIL ${p.code} ${JSON.stringify(p).slice(0, 300)}`);
console.log(lines.join("\n"));
if (problems.length) {
  console.log(`VE_CAPABILITIES_FAILED problems=${problems.length} warnings=${warnings.length}`);
  process.exitCode = 1;
} else {
  console.log(`VE_CAPABILITIES_OK problems=0 warnings=${warnings.length}`);
}
