#!/usr/bin/env node
// Ratchet for type errors in services/api (checkJs).
//
// WHY A RATCHET AND NOT A GATE. `services/api/src` has ~600 pre-existing type errors.
// Fixing all of them is a migration, not a chore, and a gate that demands it blocks
// every unrelated merge -- which is how a quality gate gets deleted. So the number is
// allowed to stay where it is and is NOT allowed to grow.
//
// WHY SIGNATURES AND NOT JUST A COUNT. A count cannot tell "one new error" from "one
// new error and one fixed". On a repo with concurrent agents that is the difference
// between a real regression and noise, so the baseline stores `file|TSxxxx` for every
// error and the gate fails on any signature that is not already there. Line numbers
// are deliberately excluded: they move on every unrelated edit.
//
// The baseline lives in .factory/locks/, which factory/guard.py marks PROTECTED: a
// builder cannot raise it in the same pull request that introduced the errors.
// Lowering it is a normal improvement -- pass --update after fixing a batch.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselineFile = path.join(root, ".factory", "locks", "api-typecheck-baseline.json");
const update = process.argv.includes("--update");

const res = spawnSync(
  process.execPath,
  [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.api.json", "--noEmit"],
  { cwd: root, encoding: "utf8" },
);

const output = `${res.stdout || ""}${res.stderr || ""}`;
const lines = output.split("\n").filter((line) => /error TS\d+/.test(line));

const signature = (line) => {
  const m = /^(.+?)\(\d+,\d+\): error (TS\d+)/.exec(line.trim());
  if (!m) return line.trim().slice(0, 120);
  return `${m[1].replaceAll("\\", "/")}|${m[2]}`;
};

const sigs = lines.map(signature);
const counts = new Map();
for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1);

const baseline = existsSync(baselineFile)
  ? JSON.parse(readFileSync(baselineFile, "utf8"))
  : null;

if (update) {
  writeFileSync(
    baselineFile,
    `${JSON.stringify(
      {
        _what_this_is:
          "Type errors in services/api under checkJs, as `file|TSxxxx` signatures with their occurrence count. Ratcheted: the gate fails on any signature not already here, or any signature occurring more often than recorded. Line and column are excluded on purpose -- they move on unrelated edits. factory/guard.py keeps this PROTECTED.",
        total: sigs.length,
        signatures: Object.fromEntries([...counts].sort()),
        updated_at: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`API_TYPES_BASELINE_WRITTEN errors=${sigs.length} signatures=${counts.size}`);
  process.exit(0);
}

if (baseline === null) {
  console.error(
    `API_TYPES_NO_BASELINE no ${path.relative(root, baselineFile)}. Run \`node scripts/typecheck-api.mjs --update\` once, as a human, to record the starting point.`,
  );
  process.exit(2);
}

// Tolerate a baseline written by the older count-only version.
const previous = baseline.signatures ?? null;
const previousTotal = previous ? null : baseline.errors;

const regressions = [];
if (previous) {
  for (const [sig, n] of counts) {
    const was = previous[sig] ?? 0;
    if (n > was) regressions.push(`${sig}  now ${n}, baseline ${was}`);
  }
} else if (sigs.length > previousTotal) {
  regressions.push(`total ${sigs.length} exceeds baseline ${previousTotal} (no signatures recorded -- re-baseline with --update)`);
}

if (regressions.length) {
  console.error(`API_TYPES_REGRESSION errors=${sigs.length} baseline=${baseline.total ?? previousTotal}`);
  for (const r of regressions.slice(0, 15)) console.error(`  ${r}`);
  console.error("Fix the new error, or -- if the file is being edited by another agent right now -- coordinate before re-baselining: raising this number is a human decision.");
  process.exit(1);
}

const lowered = previous && Object.entries(previous).some(([sig, n]) => (counts.get(sig) ?? 0) < n);
const note = lowered ? " (some signatures dropped -- lower the baseline with --update)" : "";
console.log(`API_TYPES_OK errors=${sigs.length} baseline=${baseline.total ?? previousTotal}${note}`);
