// ============================================================
// OA merged-mode database layer (parity port from OA app/server/src/db/index.js)
//
// Differences vs the standalone OA server (all intentional):
//   · Connects to the SAME PostgreSQL database as the SMT API
//     (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from services/api/.env).
//   · All OA objects live in schema `oa`; the pool sets
//     search_path=oa,public so the unqualified OA SQL resolves unchanged.
//   · Per-pool type parsers instead of global types.setTypeParser —
//     the standalone OA server mutated the shared pg type parsers, which
//     would have changed how the SMT side parses dates. Same observable
//     behavior for OA queries, zero impact on SMT queries.
//   · Pool is created lazily: ES module imports evaluate before
//     server.js runs dotenv.config(), so an eager pool would see empty env.
// ============================================================
import pg from 'pg';

const { Pool } = pg;

let pool = null;

function oaTypes() {
  const baseGet = pg.types.getTypeParser.bind(pg.types);
  return {
    // TypeOverrides(userTypes) only calls getTypeParser(oid, format)
    getTypeParser(oid, format) {
      // TIMESTAMPTZ: parse to UTC ISO string (OA convention, mirrors
      // the standalone server's types.setTypeParser(TIMESTAMPTZ, ...))
      if (oid === pg.types.builtins.TIMESTAMPTZ) {
        return v => (v === null || v === undefined ? v : new Date(v).toISOString());
      }
      // DATE: keep the raw string (OA convention)
      if (oid === pg.types.builtins.DATE) {
        return v => v;
      }
      return baseGet(oid, format);
    },
  };
}

function getPool() {
  if (!pool) {
    const host = process.env.PGHOST;
    if (!host || host === 'undefined' || host === 'null' || host.trim() === '') {
      throw new Error('[oa-db] PGHOST not set — cannot create OA pool');
    }
    pool = new Pool({
      host,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD ?? '',
      database: process.env.PGDATABASE ?? 'smt_factory',
      max: Number(process.env.OA_DB_POOL_MAX ?? 10),
      ssl: false,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // Session timezone fixed to UTC (same rationale as the standalone
      // OA server: bare timestamp strings must round-trip identically),
      // plus schema routing for all unqualified OA SQL.
      options: '-c timezone=UTC -c search_path=oa,public',
      types: oaTypes(),
    });
    pool.on('error', err => {
      console.error('[oa-db] idle client error:', err.message);
    });
    console.log(`[oa-db] pool created for ${host}:${process.env.PGPORT ?? 5432}/${process.env.PGDATABASE ?? 'smt_factory'} (search_path=oa,public)`);
  }
  return pool;
}

export async function query(text, params) {
  const start = Date.now();
  const res = await getPool().query(text, params);
  const cost = Date.now() - start;
  if (cost > 500) {
    console.warn(`[oa-db] slow query ${cost}ms:`, text.slice(0, 90).replace(/\s+/g, ' '));
  }
  return res;
}

export const one = async (text, params) => (await query(text, params)).rows[0] || null;
export const many = async (text, params) => (await query(text, params)).rows;

/** Run fn inside a transaction; rollback on exception. */
export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Boot-time DB probe (used by /api/oa health endpoints). */
export async function checkConnection() {
  try {
    await getPool().query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code || null };
  }
}
