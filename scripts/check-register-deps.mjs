#!/usr/bin/env node
// Static check: every identifier passed into a `registerXxxRoutes(app, { ... })` call
// must actually exist in server.js.
//
// WHY THIS EXISTS. Moving the cycle-count routes out of server.js passed the dependency
// list `getCurrentUser` into registerCountRoutes. No function by that name existed in
// server.js, so the identifier was evaluated at module load and the API threw
// ReferenceError before app.listen -- /health never answered and every route was dead.
// Nothing in the gate saw it: check:syntax is a parser (`node --check` is happy with an
// undefined name), and tsconfig.api.json covers services/api/src, NOT the 46k-line
// server.js, so `tsc --noEmit | grep server.js(NNNN)` returns nothing for any problem in
// server.js -- an empty grep that reads as a pass and is not one. (Found by another
// agent in caa12f4, which defined getCurrentUser next to authenticateJWT.)
//
// The check is textual on purpose: it needs no database, no boot, and no type program,
// so it runs in the static rung in about 20 ms.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? path.join(root, "services", "api", "server.js");

if (!existsSync(target)) {
  console.error(`REGISTER_DEPS_NO_FILE ${target}`);
  process.exit(1);
}

const lines = readFileSync(target, "utf8").split(/\r?\n/);

// --- what server.js declares -------------------------------------------------
const declared = new Set();
const DECL = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
for (const line of lines) {
  const m = line.match(DECL);
  if (m) declared.add(m[1]);
  // function/class parameters and destructuring are not module-level bindings; skip.
  const imp = line.match(/^import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*))?/);
  if (imp) {
    if (imp[1]) declared.add(imp[1]);
    if (imp[3]) declared.add(imp[3]);
    if (imp[2]) for (const part of imp[2].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) declared.add(name);
    }
  }
}

// --- what the call sites pass ------------------------------------------------
const problems = [];
for (let i = 0; i < lines.length; i += 1) {
  const start = lines[i].match(/^\s*(register[A-Za-z]*Routes)\(\s*app\s*,\s*\{?/);
  if (!start) continue;
  const factory = start[1];
  // Collect the argument object, which may span lines, until the call closes.
  let body = "";
  for (let j = i; j < Math.min(i + 40, lines.length); j += 1) {
    body += ` ${lines[j]}`;
    if (/\)\s*;?\s*$/.test(lines[j])) break;
  }
  const objMatch = body.match(/\{([\s\S]*?)\}\s*\)/);
  if (!objMatch) continue;
  const names = objMatch[1]
    .replace(/\/\/[^\n]*/g, "")
    .split(",")
    .map((part) => part.trim().split(":")[0].trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  for (const name of names) {
    if (!declared.has(name)) problems.push({ name, factory, line: i + 1 });
  }
}

if (problems.length > 0) {
  console.error(`REGISTER_DEPS_FAILED missing=${problems.length}`);
  for (const p of problems) {
    console.error(`  ${p.factory} (line ${p.line}) passes \`${p.name}\`, which server.js never declares`);
  }
  console.error("  These are evaluated at module load: the process throws ReferenceError before");
  console.error("  app.listen and every route is dead, while `node --check` still passes.");
  process.exit(1);
}

console.log("REGISTER_DEPS_OK");
