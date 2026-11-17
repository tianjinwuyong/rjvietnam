#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SEEDS_DIR = join(ROOT, "database", "seeds");

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: "postgres",  // hardcoded — avoids env-var masking issue
  database: process.env.PGDATABASE ?? "smt_factory",
});

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

  console.log(`\nSeeding (${files.length} file(s)):`);
  for (const file of files) {
    const sql = readFileSync(join(SEEDS_DIR, file), "utf8").trim();
    if (!sql) continue;
    console.log(`  → ${file}`);
    await pool.query(sql);
    console.log(`    ✓ seeded`);
  }
}

async function main() {
  await runSeeds();
  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
