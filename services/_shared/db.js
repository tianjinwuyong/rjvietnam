/**
 * db.js — Shared PostgreSQL connection pool for all AI managers
 *
 * Single pool instance reused across all worker scripts.
 * Lazy-init so dotenv can be configured before first use.
 *
 * Usage:
 *   import { query, withClient, shutdown, getPool } from "../_shared/db.js";
 *   const rows = await query("SELECT * FROM table WHERE id = $1", [id]);
 *   await withClient(async (client) => {
 *     await client.query("BEGIN");
 *     // ... transactional work
 *     await client.query("COMMIT");
 *   });
 */

import pg from "pg";

let pool = null;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "postgres",
      database: process.env.PGDATABASE || "smt_factory",
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error(`[DB] Pool error: ${err.message}`);
    });
  }
  return pool;
}

/**
 * Execute a single query with automatic connection release.
 */
export async function query(sql, params = []) {
  const client = await getPool().connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

/**
 * Execute a callback with a dedicated client (for transactions).
 * Callback receives a pg client and must handle BEGIN/COMMIT/ROLLBACK itself.
 */
export async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Gracefully shut down the pool (call on script exit).
 */
export async function shutdown() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export { getPool };
