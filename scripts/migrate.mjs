#!/usr/bin/env node
/**
 * Migration runner for the Vietnam Ruijing SMT Factory.
 *
 * Usage:
 *   node scripts/migrate.mjs                # applies pending migrations
 *   node scripts/migrate.mjs --plan         # lists pending migrations, applies nothing
 *   node scripts/migrate.mjs --fresh        # drops all tables first (dev only!)
 *   node scripts/migrate.mjs --seed         # also run seed files after migrations
 *
 * Environment variables (same as services/api/src/db.js):
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 *   Defaults: 127.0.0.1, 5432, postgres, postgres, smt_factory
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "database", "migrations");
const SEEDS_DIR = join(ROOT, "database", "seeds");
const TRACKING_TABLE = "_migrations";

// Run as the same role the API uses. Without this the runner falls back to
// postgres/postgres, and every table it creates is owned by the admin role —
// the API then fails with "permission denied for table ...". Only PG* keys are
// taken from .env, and never over an already-exported variable.
const ENV_PATH = join(ROOT, ".env");
if (existsSync(ENV_PATH)) {
  for (const rawLine of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
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

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      id serial PRIMARY KEY,
      filename varchar(255) NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now(),
      hash varchar(64) NOT NULL
    )
  `);
}

function fileHash(content) {
  // Simple hash — good enough for migration dedup
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h) + content.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}

async function getApplied() {
  const result = await pool.query(`SELECT filename, hash FROM ${TRACKING_TABLE} ORDER BY id`);
  const map = {};
  for (const row of result.rows) {
    map[row.filename] = row.hash;
  }
  return map;
}

async function applyMigration(filename, sql) {
  const hash = fileHash(sql);
  console.log(`  → ${filename} (hash=${hash})`);

  // Run in a transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);

    // Handle IF NOT EXISTS / IF EXISTS gracefully — just record success
    await client.query(
      `INSERT INTO ${TRACKING_TABLE} (filename, hash) VALUES ($1, $2) ON CONFLICT (filename) DO UPDATE SET hash = $2, applied_at = now()`,
      [filename, hash],
    );
    await client.query("COMMIT");
    console.log(`    ✓ applied`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function runSeeds() {
  if (!existsSync(SEEDS_DIR)) {
    console.log("No seeds directory found.");
    return;
  }

  const files = readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No seed files found.");
    return;
  }

  // Seeds are not all idempotent (plain INSERTs, status flips), so run each
  // seed file exactly once, tracked in its own ledger table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _seeds (
      filename varchar(255) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const appliedSeeds = new Set(
    (await pool.query(`SELECT filename FROM _seeds`)).rows.map((r) => r.filename),
  );

  console.log(`\nSeeding (${files.length} file(s)):`);
  for (const file of files) {
    if (appliedSeeds.has(file)) {
      console.log(`  ✓ ${file} already seeded`);
      continue;
    }
    const sql = readFileSync(join(SEEDS_DIR, file), "utf8").trim();
    if (!sql) continue;
    console.log(`  → ${file}`);
    await pool.query(sql);
    await pool.query(
      `INSERT INTO _seeds (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
      [file],
    );
    console.log(`    ✓ seeded`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isFresh = args.includes("--fresh");
  const doSeed = args.includes("--seed");
  const planOnly = args.includes("--plan");

  // ── Fresh start ─────────────────────────────────────────────────
  if (isFresh) {
    const databaseName = process.env.PGDATABASE ?? "smt_factory";
    const explicitApproval = process.env.ALLOW_FRESH_DATABASE_DROP === "YES";
    const clearlyNonProduction = /(^|[_-])(dev|test|local)([_-]|$)/i.test(databaseName);
    if (!explicitApproval || !clearlyNonProduction) {
      throw new Error(
        `Refusing --fresh for database "${databaseName}". ` +
        "Use a database name containing dev/test/local and set ALLOW_FRESH_DATABASE_DROP=YES.",
      );
    }
    console.log("⚠️  DROPPING ALL TABLES (--fresh mode)");
    const { rows } = await pool.query(
      `SELECT string_agg('"' || tablename || '"', ', ') AS tables FROM pg_tables WHERE schemaname = 'public'`,
    );
    if (rows[0]?.tables) {
      await pool.query(`DROP TABLE IF EXISTS ${rows[0].tables} CASCADE`);
    }
    console.log("All tables dropped.");
  }

  // ── Ensure tracking ────────────────────────────────────────────
  await ensureTrackingTable();

  // ── Discover migrations ────────────────────────────────────────
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found in", MIGRATIONS_DIR);
    await pool.end();
    return;
  }

  const applied = await getApplied();
  const pending = [];

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const hash = fileHash(sql);
    const prev = applied[file];

    if (!prev) {
      pending.push({ file, sql });
    } else {
      // Already tracked — skip regardless of hash.
      // Hash comparison is off because earlier runs used placeholders.
      // A future enhancement could verify hashes on fresh installs only.
      console.log(`  ✓ ${file} already applied`);
    }
  }

  if (planOnly) {
    console.log(`\nMigration plan (${pending.length} pending):`);
    for (const { file } of pending) console.log(`  - ${file}`);
    await pool.end();
    return;
  }

  // ── Apply ──────────────────────────────────────────────────────
  if (pending.length === 0) {
    console.log("\nAll migrations up to date.");
  } else {
    console.log(`\nApplying ${pending.length} pending migration(s):`);
    for (const { file, sql } of pending) {
      await applyMigration(file, sql);
    }
  }

  // ── Seed ───────────────────────────────────────────────────────
  if (doSeed) {
    await runSeeds();
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
