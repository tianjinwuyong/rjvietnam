#!/usr/bin/env node
// Ratchet for "routes that rely on the global auth gate but sit above it".
//
// THE DEFECT THIS HOLDS. services/api/server.js authenticates in two ways: a handful
// of prefix mounts (`app.use("/qms/iqc", authenticateJWT)`, `app.use("/api/factory/
// virtual-employees", authenticateJWT)`) and one global `app.use(authenticateJWT)` at
// the very end. Express only runs middleware registered BEFORE a route, so a guarded
// route declared above every mount that covers its path reads `req.user`, finds it
// undefined, and answers 401 to a perfectly valid JWT.
//
// Verified live on 2026-11-20: /wms/receiving/qr-bindings (12652) and
// /api/manager/line-assignments (7022) return 401 with a valid token, while
// /wms/raw-material-inventory (24285) works.
//
// Fixing the ordering for real is an authentication change (FACTORY_RULES 8) and the
// owner's call. What is enforced here is that the hole never WIDENS: the count is
// baselined in .factory/locks/ (PROTECTED), so a builder cannot raise it in the same
// pull request that adds the route. Lower it with --update as routes are repaired.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverFile = path.join(root, "services", "api", "server.js");
const baselineFile = path.join(root, ".factory", "locks", "auth-order-baseline.json");
const update = process.argv.includes("--update");

const lines = readFileSync(serverFile, "utf8").split(/\r?\n/);

// THE EFFECTIVE GATE IS THE EARLIEST app-level enforcement, and this file has two
// spellings of it: a bare `app.use(authenticateJWT)` near the end, and an inline
// wrapper -- `app.use((req, res, next) => { ... return authenticateJWT(req, res, next); })`
// -- planted much earlier. Taking only the bare form counts everything between them as
// stranded, which is wrong: those routes are protected by the wrapper. Measured here:
// the wrapper sits ~17k lines above the bare mount, and the naive version over-counted
// the hole by roughly a factor of two.
const isBareGate = (line) => /^app\.use\(authenticateJWT\)/.test(line.trim());
const isInlineGate = (line) => /^app\.use\(\(req, res, next\)\s*=>\s*\{/.test(line.trim());

let gateLine = -1;
for (let i = 0; i < lines.length; i += 1) {
  if (isBareGate(lines[i])) {
    gateLine = i + 1;
    break;
  }
  if (isInlineGate(lines[i])) {
    // Only an inline wrapper that actually delegates counts; the file also has plain
    // logging middleware with the same signature.
    const body = lines.slice(i, i + 40).join("\n");
    if (/authenticateJWT\(req,\s*res,\s*next\)/.test(body)) {
      gateLine = i + 1;
      break;
    }
  }
}
if (gateLine < 0) {
  console.error("AUTH_ORDER_NO_GATE no app-level authenticateJWT enforcement in services/api/server.js -- the ordering argument changed.");
  process.exit(2);
}

const routeRe = /^app\.(get|post|put|patch|delete|all)\(\s*["'`](.+?)["'`]\s*,(.*)$/;
const mountRe = /^app\.use\(\s*["'`](.+?)["'`]\s*,\s*authenticateJWT\s*\)/;

const mounts = [];
for (let i = 0; i < lines.length; i += 1) {
  const m = mountRe.exec(lines[i].trim());
  if (m) mounts.push({ prefix: m[1].replace(/\/$/, ""), line: i + 1 });
}

// Routes declared on `app` under /api are a separate question (usually shadowed by the
// api router), so they are not counted as stranded here.
const coveredByMount = (routePath, declaredAt) =>
  routePath === "/api" ||
  routePath.startsWith("/api/") ||
  mounts.some(
    (mount) =>
      mount.line < declaredAt &&
      (routePath === mount.prefix || routePath.startsWith(`${mount.prefix}/`)),
  );

const stranded = [];
for (let i = 0; i < gateLine - 1; i += 1) {
  const m = routeRe.exec(lines[i]);
  if (!m) continue;
  const rest = m[3];
  if (!/\brequirePermission\s*\(|\brequireRole\s*\(/.test(rest)) continue;
  if (/\bauthenticateJWT\b/.test(rest)) continue;
  if (coveredByMount(m[2], i + 1)) continue;
  stranded.push({ line: i + 1, method: m[1].toUpperCase(), path: m[2] });
}

const baseline = existsSync(baselineFile)
  ? JSON.parse(readFileSync(baselineFile, "utf8")).stranded
  : null;

if (update) {
  writeFileSync(
    baselineFile,
    `${JSON.stringify(
      {
        _what_this_is:
          "Guarded `app.*` routes in services/api/server.js declared above every authenticateJWT mount covering them. They answer 401 to a valid JWT. Ratcheted: a new stranded route fails the gate; repair one and re-run with --update to lower it.",
        gate_line: gateLine,
        stranded: stranded.length,
        routes: stranded.map((s) => `${s.method} ${s.path}:${s.line}`),
        updated_at: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`AUTH_ORDER_BASELINE_WRITTEN stranded=${stranded.length} gate_line=${gateLine}`);
  process.exit(0);
}

if (baseline === null) {
  console.error("AUTH_ORDER_NO_BASELINE run `node scripts/check-auth-order.mjs --update` once, as a human, to record the current hole.");
  process.exit(2);
}

if (stranded.length > baseline) {
  console.error(`AUTH_ORDER_REGRESSION stranded=${stranded.length} baseline=${baseline}`);
  console.error("Guarded routes above app.use(authenticateJWT) answer 401 to valid tokens.");
  console.error('Either pass authenticateJWT on the route, or declare it below app.use("/api", api).');
  for (const s of stranded.slice(0, 15)) console.error(`  ${s.method} ${s.path}  server.js:${s.line}`);
  process.exit(1);
}

const note = stranded.length < baseline ? ` (down ${baseline - stranded.length} -- lower the baseline with --update)` : "";
console.log(`AUTH_ORDER_OK stranded=${stranded.length} baseline=${baseline} gate_line=${gateLine}${note}`);
