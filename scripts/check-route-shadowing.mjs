#!/usr/bin/env node
// Ratchet for "permission guards that can never run".
//
// THE DEFECT THIS HOLDS. servers/api/server.js builds one `express.Router()` (`api`,
// line ~117) and mounts it with `app.use("/api", api)` far above the auth wrapper. A
// router's position in the middleware chain is its MOUNT POINT, not the line its
// handlers are written on. So when the same path is registered twice --
// `api.get("/lifecycle/lots")` near the end of the file and
// `app.get("/api/lifecycle/lots", requirePermission("wms.read"))` earlier in the file --
// the router copy answers first and the app-level guard never executes. The route looks
// guarded, is documented as guarded, and is not.
//
// Verified live on 2026-11-20: with a station token whose permissions do not include
// wms.read, GET /api/lifecycle/lots, /summary and /openings answer 200 (they are
// served by the unguarded router copies), while GET /api/lifecycle/exempt-lots -- which
// has no router twin -- answers 403 "Missing required permission: wms.read".
//
// Adding the guard to the router copies is an access-control change (it starts denying
// tokens that work today), so it is the owner's call. What is enforced here is that the
// dead-guard count never GROWS: the paths are baselined in .factory/locks/ (PROTECTED),
// so a builder cannot add a shadowed guard in the same pull request that adds the route.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverFile = path.join(root, "services", "api", "server.js");
const baselineFile = path.join(root, ".factory", "locks", "route-shadowing-baseline.json");
const update = process.argv.includes("--update");

const lines = readFileSync(serverFile, "utf8").split(/\r?\n/);

// --- routers and their mount points -----------------------------------------
const routerDeclRe = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\.Router\(\)/;
const mountRe = /^app\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/;

const routers = new Set();
for (const line of lines) {
  const m = line.match(routerDeclRe);
  if (m) routers.add(m[1]);
}

const mounts = new Map(); // router name -> { prefix, line }
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].match(mountRe);
  if (!m || !routers.has(m[2])) continue;
  const prefix = m[1].replace(/\/+$/, "");
  // First mount wins: that is the position Express consults.
  if (!mounts.has(m[2])) mounts.set(m[2], { prefix, line: i + 1 });
}

// --- registrations ----------------------------------------------------------
// Scanner shape, and why it reads more than one file: the guarded app-level copies are
// being MOVED into services/api/src/routes/*.js, and a moved route's position in the
// chain is the `registerXxxRoutes(app, ...)` call site in server.js, not any line in
// the module. Scanning server.js alone therefore reports 0 dead guards precisely when
// the split has done its job -- a false green, which is the failure this file exists to
// prevent. Modules are resolved to their call site and inherit its line.
const regRe = /^([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/;

const join = (prefix, sub) => {
  const s = sub.startsWith("/") ? sub : `/${sub}`;
  if (!prefix) return s;
  return `${prefix}${s}`.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
};

// Exported factory name -> the line its call site occupies in server.js.
const callSite = new Map();
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].match(/^\s*(register[A-Za-z]*Routes)\(/);
  if (m && !callSite.has(m[1])) callSite.set(m[1], i + 1);
}

const appRoutes = [];      // { key, where, line, guarded }
const routerRoutes = [];   // { key, line }

const scan = (fileLines, fileLabel, positionOf) => {
  for (let i = 0; i < fileLines.length; i += 1) {
    const m = fileLines[i].match(regRe);
    if (!m) continue;
    const [, owner, verb, sub] = m;
    const key = `${verb.toUpperCase()} ${sub}`;
    if (owner === "app") {
      appRoutes.push({
        key,
        where: `${fileLabel}:${i + 1}`,
        line: positionOf(i + 1),
        guarded: /requirePermission|requireRoles/.test(fileLines[i]),
      });
    } else if (mounts.has(owner)) {
      routerRoutes.push({ key: `${verb.toUpperCase()} ${join(mounts.get(owner).prefix, sub)}`, line: mounts.get(owner).line });
    }
  }
};

scan(lines, "server.js", (n) => n);

const routesDir = path.join(root, "services", "api", "src", "routes");
if (existsSync(routesDir)) {
  for (const entry of readdirSync(routesDir)) {
    if (!entry.endsWith(".js")) continue;
    const file = path.join(routesDir, entry);
    const modLines = readFileSync(file, "utf8").split(/\r?\n/);
    const factory = modLines.map((l) => l.match(/^export function (register[A-Za-z]*Routes)\(/)).find(Boolean);
    if (!factory) continue;
    const at = callSite.get(factory[1]);
    if (at === undefined) continue; // not mounted from server.js: nothing to shadow
    scan(modLines, `src/routes/${entry}`, () => at);
  }
}

// --- the defect: a guarded app route answered by an earlier-positioned twin ---
const firstRouter = new Map();
for (const r of routerRoutes) if (!firstRouter.has(r.key)) firstRouter.set(r.key, r.line);

const dead = [];
for (const a of appRoutes) {
  if (!a.guarded) continue;
  const twin = firstRouter.get(a.key);
  if (twin !== undefined && twin < a.line) dead.push({ key: a.key, app: a.line, router: twin });
}

const current = dead.map((d) => d.key).sort();

const baseline = existsSync(baselineFile)
  ? JSON.parse(readFileSync(baselineFile, "utf8")).keys
  : null;

if (update) {
  writeFileSync(
    baselineFile,
    `${JSON.stringify({ keys: current, note: "Dead permission guards: app-level routes whose guard cannot run because a router copy answers first. Lower with --update; never raise." }, null, 2)}\n`,
  );
  console.log(`ROUTE_SHADOWING_UPDATED dead_guards=${current.length}`);
  process.exit(0);
}

if (baseline === null) {
  console.log(`ROUTE_SHADOWING_NO_BASELINE dead_guards=${current.length} -- run with --update once, and commit the baseline`);
  process.exit(1);
}

const known = new Set(baseline);
const added = current.filter((k) => !known.has(k));
const fixed = baseline.filter((k) => !current.includes(k));

if (added.length > 0) {
  console.error(`ROUTE_SHADOWING_FAILED dead_guards=${current.length} baseline=${baseline.length}`);
  for (const d of dead.filter((x) => added.includes(x.key))) {
    console.error(`  NEW  ${d.key}`);
    console.error(`       app-level guard at line ${d.app} can never run: the router copy is mounted at line ${d.router}`);
  }
  console.error("  Fix: register the path on the router (with its guard), or delete the app-level copy.");
  console.error("  Do not raise the baseline to make this pass.");
  process.exit(1);
}

const note = fixed.length > 0 ? ` (down ${fixed.length} -- lower the baseline with --update)` : "";
console.log(`ROUTE_SHADOWING_OK dead_guards=${current.length} baseline=${baseline.length}${note}`);
