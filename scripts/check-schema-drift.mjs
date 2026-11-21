#!/usr/bin/env node
// Fresh-install replay gate: can every migration still run, in order, against an
// empty schema?
//
// THE DEFECT THIS HOLDS. An existing database hides broken migrations: a file runs
// once, so a column it reads may be dropped by a later file and nothing complains
// until someone rebuilds the database from scratch -- or until an object the file
// created turns out to be missing and an endpoint answers 500. Verified 2026-11-20:
// 040 builds v_report_aoi_yield from aoi_inspection_records(station_id, occurred_at),
// 072 then runs DROP TABLE aoi_inspection_records CASCADE and recreates it with
// station_code/inspected_at, so the view was silently gone and /reports/aoi-yield
// answered 500.
//
// HOW. Unqualified DDL lands in a throwaway schema `drift_probe`, every reference to
// `public.` is rewritten to it, files replay in the runner's own order (filename
// sort), and the schema is DROPPED at the end -- so the live schema is never touched.
// No outer transaction is used on purpose: several files carry their own BEGIN;/COMMIT;
// and stripping those corrupted plpgsql bodies (043 failed with a bogus syntax error),
// while wrapping them in a transaction leaks their objects when they COMMIT.
//
// Known limit: this proves each file replays against the state its predecessors left;
// it does not prove the resulting schema is complete (a file recorded as applied is
// still skipped by the runner), and objects a file creates can still be CASCADE-dropped
// by a later one -- that is what 314 fixed for v_report_aoi_yield.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "database", "migrations");
const baselineFile = path.join(root, ".factory", "locks", "schema-drift-baseline.json");
const update = process.argv.includes("--update");
const PROBE = "drift_probe";

// Same env handling as scripts/migrate.mjs: PG* keys only, never over an exported var.
const envPath = path.join(root, ".env");
if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^PG[A-Z_]+$/.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// SAFETY. This replays 300+ migration files, so it only ever runs against a throwaway
// database: DRIFT_PGDATABASE is required and must not be the application database. An
// earlier version defaulted to the app database and, when a file's own COMMIT ended the
// harness transaction, wrote 1468 objects into a probe schema and briefly executed
// statements against the live one. The search_path is also pinned per connection so a
// missed reset cannot reach public.
const driftDatabase = process.env.DRIFT_PGDATABASE ?? "";
const appDatabase = process.env.PGDATABASE ?? "smt_factory";
// `--probe-schema` replays into `drift_probe` inside the connected database instead:
// every unqualified object lands there, `public.` is rewritten to it, and the schema is
// dropped afterwards, so the live schema is never the target. Use it when CREATEDB is
// not available locally.
const probeMode = process.argv.includes("--probe-schema");
if (!driftDatabase && !probeMode) {
  console.error(
    "SCHEMA_DRIFT_SKIPPED set DRIFT_PGDATABASE to a disposable database, or pass --probe-schema to replay into a throwaway schema; refusing to run blind against the application database",
  );
  process.exit(0);
}
if (driftDatabase && driftDatabase === appDatabase) {
  console.error(`SCHEMA_DRIFT_FAIL DRIFT_PGDATABASE must differ from PGDATABASE (both are ${appDatabase})`);
  process.exit(1);
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: driftDatabase,
});

const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
const failures = [];
const unverifiable = [];

const clearAborted = async () => {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* nothing to roll back */
  }
};

// A single DROP SCHEMA ... CASCADE over 1400+ objects exceeds max_locks_per_transaction
// ("out of shared memory"), which is why the probe schema once survived a crashed run.
// Objects are dropped in batches instead.
const dropProbe = async () => {
  const KIND = { r: "TABLE", p: "TABLE", v: "VIEW", m: "MATERIALIZED VIEW", S: "SEQUENCE", f: "FOREIGN TABLE" };
  for (let round = 0; round < 200; round += 1) {
    let rows = [];
    try {
      ({ rows } = await client.query(
        `select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = $1 and c.relkind in ('r','p','v','m','S','f') order by c.relkind limit 100`,
        [PROBE],
      ));
    } catch {
      await clearAborted();
      continue;
    }
    if (rows.length === 0) break;
    for (const r of rows) {
      try {
        await client.query(`DROP ${KIND[r.relkind]} IF EXISTS "${PROBE}"."${r.relname}" CASCADE`);
      } catch {
        await clearAborted();
      }
    }
  }
  try {
    const fns = await client.query(
      `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1`,
      [PROBE],
    );
    for (const f of fns.rows) {
      try {
        await client.query(`DROP ROUTINE IF EXISTS ${f.sig} CASCADE`);
      } catch {
        await clearAborted();
      }
    }
  } catch {
    await clearAborted();
  }
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${PROBE}" CASCADE`);
  } catch {
    await clearAborted();
  }
};

await client.connect();
try {
  await dropProbe();
  await client.query(`CREATE SCHEMA ${PROBE}`);
  // Some migrations read the runner's own ledger; give them a stub instead of failing on
  // a table that only exists in a database the runner has already touched.
  await client.query(
    `CREATE TABLE ${PROBE}._migrations (
       id serial PRIMARY KEY, filename varchar(255) NOT NULL UNIQUE,
       applied_at timestamptz NOT NULL DEFAULT now(), hash varchar(64) NOT NULL)`,
  );
  // `public.`-qualified DDL (309 and friends) must land in the probe too, otherwise a
  // replay would alter live tables.
  const PUBLIC_PREFIX = /(?<![\w$])public\./g;
  for (const file of files) {
    // Files carry their own BEGIN;/COMMIT;, and a failure inside one leaves the session
    // in an aborted transaction where every later statement is ignored -- including the
    // search_path reset. Clearing that state comes first, every file.
    await clearAborted();
    // The search_path is re-set for every file: a file that runs `SET search_path` or
    // `RESET ALL` would otherwise send the rest of the replay into public. Without this
    // line the whole replay ran against the live schema (2026-11-20) -- most statements
    // died on "already exists", which is the only reason it caused no visible damage.
    await client.query(`SET search_path TO ${PROBE}`);
    const sql = readFileSync(path.join(migrationsDir, file), "utf8").replace(PUBLIC_PREFIX, `${PROBE}.`);
    try {
      await client.query(sql);
    } catch (err) {
      failures.push({ file, message: String(err.message).split("\n")[0].slice(0, 160) });
    }
  }
} finally {
  // Unconditional cleanup: this schema only ever belongs to this harness.
  await clearAborted();
  await dropProbe();
  await client.end();
}

const failedFiles = failures.map((f) => f.file);
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : null;

if (update) {
  writeFileSync(
    baselineFile,
    `${JSON.stringify(
      {
        _what_this_is:
          "Migration files that cannot be replayed in order against an empty schema (their predecessors leave them unable to run). Ratcheted: a newly failing file fails the gate; fix one and re-run with --update to shrink it. Clearing this list is what makes `--fresh` meaningful again.",
        failing: Object.fromEntries(failures.map((f) => [f.file, f.message])),
        updated_at: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`SCHEMA_DRIFT_BASELINE_WRITTEN files=${files.length} failing=${failures.length}`);
  process.exit(0);
}

if (baseline === null) {
  console.error(`SCHEMA_DRIFT_FAIL no baseline at ${path.relative(root, baselineFile)} -- run with --update to record it`);
  process.exit(1);
}

const known = new Set(Object.keys(baseline.failing));
const fresh = failures.filter((f) => !known.has(f.file));
if (fresh.length) {
  console.error("SCHEMA_DRIFT_FAIL new failing migration(s) -- they cannot run against an empty schema:");
  for (const f of fresh) console.error(`  ${f.file}: ${f.message}`);
  process.exit(1);
}

const note = failedFiles.length < known.size ? ` (down ${known.size - failedFiles.length} -- lower the baseline with --update)` : "";
console.log(
  `SCHEMA_DRIFT_OK files=${files.length} failing=${failedFiles.length} baseline=${known.size}${note}`,
);
