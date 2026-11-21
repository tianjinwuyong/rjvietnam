#!/usr/bin/env node
// Route census ratchet -- the safety net for splitting services/api/server.js.
//
// WHY THIS EXISTS BEFORE THE SPLIT, NOT AFTER. The planned refactor moves route groups
// out of a 49k-line file into `src/*.js` factories. Every route is registered by a call
// like `app.get("/wms/x", ...)` or `api.post("/qms/y", ...)`. A move that drops one
// registration -- a copy/paste that forgot a handler, a mount that was not added -- is
// silent: the server still boots, the remaining routes still answer, and the missing
// endpoint only shows up when someone needs it. There is no test that would notice,
// because nothing enumerates the route surface.
//
// So this counts the surface across the whole API tree, keyed by first path segment,
// and fails when it SHRINKS. It counts server.js and services/api/src/**/*.js together,
// which is the point: after a successful move the total is unchanged even though the
// number of registrations in server.js went down. A ratchet that only looked at
// server.js would block the very refactor it is meant to protect.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, statSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "services", "api");
const baselineFile = path.join(root, ".factory", "locks", "route-census-baseline.json");
const update = process.argv.includes("--update");

const SKIP = new Set(["node_modules", "dist", "public", "oa-web", "oa-web-next", "data", "print-templates", "__pycache__"]);

function collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      collect(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.includes(".testbak.")) {
      out.push(full);
    }
  }
}

const files = [];
collect(apiDir, files);

// `app.get("...")`, `api.post("...")`, `router.delete("...")`, `r.get("...")` -- the
// expression name varies by file, the shape does not. Requiring a string literal as the
// first argument is what keeps this from counting unrelated `.get(` calls on Maps.
const ROUTE = /(?:^|[^.\w])(?:app|api|router|r)\.(get|post|put|patch|delete|all|options|head)\(\s*["'`]([^"'`]+)["'`]/;

const byPrefix = new Map();
const byMethod = new Map();
let total = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = ROUTE.exec(line);
    if (!m) continue;
    total += 1;
    const seg = m[2].split("?")[0].split("/").filter(Boolean)[0] ?? "(root)";
    byPrefix.set(seg, (byPrefix.get(seg) ?? 0) + 1);
    byMethod.set(m[1], (byMethod.get(m[1]) ?? 0) + 1);
  }
}

if (total === 0) {
  console.error("ROUTE_CENSUS_EMPTY matched 0 route registrations -- the pattern is wrong, not the tree.");
  process.exit(2);
}

const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : null;

if (update) {
  writeFileSync(
    baselineFile,
    `${JSON.stringify(
      {
        _what_this_is:
          "Route registrations in services/api (server.js plus src/**/*.js), keyed by first path segment. Ratcheted DOWNWARD ONLY: the total and every prefix may grow, never shrink. Built to make the planned server.js split verifiable -- after moving a route group into src/*.js the totals must be identical.",
        _how_to_update:
          "Deliberately removing an endpoint: delete it, run check:route-census, then re-run with --update and say why in the commit. Running --update to silence an accidental drop defeats the only thing this check does.",
        total,
        by_prefix: Object.fromEntries([...byPrefix].sort((a, b) => b[1] - a[1])),
        by_method: Object.fromEntries([...byMethod].sort()),
        updated_at: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`ROUTE_CENSUS_BASELINE_WRITTEN total=${total} prefixes=${byPrefix.size}`);
  process.exit(0);
}

if (baseline === null) {
  console.error("ROUTE_CENSUS_NO_BASELINE run `node scripts/check-route-census.mjs --update` once to record the surface.");
  process.exit(2);
}

const problems = [];
if (total < baseline.total) {
  problems.push(`total ${total} < baseline ${baseline.total} (${baseline.total - total} route(s) disappeared)`);
}
for (const [prefix, n] of Object.entries(baseline.by_prefix)) {
  const nowCount = byPrefix.get(prefix) ?? 0;
  if (nowCount < n) problems.push(`prefix '${prefix}' ${nowCount} < ${n}`);
}
const added = total - baseline.total;

if (problems.length) {
  console.error(`ROUTE_CENSUS_REGRESSION total=${total} baseline=${baseline.total}`);
  for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
  console.error(
    "A route registration vanished. If the split moved it, the mount is missing; if the endpoint was deleted on purpose, re-baseline with --update and say so.",
  );
  process.exit(1);
}

console.log(
  `ROUTE_CENSUS_OK total=${total} baseline=${baseline.total}${added ? ` (+${added})` : ""} prefixes=${byPrefix.size}`,
);
