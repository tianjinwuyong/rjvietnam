#!/usr/bin/env node
const { readFileSync, existsSync, readdirSync } = require('fs');
const { join, dirname } = require('path');
const { fileURLToPath } = require('url');
const pg = require('pg');

const scriptPath = require.resolve(__filename);
const scriptDir = dirname(scriptPath);
const root = join(scriptDir, '..');
const seedsDir = join(root, 'database', 'seeds');

const pool = new pg.Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'smt_factory',
});

async function main() {
  if (!existsSync(seedsDir)) {
    console.log('No seeds directory found.');
    return;
  }

  const files = readdirSync(seedsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`Seeding (${files.length} file(s)):\n`);
  let ok = 0, skipped = 0;
  for (const file of files) {
    const sql = readFileSync(join(seedsDir, file), 'utf8').trim();
    if (!sql) { console.log(`  ${file}: empty, skip`); continue; }
    process.stdout.write(`  → ${file} ... `);
    const client = await pool.connect();
    try {
      await client.query(sql);
      console.log('OK');
      ok++;
    } catch (e) {
      const msg = e.message.split('\n')[0];
      if (e.code === '23505' || e.code === '23503') {
        console.log('already seeded (skip)');
        skipped++;
      } else {
        console.log('FAILED:', msg);
      }
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log(`\nDone. ${ok} OK, ${skipped} already seeded.`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});