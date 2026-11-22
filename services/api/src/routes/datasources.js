// External data-source registry and table sync.
//
// WHY THIS FILE EXISTS. The plant keeps copies of the same master in several places (the
// legacy MySQL MES, a mirror server, another plant's PostgreSQL). Operators need to point
// this API at one of them and pull tables in without a developer editing .env: so the
// connections live in `data_source_provider`, every copy is recorded in
// `data_source_sync_run` / `data_source_sync_table`, and the target is a staging schema
// `ext_<provider_code>` that never touches the business tables.
//
// Mounting: `registerDatasourceRoutes(app, deps)` is called from server.js after the auth
// wrapper, so every route below is JWT-guarded and permission-checked like the rest of the
// `api` group.
//
// TRANSIENT MODE (2026-11-23, user directive ①「SMT 库里不要有源系统的重复数据库」):
// providers tagged transient (wms_src / oa_src) do NOT leave a full copy of the source
// database sitting in SMT. One run = copy→ingest→drop: rows land in ext_<code>, are
// immediately ingested into the business tables (live-converge backfillFromExt +
// stampProvenance, under the app.source_sync tx so the 399 column-ownership triggers
// allow it), then DROP SCHEMA ext_<code> CASCADE. At rest the duplicate is gone; the
// business tables + data_provenance carry the truth, and parity audits compare
// source↔business directly. Non-transient providers (e.g. rjms) keep the persistent
// ext_<code> copy — that is the feature for those.
import pg from "pg";
import { backfillFromExt, stampProvenance, withSourceSyncTx } from "./live-converge.js";

// provider code → the live-sync app id stampProvenance/backfill expect, and ext schema.
const TRANSIENT_PROVIDERS = {
  wms_src: { code: "wms-rjvn", ext: "ext_wms_src" },
  oa_src: { code: "oa-portal", ext: "ext_oa_src" },
};

export function registerDatasourceRoutes(app, deps) {
  const { query, requirePermission, errorEnvelope, listEnvelope, mutateEnvelope, getClient } = deps;

  const adminOnly = requirePermission("wms.execute");

  app.get("/api/datasources", adminOnly, async (req, res) => {
    try {
      const { rows } = await query(
        `SELECT p.*,
                (SELECT row_to_json(r) FROM data_source_sync_run r
                  WHERE r.provider_id = p.id ORDER BY r.started_at DESC LIMIT 1) AS last_run
           FROM data_source_provider p ORDER BY p.id`,
      );
      res.json(
        listEnvelope(
          rows.map((r) => ({ ...r, config: maskConfig(r.config), running: runningProviders.has(r.id) })),
          rows.length,
        ),
      );
    } catch (err) {
      res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  app.post("/api/datasources", adminOnly, async (req, res) => {
    const { code, nameZh, kind = "postgres", config = {}, enabled = true } = req.body || {};
    if (!PROVIDER_CODE_RE.test(String(code || ""))) {
      return res.status(400).json(errorEnvelope("VALIDATION", "code must match ^[a-z][a-z0-9_]{1,30}$"));
    }
    if (!nameZh) return res.status(400).json(errorEnvelope("VALIDATION", "nameZh is required"));
    if (!["postgres", "mysql"].includes(kind)) {
      return res.status(400).json(errorEnvelope("VALIDATION", "kind must be postgres or mysql"));
    }
    if (!config.host || !config.database || !config.user) {
      return res.status(400).json(errorEnvelope("VALIDATION", "config.host, config.database and config.user are required"));
    }
    try {
      const { rows } = await query(
        `INSERT INTO data_source_provider (code, name_zh, kind, config, enabled)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [code, nameZh, kind, config, enabled],
      );
      res.status(201).json(mutateEnvelope({ ...rows[0], config: maskConfig(rows[0].config) }));
    } catch (err) {
      const status = err.code === "23505" ? 409 : 500;
      res.status(status).json(errorEnvelope("DATASOURCE_SAVE_FAILED", err.message));
    }
  });

  app.patch("/api/datasources/:id", adminOnly, async (req, res) => {
    const { nameZh, kind, config, enabled } = req.body || {};
    try {
      const { rows } = await query(
        `UPDATE data_source_provider
            SET name_zh = COALESCE($2, name_zh),
                kind = COALESCE($3, kind),
                config = COALESCE($4, config),
                enabled = COALESCE($5, enabled),
                updated_at = now()
          WHERE id = $1 RETURNING *`,
        [Number(req.params.id), nameZh ?? null, kind ?? null, config ?? null, enabled ?? null],
      );
      if (!rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "datasource not found"));
      res.json(mutateEnvelope({ ...rows[0], config: maskConfig(rows[0].config) }));
    } catch (err) {
      res.status(500).json(errorEnvelope("DATASOURCE_SAVE_FAILED", err.message));
    }
  });

  app.delete("/api/datasources/:id", adminOnly, async (req, res) => {
    try {
      const { rows } = await query(
        `DELETE FROM data_source_provider WHERE id = $1 RETURNING code`,
        [Number(req.params.id)],
      );
      if (!rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "datasource not found"));
      res.json(mutateEnvelope({ code: rows[0].code }));
    } catch (err) {
      res.status(500).json(errorEnvelope("DATASOURCE_DELETE_FAILED", err.message));
    }
  });

  app.post("/api/datasources/:id/test", adminOnly, async (req, res) => {
    try {
      const { rows } = await query(`SELECT * FROM data_source_provider WHERE id = $1`, [Number(req.params.id)]);
      if (!rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "datasource not found"));
      const provider = rows[0];
      let message = "";
      try {
        const info = await withRemote(provider, async (remote) => {
          const tables = await listRemoteTables(remote, provider.config || {});
          const version =
            remote.kind === "mysql"
              ? (await remote.conn.query("SELECT VERSION() AS v"))[0][0].v
              : (await remote.conn.query("SHOW server_version")).rows[0].server_version;
          return { version, tables: tables.length };
        });
        message = `${info.version} · ${info.tables} tables`;
        await query(
          `UPDATE data_source_provider SET last_test_at = now(), last_test_ok = true, last_test_message = $2 WHERE id = $1`,
          [provider.id, message],
        );
        res.json(mutateEnvelope({ ok: true, message }));
      } catch (err) {
        message = String(err.message).slice(0, 400);
        await query(
          `UPDATE data_source_provider SET last_test_at = now(), last_test_ok = false, last_test_message = $2 WHERE id = $1`,
          [provider.id, message],
        );
        res.status(200).json(mutateEnvelope({ ok: false, message }));
      }
    } catch (err) {
      res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  app.get("/api/datasources/:id/tables", adminOnly, async (req, res) => {
    try {
      const { rows } = await query(`SELECT * FROM data_source_provider WHERE id = $1`, [Number(req.params.id)]);
      if (!rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "datasource not found"));
      const provider = rows[0];
      const tables = await withRemote(provider, (remote) => listRemoteTables(remote, provider.config || {}));
      res.json(listEnvelope(tables, tables.length));
    } catch (err) {
      res.status(502).json(errorEnvelope("DATASOURCE_UNREACHABLE", err.message));
    }
  });

  app.post("/api/datasources/:id/sync", adminOnly, async (req, res) => {
    const { tables, mode = "replace", all = false } = req.body || {};
    try {
      const { rows } = await query(`SELECT * FROM data_source_provider WHERE id = $1`, [Number(req.params.id)]);
      if (!rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "datasource not found"));
      const provider = rows[0];
      if (!provider.enabled) return res.status(400).json(errorEnvelope("DATASOURCE_DISABLED", "datasource is disabled"));
      if (runningProviders.has(provider.id)) {
        return res.status(409).json(errorEnvelope("SYNC_IN_PROGRESS", "a sync is already running for this datasource"));
      }
      if (!["replace", "append"].includes(mode)) {
        return res.status(400).json(errorEnvelope("VALIDATION", "mode must be replace or append"));
      }
      let wanted = Array.isArray(tables) ? tables.map(String) : [];
      if (all || wanted.length === 0) {
        const remoteTables = await withRemote(provider, (remote) => listRemoteTables(remote, provider.config || {}));
        wanted = remoteTables.map((t) => t.name);
      }
      if (!wanted.length) return res.status(400).json(errorEnvelope("VALIDATION", "no tables selected"));
      // The production schema has 1,320 tables, so "sync all" must not be capped at a number
      // that makes the feature refuse its own headline use case.
      if (wanted.length > 5000) {
        return res.status(400).json(errorEnvelope("VALIDATION", "too many tables in one sync (max 5000)"));
      }

      const { rows: [run] } = await query(
        `INSERT INTO data_source_sync_run (provider_id, mode, tables_total) VALUES ($1, $2, $3) RETURNING *`,
        [provider.id, mode, wanted.length],
      );
      runningProviders.add(provider.id);
      const batchSize = Math.min(Math.max(Number(process.env.DATASOURCE_BATCH_SIZE || 2000), 100), 10000);
      // Fire and forget: the UI follows /runs/:id.
      void runSync({ query, provider, runId: run.id, tables: wanted, mode, batchSize, getClient });
      res.status(202).json(mutateEnvelope({ runId: run.id, tables: wanted.length }));
    } catch (err) {
      res.status(502).json(errorEnvelope("SYNC_START_FAILED", err.message));
    }
  });

  app.get("/api/datasources/:id/runs", adminOnly, async (req, res) => {
    try {
      const { rows } = await query(
        `SELECT * FROM data_source_sync_run WHERE provider_id = $1 ORDER BY started_at DESC LIMIT 20`,
        [Number(req.params.id)],
      );
      res.json(listEnvelope(rows, rows.length));
    } catch (err) {
      res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  app.get("/api/datasources/runs/:runId", adminOnly, async (req, res) => {
    try {
      const runId = Number(req.params.runId);
      const run = (await query(`SELECT * FROM data_source_sync_run WHERE id = $1`, [runId])).rows[0];
      if (!run) return res.status(404).json(errorEnvelope("NOT_FOUND", "run not found"));
      const tables = await query(
        `SELECT table_name, target_schema, rows_copied, status, message, finished_at
           FROM data_source_sync_table WHERE run_id = $1 ORDER BY id`,
        [runId],
      );
      res.json(mutateEnvelope({ run, tables: tables.rows }));
    } catch (err) {
      res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  // Transient cycle timer: because ext_<code> is dropped at the end of every
  // transient run, something has to re-open the snapshot periodically or the
  // business tables go stale between manual triggers. Every DATASOURCE_TRANSIENT_
  // INTERVAL_MIN (default 30) minutes, kick one all-tables sync per enabled
  // transient provider — copy→ingest→stamp→drop, self-maintaining, no duplicate
  // at rest. Unref'd so it never holds the process open; a run already in flight
  // for that provider is skipped (runningProviders).
  const transientTimer = setInterval(() => {
    for (const code of Object.keys(TRANSIENT_PROVIDERS)) {
      void (async () => {
        try {
          const { rows } = await query(`SELECT * FROM data_source_provider WHERE code = $1 AND enabled = TRUE`, [code]);
          const provider = rows[0];
          if (!provider || runningProviders.has(provider.id)) return;
          const wanted = await withRemote(provider, (remote) => listRemoteTables(remote, provider.config || {}));
          if (!wanted.length) return;
          const { rows: [run] } = await query(
            `INSERT INTO data_source_sync_run (provider_id, mode, tables_total) VALUES ($1,'replace',$2) RETURNING id`,
            [provider.id, wanted.length],
          );
          runningProviders.add(provider.id);
          const batchSize = Math.min(Math.max(Number(process.env.DATASOURCE_BATCH_SIZE || 2000), 100), 10000);
          void runSync({ query, provider, runId: run.id, tables: wanted.map((t) => t.name), mode: "replace", batchSize, getClient });
        } catch { /* 下一轮再试;失败不影响主服务 */ }
      })();
    }
  }, Math.min(1440, Math.max(5, Number(process.env.DATASOURCE_TRANSIENT_INTERVAL_MIN || 30) || 30)) * 60_000);
  if (typeof transientTimer.unref === "function") transientTimer.unref();
}

// Runs are asynchronous (a 3 GB source must not hold an HTTP request open); this keeps one
// sync per provider at a time and lets the UI follow progress through /runs/:id.
const runningProviders = new Set();

const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const PROVIDER_CODE_RE = /^[a-z][a-z0-9_]{1,30}$/;

function maskConfig(config) {
  if (!config || typeof config !== "object") return {};
  const { password, ...rest } = config;
  return { ...rest, password: password ? "********" : undefined };
}

function targetSchemaFor(code) {
  return `ext_${code}`.slice(0, 63);
}

/** Remote column type -> local staging type. Staging is for reading, not for joins. */
function mapColumnType(kind, dataType, udtName) {
  const t = String(udtName || dataType || "").toLowerCase();
  if (/^(int|integer|smallint|bigint|serial|bigserial)/.test(t)) return "bigint";
  if (/^(numeric|decimal|real|double|float|money)/.test(t)) return "numeric";
  if (/^bool/.test(t)) return "boolean";
  // MySQL spells it DATETIME, PostgreSQL TIMESTAMP; both land in timestamptz.
  if (/^(timestamp|datetime)/.test(t)) return "timestamptz";
  if (/^date$/.test(t)) return "date";
  if (/^time$/.test(t)) return "time";
  if (/^json/.test(t)) return "jsonb";
  if (kind === "mysql" && /^(tinyint\(1\)|mediumint|year)/.test(t)) return "bigint";
  // Binary must not fall through to text: node-pg sends a Buffer as `\x…` and a text column
  // would then store the hex literal instead of the bytes.
  if (/^(bytea|byte|blob|binary|varbinary|longblob|mediumblob|tinyblob)/.test(t)) return "bytea";
  return "text";
}

async function withRemote(provider, fn) {
  const cfg = provider.config || {};
  if (provider.kind === "mysql") {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: Number(cfg.port || 3306),
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      connectTimeout: Number(cfg.connectTimeoutMs || 15000),
    });
    try {
      return await fn({ kind: "mysql", conn });
    } finally {
      await conn.end().catch(() => {});
    }
  }
  const client = new pg.Client({
    host: cfg.host,
    port: Number(cfg.port || 5432),
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: Number(cfg.connectTimeoutMs || 15000),
  });
  await client.connect();
  try {
    return await fn({ kind: "postgres", conn: client });
  } finally {
    await client.end().catch(() => {});
  }
}

async function listRemoteTables(remote, cfg) {
  if (remote.kind === "mysql") {
    const [rows] = await remote.conn.query(
      `SELECT table_name AS name, table_rows AS est_rows
         FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    return rows.map((r) => ({ name: r.name, estRows: Number(r.est_rows || 0) }));
  }
  const schema = cfg.schema || "public";
  const { rows } = await remote.conn.query(
    `SELECT c.relname AS name, GREATEST(c.reltuples, 0)::bigint AS est_rows
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`,
    [schema],
  );
  return rows.map((r) => ({ name: r.name, estRows: Number(r.est_rows || 0) }));
}

async function remoteColumns(remote, cfg, table) {
  if (remote.kind === "mysql") {
    const [rows] = await remote.conn.query(
      `SELECT column_name AS name, data_type AS data_type, column_type AS udt_name,
              is_nullable AS is_nullable
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?
        ORDER BY ordinal_position`,
      [table],
    );
    return rows.map((r) => ({
      name: r.name,
      type: mapColumnType("mysql", r.data_type, r.udt_name),
      nullable: r.is_nullable === "YES",
    }));
  }
  const schema = cfg.schema || "public";
  const { rows } = await remote.conn.query(
    `SELECT column_name AS name, data_type, udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schema, table],
  );
  return rows.map((r) => ({
    name: r.name,
    type: mapColumnType("postgres", r.data_type, r.udt_name),
    nullable: r.is_nullable === "YES",
  }));
}

/** Primary key columns of a remote table, in constraint order (empty when it has none). */
async function remotePrimaryKey(remote, cfg, table) {
  if (remote.kind === "mysql") {
    const [rows] = await remote.conn.query(
      `SELECT k.column_name AS name
         FROM information_schema.table_constraints c
         JOIN information_schema.key_column_usage k
           ON k.constraint_schema = c.constraint_schema
          AND k.constraint_name = c.constraint_name
          AND k.table_name = c.table_name
        WHERE c.table_schema = DATABASE() AND c.table_name = ? AND c.constraint_type = 'PRIMARY KEY'
        ORDER BY k.ordinal_position`,
      [table],
    );
    return rows.map((r) => r.name);
  }
  const { rows } = await remote.conn.query(
    `SELECT a.attname AS name
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE n.nspname = $1 AND c.relname = $2 AND i.indisprimary
      ORDER BY k.ord`,
    [cfg.schema || "public", table],
  );
  return rows.map((r) => r.name);
}

/** Copy one remote table into `ext_<code>` on this database. */
async function copyTable({ query, provider, code, runId, table, mode, batchSize }) {
  const schema = targetSchemaFor(code);
  const cfg = provider.config || {};
  return withRemote(provider, async (remote) => {
    const columns = await remoteColumns(remote, cfg, table);
    // A name that exists in neither schema nor catalogue is the common case (typo, or a table
    // that only exists on the local side); say that instead of "no columns".
    if (!columns.length) throw new Error(`source table ${table} not found in ${cfg.schema || "public"}`);
    // Identifier quoting is per dialect: MySQL reads "id" as a *string literal*, so the
    // double-quoted list that is right for the local INSERT selected the column names as data
    // ("invalid input syntax for type bigint: \"id\"").
    const srcQuote = remote.kind === "mysql"
      ? (name) => `\`${name.replace(/`/g, "``")}\``
      : (name) => `"${name.replace(/"/g, '""')}"`;
    const dstQuote = (name) => `"${name.replace(/"/g, '""')}"`;
    const selectList = columns.map((c) => srcQuote(c.name)).join(", ");
    const insertList = columns.map((c) => dstQuote(c.name)).join(", ");

    await query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    // replace = "make the staging copy match the source", so the table is rebuilt rather than
    // truncated: a column whose type changed on the remote side keeps its old type otherwise,
    // and CREATE TABLE IF NOT EXISTS would never notice.
    if (mode === "replace") await query(`DROP TABLE IF EXISTS "${schema}"."${table}"`);
    await query(
      `CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (${columns
        .map((c) => `${dstQuote(c.name)} ${c.type}`)
        .join(", ")})`,
    );

    // Paging has to be *ordered* or the source's page boundaries move between queries and a
    // table being written concurrently loses and duplicates rows at the same time. A
    // single-column key paginates by keyset (no OFFSET rescan on a 600k-row table); anything
    // else falls back to ordered OFFSET.
    const pk = await remotePrimaryKey(remote, cfg, table);
    const keyColumn = pk.length === 1 ? pk[0] : null;
    const from = remote.kind === "mysql"
      ? srcQuote(table)
      : `${srcQuote(cfg.schema || "public")}.${srcQuote(table)}`;
    const orderAll = columns.map((_, i) => i + 1).join(", ");

    let copied = 0;
    let offset = 0;
    let lastKey = null;
    for (;;) {
      let sql = `SELECT ${selectList} FROM ${from}`;
      const params = [];
      if (keyColumn && lastKey !== null) {
        sql += remote.kind === "mysql"
          ? ` WHERE ${srcQuote(keyColumn)} > ?`
          : ` WHERE ${srcQuote(keyColumn)} > $${params.length + 1}`;
        params.push(lastKey);
      }
      sql += ` ORDER BY ${keyColumn ? srcQuote(keyColumn) : orderAll}`;
      if (remote.kind === "mysql") {
        sql += " LIMIT ?";
        params.push(batchSize);
        if (!keyColumn) {
          sql += " OFFSET ?";
          params.push(offset);
        }
      } else {
        sql += ` LIMIT $${params.length + 1}`;
        params.push(batchSize);
        if (!keyColumn) {
          sql += ` OFFSET $${params.length + 1}`;
          params.push(offset);
        }
      }
      const rows = remote.kind === "mysql"
        ? (await remote.conn.query(sql, params))[0]
        : (await remote.conn.query(sql, params)).rows;
      if (!rows.length) break;

      // Insert in chunks so the parameter list stays under PostgreSQL's 65535 limit.
      const chunk = Math.max(1, Math.floor(60000 / columns.length));
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        const values = [];
        const tuples = slice.map((row, r) => {
          columns.forEach((c, ci) => {
            const v = row[c.name] ?? null;
            // node-pg parses remote jsonb into JS values; its default prepareValue
            // turns a JS *array* into a Postgres array literal ({...}), which is not
            // valid JSON — every jsonb column holding a JSON array (flow_nodes,
            // locations, items…) died with "invalid input syntax for type json".
            // Serialize jsonb-bound values ourselves so objects AND arrays go over
            // as JSON text.
            values.push(v !== null && c.type === "jsonb" && typeof v !== "string" ? JSON.stringify(v) : v);
          });
          return `(${columns.map((_, ci) => `$${r * columns.length + ci + 1}`).join(", ")})`;
        });
        await query(
          `INSERT INTO "${schema}"."${table}" (${insertList}) VALUES ${tuples.join(", ")}`,
          values,
        );
      }
      copied += rows.length;
      if (keyColumn) lastKey = rows[rows.length - 1][keyColumn];
      else offset += rows.length;
      if (rows.length < batchSize) break;
    }
    return copied;
  });
}

async function runSync({ query, provider, runId, tables, mode, batchSize, getClient }) {
  const code = provider.code;
  const transient = TRANSIENT_PROVIDERS[code];
  try {
    let total = 0;
    for (const table of tables) {
      if (!IDENT_RE.test(table)) {
        await query(
          `INSERT INTO data_source_sync_table (run_id, table_name, target_schema, status, message)
           VALUES ($1, $2, $3, 'skipped', 'invalid table name')`,
          [runId, table, targetSchemaFor(code)],
        );
        continue;
      }
      const { rows: [rec] } = await query(
        `INSERT INTO data_source_sync_table (run_id, table_name, target_schema, status)
         VALUES ($1, $2, $3, 'running') RETURNING id`,
        [runId, table, targetSchemaFor(code)],
      );
      try {
        const copied = await copyTable({ query, provider, code, runId, table, mode, batchSize });
        total += copied;
        await query(
          `UPDATE data_source_sync_table SET status = 'done', rows_copied = $2, finished_at = now() WHERE id = $1`,
          [rec.id, copied],
        );
      } catch (err) {
        await query(
          `UPDATE data_source_sync_table SET status = 'failed', message = $2, finished_at = now() WHERE id = $1`,
          [rec.id, String(err.message).slice(0, 500)],
        );
      }
      await query(
        `UPDATE data_source_sync_run SET rows_copied = $2, tables_done = tables_done + 1 WHERE id = $1`,
        [runId, total],
      );
    }
    // Transient pipeline: the whole ext_<code> schema is now a faithful snapshot of
    // the source. Ingest it into the business tables (under the app.source_sync tx
    // so the 399 column-ownership triggers permit the writes), stamp provenance,
    // then DROP the duplicate — at rest SMT holds no copy of the source database.
    let ingested = 0;
    if (transient) {
      ingested = await withSourceSyncTx(getClient, async (q) => {
        const res = await backfillFromExt(q, transient.ext);
        await stampProvenance(q, transient.code);
        return Object.values(res).reduce((a, x) => a + (x.created || 0) + (x.updated || 0), 0);
      });
      // Drop only after a clean ingest; a failed ingest leaves the snapshot for retry.
      await query(`DROP SCHEMA IF EXISTS "${transient.ext}" CASCADE`);
    }
    await query(
      `UPDATE data_source_sync_run SET status = 'done', finished_at = now(), rows_copied = $2, message = $3 WHERE id = $1`,
      [runId, total, transient ? `transient: ingested ${ingested} rows into business tables, ext schema dropped` : null],
    );
  } catch (err) {
    await query(
      `UPDATE data_source_sync_run SET status = 'failed', finished_at = now(), message = $2 WHERE id = $1`,
      [runId, String(err.message).slice(0, 500)],
    );
  } finally {
    runningProviders.delete(provider.id);
  }
}

