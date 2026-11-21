// Reusable loader: copies every WMS row from the rjvn database into smt_factory
// as public.rjvn_<table>. Idempotent: truncates the rjvn_* tables first.
// Usage: node scripts/etl/rjvn-wms-load.mjs [--dry]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";

const PGDUMP = "C:/Program Files/PostgreSQL/17/bin/pg_dump.exe";
const PSQL = "C:/Program Files/PostgreSQL/17/bin/psql.exe";
const SRC_DB = "wms";
const DST_DB = "smt_factory";
const EXCLUDE = [/^oa_/, /^mes_sync_log$/, /^operation_log$/, /^schema_migration_ledger$/];
const dry = process.argv.includes("--dry");

const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" };

// 1. which tables exist on the destination with the rjvn_ prefix
const dst = new pg.Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: DST_DB });
const src = new pg.Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: SRC_DB });

const dstTables = (await dst.query(
  `select tablename from pg_tables where schemaname='public' and tablename like 'rjvn\\_%'`)).rows.map(r => r.tablename);
const srcTables = (await src.query(
  `select tablename from pg_tables where schemaname='public'`)).rows.map(r => r.tablename);

const pairs = dstTables
  .map(d => ({ dst: d, src: d.replace(/^rjvn_/, "") }))
  .filter(p => srcTables.includes(p.src) && !EXCLUDE.some(re => re.test(p.src)));
console.log(`pairs to load: ${pairs.length}`);

// 2. dump data-only from the source, then re-point COPY at the rjvn_ names
const dir = mkdtempSync(join(tmpdir(), "rjvnload-"));
const dumpFile = join(dir, "data.sql");
execFileSync(PGDUMP, ["-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", SRC_DB,
  "--data-only", "--no-owner", "--no-privileges", "-f", dumpFile], { env });

let sql = readFileSync(dumpFile, "utf8");
const keep = [];
for (const block of sql.split(/^(?=COPY public\.)/m)) {
  const m = block.match(/^COPY public\.(\w+)/);
  if (!m) continue;
  if (EXCLUDE.some(re => re.test(m[1]))) continue;

  // The parity tables had oa_* columns stripped. Drop them from the COPY column
  // list AND from every data row (tab-separated), by column index.
  const lines = block.split("\n");
  const hdr = lines[0].match(/^COPY public\.\w+ \(([^)]+)\)/);
  if (hdr) {
    const cols = hdr[1].split(", ").map(c => c.replace(/"/g, ""));
    const dropIdx = cols.map((c, i) => /^oa_/i.test(c) ? i : -1).filter(i => i >= 0);
    if (dropIdx.length) {
      const kept = cols.filter((_, i) => !dropIdx.includes(i));
      lines[0] = lines[0].replace(/\([^)]+\)/, `(${kept.map(c => `"${c}"`).join(", ")})`);
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith("\\.")) break;
        const cells = lines[i].split("\t");
        lines[i] = cells.filter((_, j) => !dropIdx.includes(j)).join("\t");
      }
    }
  }
  keep.push(lines.join("\n"));
}
sql = keep.join("");
for (const p of [...pairs].sort((a, b) => b.src.length - a.src.length)) {
  sql = sql.replace(new RegExp(`^COPY public\\.${p.src}\\b`, "gm"), `COPY public.${p.dst}`);
}
// Drop all setval() calls: the rjvn_* tables are a read-only mirror and the
// source sequence names (incl. custom ones like seq_adjust_tx_no) do not exist.
sql = sql.replace(/^SELECT pg_catalog\.setval\([^\n]*\n?/gim, "");
// pg_dump 17 wraps COPY data in \restrict / \unrestrict markers; the split
// above drops the header (\restrict) but keeps the trailer (\unrestrict).
sql = sql.replace(/^\\(un)?restrict[^\n]*\n?/gim, "");

const truncate = pairs.map(p => `TRUNCATE public.${p.dst} CASCADE;`).join("\n");
const script = `SET client_min_messages=warning;\nBEGIN;\nSET session_replication_role = replica;\n${truncate}\n${sql}\nCOMMIT;\n`;
writeFileSync(join(dir, "load.sql"), script, "utf8");

if (dry) {
  console.log("dry run, script at", join(dir, "load.sql"), "bytes:", script.length);
} else {
  execFileSync(PSQL, ["-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", DST_DB,
    "-v", "ON_ERROR_STOP=1", "-q", "-f", join(dir, "load.sql")], { env, stdio: "inherit" });
}

// 3. verify row parity
let mismatches = 0;
for (const p of pairs) {
  const a = Number((await src.query(`select count(*) c from public."${p.src}"`)).rows[0].c);
  const b = Number((await dst.query(`select count(*) c from public."${p.dst}"`)).rows[0].c);
  if (a !== b) { mismatches++; console.log(`MISMATCH ${p.src}: src=${a} dst=${b}`); }
}
console.log(mismatches === 0 ? `row parity OK across ${pairs.length} tables` : `mismatches: ${mismatches}`);
await src.end(); await dst.end();
