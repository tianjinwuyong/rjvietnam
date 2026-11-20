#!/usr/bin/env node
// Append-only gate for database/migrations/.
//
// THE DEFECT THIS HOLDS. Migrations are applied in filename order and are never
// edited once applied, but nothing enforced that: two agents can both open `311_`
// (already true -- 311_mesrj_bind_decode.sql and 311_rjvn_mirror_audit_aliases.sql),
// and an edited migration silently diverges between environments that already ran
// the old text and ones that only ever see the new text.
//
// The numbering is already broken repo-wide (46 duplicate prefixes, plus a parallel
// `YYYYMMDD_` convention), so a flat uniqueness rule would be red forever and would
// be ignored. Instead the current collisions are baselined under .factory/locks/
// (PROTECTED): a NEW collision fails the gate, and repairing one lets you lower the
// baseline with --update. Renumbering the legacy set is a data-migration decision,
// not a gate's call.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "database", "migrations");
const baselineFile = path.join(root, ".factory", "locks", "migrations-baseline.json");
const update = process.argv.includes("--update");

// Both numbering styles are in use: `311_name.sql` and `20260729_name.sql`.
const NAME_RE = /^(?:\d{3}|\d{8})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const malformed = files.filter((f) => !NAME_RE.test(f));

const byPrefix = new Map();
for (const file of files) {
  const prefix = file.split("_")[0];
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(file);
}
const duplicates = [...byPrefix]
  .filter(([, names]) => names.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));
const dupCounts = Object.fromEntries(duplicates.map(([prefix, names]) => [prefix, names.length]));

// Append-only: a tracked .sql may be added but never modified or deleted. `??` is a
// new file (allowed); any M/D/R on a tracked migration is a violation.
const status = execFileSync("git", ["status", "--porcelain", "--", "database/migrations"], {
  cwd: root,
  encoding: "utf8",
});
const touched = status
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => ({ code: line.slice(0, 2), file: line.slice(3) }))
  .filter(({ code }) => code !== "??" && /[MDRA]/.test(code));

const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : null;

if (update) {
  writeFileSync(
    baselineFile,
    `${JSON.stringify(
      {
        _what_this_is:
          "Duplicate numeric prefixes already present in database/migrations/, with how many files each already has. Ratcheted per prefix: one more file on a colliding number fails the gate, as does a brand-new collision. Renumber and re-run with --update to shrink it. Renumbering the whole legacy set is a migration decision, not a gate's.",
        duplicates: dupCounts,
        updated_at: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `MIGRATIONS_BASELINE_WRITTEN files=${files.length} prefixes=${duplicates.length} files_on_colliding_numbers=${duplicates.reduce((n, [, names]) => n + names.length, 0)}`,
  );
  process.exit(0);
}

const fail = (message) => {
  console.error(`MIGRATIONS_FAIL ${message}`);
  process.exit(1);
};

if (malformed.length) {
  fail(`malformed filenames=[${malformed.join(", ")}] (expected NNN_name.sql or YYYYMMDD_name.sql)`);
}
if (touched.length) {
  fail(
    `append-only violated: ${touched.map(({ code, file }) => `${code.trim() || "?"} ${file}`).join(", ")}`,
  );
}
if (baseline === null) {
  fail(`no baseline at ${path.relative(root, baselineFile)} -- run with --update to record it`);
}

const grown = duplicates.filter(([prefix, names]) => names.length > (baseline.duplicates[prefix] ?? 1));
if (grown.length) {
  const detail = grown
    .map(([prefix, names]) => `${prefix}: ${names.join(" + ")} (baseline ${baseline.duplicates[prefix] ?? 0})`)
    .join("; ");
  fail(`new collision on an existing number -- pick an unused prefix: ${detail}`);
}

const shrunk = duplicates.filter(([prefix, names]) => names.length < baseline.duplicates[prefix]).length;
const note = shrunk ? ` (down on ${shrunk} prefix(es) -- lower the baseline with --update)` : "";
console.log(
  `MIGRATIONS_OK files=${files.length} prefixes=${duplicates.length} baseline=${Object.keys(baseline.duplicates).length}${note}`,
);
