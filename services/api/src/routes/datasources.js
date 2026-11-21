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
import pg from "pg";

export function registerDatasourceRoutes(app, deps) {
  const { query, requirePermission, errorEnvelope, listEnvelope, mutateEnvelope } = deps;

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
      void runSync({ query, provider, runId: run.id, tables: wanted, mode, batchSize });
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
  if (/^timestamp/.test(t)) return "timestamptz";
  if (/^date$/.test(t)) return "date";
  if (/^time$/.test(t)) return "time";
  if (/^json/.test(t)) return "jsonb";
  if (kind === "mysql" && /^(tinyint\(1\)|mediumint|year)/.test(t)) return "bigint";
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

/** Copy one remote table into `ext_<code>` on this database. */
async function copyTable({ query, provider, code, runId, table, mode, batchSize }) {
  const schema = targetSchemaFor(code);
  const cfg = provider.config || {};
  return withRemote(provider, async (remote) => {
    const columns = await remoteColumns(remote, cfg, table);
    // A name that exists in neither schema nor catalogue is the common case (typo, or a table
    // that only exists on the local side); say that instead of "no columns".
    if (!columns.length) throw new Error(`source table ${table} not found in ${cfg.schema || "public"}`);
    const colList = columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(", ");

    await query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await query(
      `CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (${columns
        .map((c) => `"${c.name.replace(/"/g, '""')}" ${c.type}`)
        .join(", ")})`,
    );
    if (mode === "replace") await query(`TRUNCATE "${schema}"."${table}"`);

    let copied = 0;
    let offset = 0;
    for (;;) {
      let rows;
      if (remote.kind === "mysql") {
        const [r] = await remote.conn.query(
          `SELECT ${colList} FROM \`${table}\` LIMIT ? OFFSET ?`,
          [batchSize, offset],
        );
        rows = r;
      } else {
        const r = await remote.conn.query(
          `SELECT ${colList} FROM "${cfg.schema || "public"}"."${table}" LIMIT $1 OFFSET $2`,
          [batchSize, offset],
        );
        rows = r.rows;
      }
      if (!rows.length) break;

      // Insert in chunks so the parameter list stays under PostgreSQL's 65535 limit.
      const chunk = Math.max(1, Math.floor(60000 / columns.length));
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        const values = [];
        const tuples = slice.map((row, r) => {
          columns.forEach((c, ci) => values.push(row[c.name] ?? null));
          return `(${columns.map((_, ci) => `$${r * columns.length + ci + 1}`).join(", ")})`;
        });
        await query(
          `INSERT INTO "${schema}"."${table}" (${colList}) VALUES ${tuples.join(", ")}`,
          values,
        );
      }
      copied += rows.length;
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
    return copied;
  });
}

async function runSync({ query, provider, runId, tables, mode, batchSize }) {
  const code = provider.code;
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
    await query(
      `UPDATE data_source_sync_run SET status = 'done', finished_at = now(), rows_copied = $2 WHERE id = $1`,
      [runId, total],
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

