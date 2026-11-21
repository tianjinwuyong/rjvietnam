#!/usr/bin/env node
// Parse every service source file with `node --check`.
//
// services/api/server.js is 49k lines and lives OUTSIDE tsconfig.base.json's
// include list (allowJs is false), so `npm run typecheck` never opens it. Without
// this rung the static gate reports green for the largest file in the repo.
//
// `node --check` is a parser, not a type checker: it catches syntax errors,
// unbalanced blocks and mis-nested template literals. That is the floor, not a
// substitute for tests.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROOTS = ["services", "packages", "apps/station-agent/src"];

// Vendored, generated, runtime or retired trees. `node_modules` is by far the
// biggest, but oa-web*/ and public/ hold copied bundles that are not ours.
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".venv",
  ".venv-ocr",
  "__pycache__",
  "oa-web",
  "oa-web-next",
  "public",
  "data",
  "print-templates",
  "android",
  "coverage",
]);

const SKIP_FILE = /(\.testbak\.js|\.min\.js|\.bundle\.js)$/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name) && !SKIP_FILE.test(entry.name)) {
      out.push(full);
    }
  }
}

const files = [];
for (const dir of ROOTS) {
  const abs = path.join(root, dir);
  try {
    if (statSync(abs).isDirectory()) walk(abs, files);
  } catch {
    // Directory absent -- say so rather than silently checking fewer files.
    console.warn(`SYNTAX_SKIP missing directory ${dir}`);
  }
}

const failures = [];
for (const file of files) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) {
    failures.push({ file: path.relative(root, file), out: (res.stderr || res.stdout || "").trim().split("\n").slice(0, 4).join("\n") });
  }
}

if (failures.length) {
  for (const f of failures) console.error(`\nSYNTAX_ERROR ${f.file}\n${f.out}`);
  console.error(`\nSYNTAX_FAILED files=${failures.length} of ${files.length}`);
  process.exit(1);
}

console.log(`SYNTAX_OK files=${files.length}`);
