#!/usr/bin/env node
/**
 * check-picking-drift.mjs — read-only guard for the one-WMS picking merge.
 *
 * HISTORY, because the premise of this gate changed and the old one is now wrong.
 *   While the merge was mid-flight there were two write surfaces:
 *     · /api/wms/picking-orders/:id/*  -> wms_picking_orders   (canonical)
 *     · /rjvn-picking/:id/*            -> rjvn_picking_order   (mirror, FIFO)
 *   They are not synced (picking_order is not one of migration 309's seven
 *   projection-trigger pairs), so this gate compared status and quantities and
 *   failed when they disagreed. That was right at the time.
 *
 *   Since slice 2 both surfaces write canonical, and `rjvn_picking_order(_item)`
 *   has NO reader and NO writer left in the repo — it is a frozen archive of the
 *   10/173 rows migration 309 backfilled. Comparing it to live canonical would
 *   therefore fail on the FIRST legitimate pick, forever:
 *     verified 2026-11-20 — POST /rjvn-picking/:id/pick -> 200,
 *     canonical approved->issued, mirror untouched -> PICKING_DRIFT_FAIL,
 *     and no code path can ever move the mirror again to clear it.
 *   So the comparison was replaced, not deleted: a gate that reds on correct
 *   behaviour is worse than no gate.
 *
 * THE INVARIANTS THAT DO HOLD NOW:
 *   1. ARCHIVE IS READ-ONLY. No source file may write rjvn_picking_order(_item).
 *      Checked statically, without a database — this is the one that catches a
 *      regression, i.e. someone re-introducing a second write surface.
 *   2. NOTHING LOST. Every mirror header still has its canonical twin
 *      (wms_picking_orders.rjvn_id). Orphan > 0 means the backfill was damaged.
 *   3. CANONICAL NEVER GOES BACKWARDS. The mirror is frozen at backfill time and
 *      canonical only advances, so mirror status must never be AHEAD of
 *      canonical. If it is, an advance was lost (bad restore, bad migration).
 *      Deliberately one-directional: canonical being ahead is normal progress.
 *
 * Exit semantics, chosen so this can sit in the shared static rung: exit 1 only
 * on a real violation; no database is a printed SKIP with exit 0, because an
 * unreachable store cannot prove anything.
 *
 * Usage:  node scripts/check-picking-drift.mjs [--json]
 * Exit:   0 clean or skipped · 1 violation
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// ── invariant 1: no mirror write surface anywhere in the source tree ──────────
const WRITE_RE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:"?public"?\.)?"?rjvn_picking_order(?:_item)?"?\b/i;
const SCAN_DIRS = ["services", "apps", "scripts", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);
const mirrorWrites = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|mjs|cjs|ts|tsx)$/.test(e.name)) {
      let text;
      try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
      if (!text.includes("rjvn_picking_order")) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        if (WRITE_RE.test(line)) mirrorWrites.push({ file: p, line: i + 1, text: line.trim().slice(0, 120) });
      });
    }
  }
}
for (const d of SCAN_DIRS) walk(path.resolve(d));

const staticViolation = mirrorWrites.length > 0;

// ── invariants 2 and 3: the archive is complete and canonical never regressed ─
// Lifecycle ranks. The mirror can only be at or BEHIND canonical.
const RANK = { pending_approval: 0, approved: 1, issued: 2, received: 3, completed: 4, rejected: 5 };

const envFile = path.resolve("services/api/.env");
const env = {};
if (fs.existsSync(envFile)) {
  // CRLF-safe line-by-line parse (AGENTS.md: never `source` this file).
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

const report = {
  mirrorWriteSites: mirrorWrites,
  totals: null,
  orphanMirrorHeaders: null,
  mirrorAhead: [],
  verdict: "OK",
  skipped: null,
};

if (env.PGHOST) {
  const client = new pg.Client({
    host: env.PGHOST, port: Number(env.PGPORT || 5432), user: env.PGUSER,
    password: env.PGPASSWORD, database: env.PGDATABASE,
  });
  try {
    await client.connect();
    const exists = async (t) => (await client.query(
      `select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rowCount > 0;

    if (!(await exists("wms_picking_orders")) || !(await exists("rjvn_picking_order"))) {
      // An environment without mirrors (production skipped 309/311) has one
      // surface by construction — the archive cannot be incomplete or regress.
      report.skipped = "mirrors absent (single surface by construction)";
    } else {
      const totals = await client.query(`
        select (select count(*)::int from public.rjvn_picking_order)      as mirror_headers,
               (select count(*)::int from public.wms_picking_orders)       as canonical_headers,
               (select count(*)::int from public.rjvn_picking_order_item)  as mirror_items,
               (select count(*)::int from public.wms_picking_order_items)  as canonical_items`);
      report.totals = totals.rows[0];

      const orphan = await client.query(`
        select count(*)::int as n from public.rjvn_picking_order s
         where not exists (select 1 from public.wms_picking_orders w where w.rjvn_id = s.id)`);
      report.orphanMirrorHeaders = orphan.rows[0].n;

      const pairs = await client.query(`
        select s.picking_no, s.status as mirror_status, w.status as canonical_status
          from public.rjvn_picking_order s
          join public.wms_picking_orders w on w.rjvn_id = s.id`);
      for (const r of pairs.rows) {
        const m = RANK[r.mirror_status], c = RANK[r.canonical_status];
        // Unknown status on either side is not a regression claim — ignore it
        // rather than invent an ordering. Terminal rejection is its own branch.
        if (m === undefined || c === undefined) continue;
        if (r.mirror_status === "rejected" || r.canonical_status === "rejected") continue;
        if (m > c) report.mirrorAhead.push(r);
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

const violating = staticViolation || (report.orphanMirrorHeaders ?? 0) > 0 || report.mirrorAhead.length > 0;
report.verdict = violating ? "VIOLATION" : "OK";

// --json must emit exactly one parseable document, so the human summary and the
// OK line are suppressed on that path. stdout stays machine-readable; stderr
// keeps the human explanation of any failure.
const asJson = process.argv.includes("--json");
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (report.skipped) console.log(`note: ${report.skipped}`);
  if (report.totals) {
    console.log(`picking archive: mirror ${report.totals.mirror_headers}/${report.totals.mirror_items}`
      + ` (frozen) vs canonical ${report.totals.canonical_headers}/${report.totals.canonical_items} (live)`);
    console.log(`orphan mirror headers (canonical twin missing): ${report.orphanMirrorHeaders}`);
  }
  for (const w of report.mirrorWriteSites) console.log(`  MIRROR WRITE ${w.file}:${w.line}: ${w.text}`);
  for (const r of report.mirrorAhead) console.log(`  REGRESSED ${r.picking_no}: mirror=${r.mirror_status} is ahead of canonical=${r.canonical_status}`);
}

if (violating) {
  console.error(`PICKING_ARCHIVE_FAIL mirrorWrites=${mirrorWrites.length}`
    + ` orphans=${report.orphanMirrorHeaders ?? 0} regressed=${report.mirrorAhead.length}`);
  if (staticViolation) console.error("A source file writes the frozen mirror again. All picking writes belong to wms_picking_orders.");
  if ((report.orphanMirrorHeaders ?? 0) > 0) console.error("Mirror rows lost their canonical twin — the 309 backfill is damaged.");
  if (report.mirrorAhead.length) console.error("Canonical status is behind the archive — an advance was lost.");
  process.exit(1);
}
if (!asJson) console.log("PICKING_DRIFT_OK");
process.exit(0);