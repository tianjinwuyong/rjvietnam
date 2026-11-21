#!/usr/bin/env node
// Creates (or re-provisions) the first administrator on a fresh install.
// The seed files that used to do this are gone, so an empty database has roles and
// permissions from 325_reference_master_data.sql but no account that can log in.
//
//   node scripts/create-admin.mjs --username admin --password 'S3cret!' [--name '管理员']
//   FACTORY_ADMIN_PASSWORD='S3cret!' node scripts/create-admin.mjs
//
// Password is read from --password or FACTORY_ADMIN_PASSWORD, never stored in the repo.
// Re-running with an existing username rotates its hash instead of failing.
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, "");
const ENV_PATH = join(ROOT, "services", "api", ".env");

function readEnv() {
  // .env on this workstation is CRLF: parse line by line, never `source` it.
  const env = {};
  for (const raw of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16).toString("base64");
  const hash = scryptSync(password, salt, 64, { N, r, p }).toString("base64");
  return `scrypt$${N}$${r}$${p}$${salt}$${hash}`;
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const username = flag("username", "admin");
const password = flag("password", process.env.FACTORY_ADMIN_PASSWORD ?? "");
const displayName = flag("name", "系统管理员");

if (!password || password.length < 8) {
  console.error("Refusing to continue: pass --password (or FACTORY_ADMIN_PASSWORD) with at least 8 characters.");
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
  console.error("Refusing to continue: username must be 3-32 chars of A-Z a-z 0-9 . _ -");
  process.exit(1);
}

const env = readEnv();
const { default: pg } = await import(
  `file:///${join(ROOT, "node_modules", "pg", "lib", "index.js").replace(/\\/g, "/")}`
);

const client = new pg.Client({
  host: env.PGHOST,
  port: env.PGPORT,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
});
await client.connect();

try {
  const role = await client.query(`SELECT id FROM roles WHERE code = 'admin'`);
  if (!role.rowCount) {
    throw new Error("role 'admin' is missing — run `node scripts/migrate.mjs` first");
  }
  const roleId = role.rows[0].id;
  const hash = hashPassword(password);

  const existing = await client.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing.rowCount) {
    await client.query(
      `UPDATE users SET password_hash = $2, password_updated_at = now(), status = 'active', updated_at = now()
        WHERE id = $1`,
      [existing.rows[0].id, hash],
    );
    console.log(`rotated password for existing user '${username}' (id ${existing.rows[0].id})`);
  } else {
    const inserted = await client.query(
      `INSERT INTO users (username, display_name, role_id, locale, status, password_hash, password_updated_at)
       VALUES ($1, $2, $3, 'zh-CN', 'active', $4, now())
       RETURNING id`,
      [username, displayName, roleId, hash],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [inserted.rows[0].id, roleId],
    );
    console.log(`created admin '${username}' (id ${inserted.rows[0].id}, role admin)`);
  }
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
