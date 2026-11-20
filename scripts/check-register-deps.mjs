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
// `declared` answers "does the name exist"; `binding` answers "and is it initialised by
// the time the call site runs". The second half is not academic: `authenticateJWT` is a
// `const` declared at server.js:~13679, and passing it into a register call at ~6056
// evaluates it inside its temporal dead zone, so Express receives `undefined` and dies
// at load with "argument handler must be a function" -- a different error than the
// ReferenceError this file was written for, from the same class of mistake.
const declared = new Set();
const binding = new Map(); // name -> { line, tdz: boolean }
const DECL = /^(?:export\s+)?(?:(async)\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  const m = line.match(DECL);
  if (m) {
    const name = m[3];
    declared.add(name);
    // Function declarations hoist their value; var hoists as undefined. const/let do not.
    const tdz = !m[1] && (m[2] === "const" || m[2] === "let");
    if (!binding.has(name)) binding.set(name, { line: i + 1, tdz });
  }
  const imp = line.match(/^import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*))?/);
  if (imp) {
    const add = (name) => {
      if (!name) return;
      declared.add(name);
      if (!binding.has(name)) binding.set(name, { line: i + 1, tdz: false });
    };
    add(imp[1]);
    add(imp[3]);
    if (imp[2]) for (const part of imp[2].split(",")) add(part.trim().split(/\s+as\s+/).pop()?.trim());
  }
}

// --- what the call sites pass ------------------------------------------------
// Two shapes must both be read, because both are used here:
//   registerXRoutes(app, { a, b })          -- an inline literal
//   const xDeps = { a, b };  registerXRoutes(app, xDeps)   -- a hoisted variable, which
//     is how a large dependency list stays readable, and the shape a naive scanner misses
//     completely (it silently reported OK on a file with a live TDZ bug in it).
const problems = [];

const objectLiteralFor = (name, beforeLine) => {
  for (let j = beforeLine - 1; j >= 0; j -= 1) {
    const m = lines[j].match(new RegExp(`^(?:const|let|var)\\s+${name}\\s*=\\s*\\{`));
    if (!m) continue;
    let depth = 0;
    let body = "";
    for (let k = j; k < lines.length; k += 1) {
      body += ` ${lines[k]}`;
      depth += (lines[k].match(/\{/g) || []).length - (lines[k].match(/\}/g) || []).length;
      if (depth <= 0) break;
    }
    const inner = body.match(/\{([\s\S]*)\}/);
    return inner ? inner[1] : null;
  }
  return null;
};

const entriesOf = (text) => text
  .replace(/\/\/[^\n]*/g, "")
  .split(/,(?![^(]*\))/)
  .map((part) => part.trim())
  .filter(Boolean);

const checkEntries = (text, factory, callLine) => {
  for (const entry of entriesOf(text)) {
    const colon = entry.indexOf(":");
    if (colon < 0) {
      // shorthand `{ query, }` -- the identifier is read right here
      const name = entry.replace(/[,{}]/g, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) report(name, name, entry, factory, callLine);
      continue;
    }
    const key = entry.slice(0, colon).trim();
    const value = entry.slice(colon + 1).trim().replace(/,+\s*$/, "");
    if (/=>|^function|^async\b/.test(value)) continue; // deferred: safe to pass early
    if (/^[A-Za-z_$][\w$]*$/.test(value)) report(value, key, entry, factory, callLine);
    // anything else (a literal, a call) is computed here and is not a TDZ question
  }
};

const report = (name, key, entry, factory, callLine) => {
  const b = binding.get(name);
  if (!b) problems.push({ kind: "missing", name, factory, line: callLine });
  else if (b.tdz && b.line > callLine) problems.push({ kind: "tdz", name, factory, line: callLine, declLine: b.line });
};

// The module is found through the import that binds the factory, so a renamed file or a
// factory imported from anywhere else cannot quietly drop out of the check.
const moduleFor = (factory) => {
  for (const line of lines) {
    const m = line.match(/^import\s*\{([^}]*)\}\s*from\s*["'`](\.\/[^"'`]+)["'`]/);
    if (!m) continue;
    if (!m[1].split(",").map((s) => s.trim()).includes(factory)) continue;
    const rel = m[2].replace(/^\.\//, "");
    // Resolve next to the file being read, then from the real services/api, because a
    // copy of server.js taken elsewhere (a mutation fixture) must still find its modules.
    // Returning null there would make the completeness check silently skip -- a pass
    // that means "could not look", which is the failure this gate exists to prevent.
    for (const base of [path.dirname(target), path.join(root, "services", "api")]) {
      const candidate = path.join(base, rel);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  return null;
};

const destructuredCache = new Map();
const destructuredNames = (file) => {
  if (destructuredCache.has(file)) return destructuredCache.get(file);
  let names = [];
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8");
    const m = text.match(/const\s*\{([\s\S]*?)\}\s*=\s*deps\s*;/);
    if (m) names = m[1].split(",").map((s) => s.split(":")[0].trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
  }
  destructuredCache.set(file, names);
  return names;
};

// --- the invariant that actually matters --------------------------------------
// Every name the module destructures out of `deps` must be a key the call site passes.
// This is the check that would have caught the real failure here, which was NOT a
// temporal-dead-zone problem (authenticateJWT is an `async function` declaration and
// hoists fine): the mount was written as `registerStationOpsRoutes(app, {})` first and
// the deps filled in after. In between, `const { authenticateJWT } = deps` destructured
// undefined, `app.post(path, undefined, handler)` threw "argument handler must be a
// function" at module load, and the API never listened. Existence in server.js and
// completeness of the passed object are two different questions, and the second one is
// the one that kills the process.
for (let i = 0; i < lines.length; i += 1) {
  const start = lines[i].match(/^\s*(register[A-Za-z]*Routes)\(\s*app\s*,\s*(\{)?/);
  if (!start) continue;
  const factory = start[1];
  let text = null;
  if (start[2]) {
    let body = "";
    for (let j = i; j < Math.min(i + 60, lines.length); j += 1) {
      body += `\n${lines[j]}`;
      if (/\)\s*;?\s*$/.test(lines[j])) break;
    }
    const inner = body.match(/\{([\s\S]*?)\}\s*\)/);
    if (inner) text = inner[1];
  } else {
    const ident = (lines[i].match(/^\s*register[A-Za-z]*Routes\(\s*app\s*,\s*([A-Za-z_$][\w$]*)/) ?? [])[1];
    if (ident) text = objectLiteralFor(ident, i);
  }
  if (text === null) continue;
  checkEntries(text, factory, i + 1);

  const passed = new Set(entriesOf(text).map((e) => e.split(":")[0].replace(/[,{}]/g, "").trim()).filter(Boolean));
  const moduleFile = moduleFor(factory);
  if (!moduleFile) continue;
  for (const wanted of destructuredNames(moduleFile)) {
    if (!passed.has(wanted)) {
      problems.push({ kind: "unpassed", name: wanted, factory, line: i + 1, moduleFile });
    }
  }
}

if (problems.length > 0) {
  console.error(`REGISTER_DEPS_FAILED problems=${problems.length}`);
  for (const p of problems) {
    if (p.kind === "missing") {
      console.error(`  MISSING  ${p.factory} (line ${p.line}) passes \`${p.name}\`, which ${path.basename(target)} never declares`);
    } else if (p.kind === "unpassed") {
      console.error(`  UNPASSED ${p.factory} (line ${p.line}) does not pass \`${p.name}\`, which ${path.relative(process.cwd(), p.moduleFile)} destructures from deps`);
    } else {
      console.error(`  TDZ      ${p.factory} (line ${p.line}) passes \`${p.name}\`, a const declared later at line ${p.declLine}`);
      console.error(`           (module-load evaluation of a const before its declaration throws)`);
    }
  }
  console.error("  These are evaluated at module load: the process throws before app.listen and");
  console.error("  every route is dead, while `node --check` still passes. Pass a forwarding");
  console.error("  function -- `(req, res, next) => realName(req, res, next)` -- for a binding");
  console.error("  declared further down, or move the declaration above the call site.");
  process.exit(1);
}

console.log("REGISTER_DEPS_OK");
