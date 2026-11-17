#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const filename = basename(String(process.argv[2] || ""));
if (!/^\d+[a-zA-Z0-9_.-]*\.sql$/.test(filename)) {
  throw new Error("Provide one migration filename, for example 217_mes_product_root_and_gate.sql");
}
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const file = join(root, "database", "migrations", filename);
if (!existsSync(file)) throw new Error(`Migration not found: ${filename}`);
const sql = readFileSync(file, "utf8");
let hash = 0;
for (let index = 0; index < sql.length; index += 1) {
  hash = ((hash << 5) - hash) + sql.charCodeAt(index); hash |= 0;
}
const migrationHash = Math.abs(hash).toString(16).padStart(8, "0");
const pool = new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
  user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE});
const client = await pool.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations(id serial PRIMARY KEY,
    filename varchar(255) NOT NULL UNIQUE,applied_at timestamptz NOT NULL DEFAULT now(),hash varchar(64) NOT NULL)`);
  const existing = (await client.query("SELECT filename,hash,applied_at FROM _migrations WHERE filename=$1", [filename])).rows[0];
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify({filename,alreadyApplied:Boolean(existing),existing,hash:migrationHash,database:process.env.PGDATABASE}, null, 2));
  } else if (existing) {
    console.log(`${filename} already applied; no changes made`);
  } else {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO _migrations(filename,hash) VALUES($1,$2)", [filename,migrationHash]);
    await client.query("COMMIT");
    console.log(`${filename} applied to ${process.env.PGDATABASE}`);
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release(); await pool.end();
}
