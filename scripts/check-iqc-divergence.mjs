#!/usr/bin/env node
/**
 * check-iqc-divergence.mjs — read-only guard for the one-WMS IQC verdict merge.
 *
 * WHY. canonical material_lots.iqc_status and mirror rjvn_iqc_lot.status are two
 * judgements of "can this lot be used". On 2026-11-21 they disagreed on 16 lots
 * (15 mirror=rejected but canonical=released, 1 reverse) — docs/WMS_GRAFT_LOG.md
 * slice 3b. Flipping either direction is a quality decision for the inspection
 * floor, not a merge engineer. So this gate does NOT flip anything: it makes the
 * disagreement impossible to hide.
 *
 * THE INVARIANT. A lot the mirror blocks (rejected / review_pending) must never
 * be canonical=released. That is the dangerous direction — it lets blocked stock
 * be issued. The reverse (canonical blocks, mirror open) is conservative and is
 * reported but not failed. Status mapping for the comparison:
 *   mirror pass -> released · rejected -> rejected · pending/review_pending -> pending
 *
 * Exit semantics (same as check-picking-drift, sits in the shared static rung):
 *   exit 1 only on the dangerous direction; no database / no mirrors = printed
 *   SKIP exit 0, because an unreachable store cannot prove anything.
 *
 * Usage:  node scripts/check-iqc-divergence.mjs [--json]
 * Exit:   0 clean or skipped · 1 dangerous divergence present
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = path.resolve("services/api/.env");
const env = {};
if (fs.existsSync(envFile)) {
  // CRLF-safe line-by-line parse (AGENTS.md: never `source` this file).
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

const report = { dangerous: [], conservative: [], totals: null, verdict: "OK", skipped: null };

if (env.PGHOST) {
  const client = new pg.Client({
    host: env.PGHOST, port: Number(env.PGPORT || 5432), user: env.PGUSER,
    password: env.PGPASSWORD, database: env.PGDATABASE,
  });
  try {
    await client.connect();
    const exists = async (t) => (await client.query(
      `select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rowCount > 0;
    if (!(await exists("material_lots")) || !(await exists("rjvn_iqc_lot"))) {
      report.skipped = "mirrors absent (single surface by construction)";
    } else {
      const totals = await client.query(`
        select (select count(*)::int from public.material_lots)  as canonical_lots,
               (select count(*)::int from public.rjvn_iqc_lot)   as mirror_lots,
               (select count(*)::int from public.material_lots ml
                  join public.rjvn_iqc_lot il on il.lot_no = ml.lot_no) as joined`);
      report.totals = totals.rows[0];
      const pairs = await client.query(`
        select ml.lot_no, ml.iqc_status as canonical_status, il.status as mirror_status
          from public.material_lots ml
          join public.rjvn_iqc_lot il on il.lot_no = ml.lot_no`);
      for (const r of pairs.rows) {
        // Dangerous: mirror blocks but canonical released → blocked stock issuable.
        if (r.canonical_status === "released" && ["rejected", "review_pending"].includes(r.mirror_status)) {
          report.dangerous.push(r);
        } else if (r.canonical_status === "rejected" && ["pending", "pass", "review_pending"].includes(r.mirror_status)) {
          report.conservative.push(r);
        }
      }
    }
  } catch (e) {
    report.skipped = `database unavailable (${String(e.message).slice(0, 80)})`;
  } finally {
    await client.end().catch(() => {});
  }
} else {
  report.skipped = "no PGHOST (no database to check)";
}

const violating = report.dangerous.length > 0;
report.verdict = violating ? "VIOLATION" : "OK";

const asJson = process.argv.includes("--json");
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (report.skipped) console.log(`note: ${report.skipped}`);
  if (report.totals) {
    console.log(`iqc verdicts: canonical ${report.totals.canonical_lots} lots, mirror ${report.totals.mirror_lots}, joined ${report.totals.joined}`);
    console.log(`dangerous (mirror blocks, canonical released): ${report.dangerous.length}`);
    console.log(`conservative (canonical blocks, mirror open): ${report.conservative.length}`);
  }
  for (const r of report.dangerous) console.log(`  DANGEROUS ${r.lot_no}: mirror=${r.mirror_status} canonical=${r.canonical_status}`);
  for (const r of report.conservative) console.log(`  conservative ${r.lot_no}: mirror=${r.mirror_status} canonical=${r.canonical_status}`);
}

if (violating) {
  console.error(`IQC_DIVERGENCE_FAIL dangerous=${report.dangerous.length} conservative=${report.conservative.length}`);
  console.error("Mirror-blocked lots are canonical=released — blocked stock could be issued.");
  console.error("Do NOT auto-flip. Quarantine via POST /api/wms/iqc/divergence/:lotId/quarantine (sets hold),");
  console.error("then let quality decide release/reject through IQC_RELEASE / IQC_REJECT.");
  process.exit(1);
}
if (!asJson) console.log("IQC_DIVERGENCE_OK");
process.exit(0);