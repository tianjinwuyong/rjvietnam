// ── MES mirror worker: 155 (primary) → 122 (backup) — DIRECT DB COPY ────────
// Controlled server-side 155→122 database replication/backfill (数据库复制/回填)
// requested by the user. Makes 122 a complete mirror of 155.
//
// WHY DIRECT DB COPY (not API replay):
//   - ~604K accepted events are missing on 122; API replay would take hours
//     and 122's own business rules would REJECT some events (seen in the
//     forward direction: 4xx on out-of-context events), so replay can never
//     guarantee ng-guard convergence. Copying 155's final business state
//     guarantees the count converges exactly.
//   - No FK constraints exist on any ng-guard source table → SQL copy is safe.
//
// WHY THIS IDENTITY SCHEME (critical):
//   - event_id is SERVER-LOCAL: each server's middleware re-derives eventId
//     (body.eventId || payload.eventId || randomUUID()). It cannot dedup
//     across servers (only ~30% of production_events bridge to staging by
//     event_id, verified empirically). Copying by missing event_id would
//     duplicate nearly every event 122 already received.
//   - payload_hash = sha256(raw body at receipt) is computed IDENTICALLY on
//     both servers → the canonical cross-server identity for the ledger.
//   - The ng-guard count (the user's acceptance metric) is deduped BY SN
//     (server.js:4758-4795 rank-based bySn map). Missing SN-facts break it;
//     duplicate rows for an SN already flagged collapse. So the safe mirror
//     semantics are: insert a row only when the LOGICAL FACT it represents
//     (natural key) is absent on 122. Never overwrite 122's own data.
//
// PER-TABLE PRE-CHECK (logical fact presence on 122):
//   station_bucket_snapshots    (station_code, bucket_name)          upsert-newer
//   station_aging_control       (sn)                                 upsert-newer
//   station_sn_route_progress   (root_sn, station_code)              upsert-newer
//   ng_defect_records           (sn, station_code, defect_code)      backfill
//   station_product_residence   (sn, station_code, product_state)    backfill
//   station_production_events   (station_code, event_type, sn)       backfill
//   sn_journey_events           (sn, event_type, station_code)       backfill
//   station_data_staging        (payload_hash)                       backfill
//
// State: replication_watermark_155to122 + replication_health_155to122 live on
// 155 (source side), distinct from the 122→155 direction's tables.
//
// Run modes:
//   node replicate-155-to-122.cjs --once        # one bounded cycle
//   node replicate-155-to-122.cjs               # daemon loop (scheduled task)

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// SOURCE = local 155 (the primary; we mirror FROM it)
const SOURCE_DB = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'smt_factory',
  password: process.env.PGPASSWORD || 'smt_factory',
  database: process.env.PGDATABASE || 'smt_factory',
  connectionTimeoutMillis: 8000,
};

// DEST = remote 122 (the backup; we mirror INTO it)
const DEST_DB = {
  host: process.env.REPL_DEST_HOST || '192.168.6.122',
  port: Number(process.env.REPL_DEST_PORT || 5432),
  user: process.env.REPL_DEST_USER || 'smt_factory',
  password: process.env.REPL_DEST_PASSWORD || 'smt_factory',
  database: process.env.REPL_DEST_DATABASE || 'smt_factory',
  connectionTimeoutMillis: 8000,
};

const LOOP_MS = Number(process.env.REPL_LOOP_MS || 30000);
const MAX_CYCLE_MS = Number(process.env.REPL_MAX_CYCLE_MS || 25000);
const BATCH = Number(process.env.REPL_BATCH || 2000);

// precheck: logical-fact identity on 122.
//   Each entry is { expr, label, filter } — expr is the SQL expression (may be
//   a plain column or a payload extraction); label is the JS key; filter=true
//   means it participates in the WHERE ... = ANY($n) narrowing (needs an index
//   on 122 — created in preflight when not present).
const TABLE_SPECS = [
  {
    name: 'station_bucket_snapshots',
    columns: ['station_code', 'bucket_name', 'version', 'payload', 'updated_at'],
    cursorCol: null,
    precheck: [
      { expr: 'station_code', label: 'station_code', filter: true },
      { expr: 'bucket_name', label: 'bucket_name', filter: false },
    ],
    mode: 'upsert',
    conflict: ['station_code', 'bucket_name'],
    newerExpr: (t) => `${t}.version < EXCLUDED.version`,
    pkClause: 'station_code = EXCLUDED.station_code AND bucket_name = EXCLUDED.bucket_name',
  },
  {
    name: 'station_aging_control',
    columns: ['sn', 'batch_id', 'station_code', 'aging_started_at', 'aging_deadline_at', 'latest_result', 'status', 'ng_detected_at', 'completed_at', 'updated_at'],
    cursorCol: null,
    precheck: [{ expr: 'sn', label: 'sn', filter: true }],
    mode: 'upsert',
    conflict: ['sn'],
    newerExpr: (t) => `${t}.updated_at < EXCLUDED.updated_at`,
    pkClause: 'sn = EXCLUDED.sn',
  },
  {
    name: 'ng_defect_records',
    columns: ['occurred_at', 'line_name', 'station_code', 'sn', 'result', 'channel', 'error_code', 'defect_code', 'defect_desc', 'file', 'row', 'time', 'source', 'operator', 'created_at', 'repair_status'],
    cursorCol: 'id',
    precheck: [
      { expr: 'sn', label: 'sn', filter: true },
      { expr: 'station_code', label: 'station_code', filter: false },
      { expr: "COALESCE(defect_code,'')", label: 'defect_code', filter: false },
    ],
    mode: 'backfill',
  },
  {
    name: 'station_sn_route_progress',
    columns: ['root_sn', 'station_code', 'line_code', 'sequence_order', 'source_sn', 'status', 'result', 'source_event_id', 'completed_at', 'detail'],
    cursorCol: null,
    precheck: [
      { expr: 'root_sn', label: 'root_sn', filter: true },
      { expr: 'station_code', label: 'station_code', filter: false },
    ],
    mode: 'upsert',
    conflict: ['root_sn', 'station_code'],
    newerExpr: (t) => `${t}.completed_at < EXCLUDED.completed_at`,
    pkClause: 'root_sn = EXCLUDED.root_sn AND station_code = EXCLUDED.station_code',
  },
  {
    name: 'station_product_residence',
    columns: ['sn', 'batch_id', 'station_code', 'product_state', 'defect_code', 'is_ng', 'entered_at', 'last_seen_at', 'exited_at', 'duration_seconds', 'alarmed_at', 'status', 'next_station_code', 'next_residence_id'],
    cursorCol: 'residence_id',
    precheck: [
      { expr: 'sn', label: 'sn', filter: true },
      { expr: 'station_code', label: 'station_code', filter: false },
      { expr: 'product_state', label: 'product_state', filter: false },
    ],
    mode: 'backfill',
  },
  {
    name: 'station_production_events',
    columns: ['event_id', 'station_code', 'event_type', 'payload', 'received_at'],
    cursorCol: 'event_id',
    precheck: [
      { expr: 'station_code', label: 'station_code', filter: true },
      { expr: 'event_type', label: 'event_type', filter: true },
      { expr: "UPPER(TRIM(COALESCE(payload->>'sn','')))", label: 'sn', filter: false },
    ],
    mode: 'backfill',
    conflict: ['event_id'],
  },
  {
    name: 'sn_journey_events',
    columns: ['sn', 'batch_id', 'work_order_code', 'event_type', 'event_stage', 'station_code', 'station_name', 'result', 'defect_code', 'defect_description', 'operator', 'actor', 'detail', 'event_at', 'created_at'],
    cursorCol: 'journey_id',
    precheck: [
      { expr: 'sn', label: 'sn', filter: true },
      { expr: 'event_type', label: 'event_type', filter: false },
      { expr: "COALESCE(station_code,'')", label: 'station_code', filter: false },
    ],
    mode: 'backfill',
  },
  {
    name: 'station_data_staging',
    columns: ['event_id', 'station_code', 'source_type', 'source_ref', 'raw_payload', 'normalized_payload', 'payload_hash', 'status', 'received_at', 'processed_at', 'error_code', 'error_detail'],
    cursorCol: 'staging_id',
    precheck: [{ expr: 'payload_hash', label: 'payload_hash', filter: true }],
    mode: 'backfill',
    conflict: ['event_id'],
    statusFilter: `status IN ('CLEANED','PROJECTED')`,
    destIndex: 'CREATE INDEX IF NOT EXISTS station_data_staging_payload_hash_idx ON station_data_staging (payload_hash)',
  },
];

// Dest-side supporting indexes for precheck filter columns (avoid seq scans on
// the big business tables during backfill).
const DEST_INDEXES = [
  { table: 'station_production_events', cols: ['station_code', 'event_type'], name: 'repl_155to122_prod_evt_st_et_idx' },
  { table: 'sn_journey_events', cols: ['sn'], name: 'repl_155to122_journey_sn_idx' },
  { table: 'ng_defect_records', cols: ['sn'], name: 'repl_155to122_defect_sn_idx' },
  { table: 'station_product_residence', cols: ['sn'], name: 'repl_155to122_residence_sn_idx' },
  { table: 'station_sn_route_progress', cols: ['root_sn'], name: 'repl_155to122_route_root_sn_idx' },
  // station_aging_control (PK sn) and station_bucket_snapshots (PK
  // station_code,bucket_name) already have their natural indexes — skip.
];

function nowIso() { return new Date().toISOString(); }
function log(msg) {
  const line = `[${nowIso()}] ${msg}`;
  console.log(line);
  process.stdout.write('');
  try { fs.appendFileSync(path.join(__dirname, 'replication-155to122.log'), line + '\n', 'utf8'); } catch (_) {}
}

let src = null;
let dst = null;
const cumulative = {};
for (const spec of TABLE_SPECS) {
  cumulative[spec.name] = { scanned: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
}

async function ensureSourceState(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS replication_watermark_155to122(
    id smallint PRIMARY KEY DEFAULT 1,
    last_staging_id bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT NOW())`);
  await client.query(`INSERT INTO replication_watermark_155to122(id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await client.query(`CREATE TABLE IF NOT EXISTS replication_health_155to122(
    id smallint PRIMARY KEY DEFAULT 1,
    last_run_at timestamptz, last_success_at timestamptz, last_error text,
    watermark bigint NOT NULL DEFAULT 0,
    tables jsonb NOT NULL DEFAULT '{}'::jsonb,
    backup_reachable boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT NOW())`);
  await client.query(`INSERT INTO replication_health_155to122(id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await client.query(`ALTER TABLE replication_health_155to122 ADD COLUMN IF NOT EXISTS tables jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE replication_health_155to122 ADD COLUMN IF NOT EXISTS last_error text`);
  await client.query(`ALTER TABLE replication_health_155to122 ADD COLUMN IF NOT EXISTS backup_reachable boolean NOT NULL DEFAULT false`);
}

async function ensureDestIndexes(client) {
  for (const ix of DEST_INDEXES) {
    await client.query(`CREATE INDEX IF NOT EXISTS ${ix.name} ON ${ix.table} (${ix.cols.join(', ')})`);
  }
  for (const spec of TABLE_SPECS) {
    if (spec.destIndex) await client.query(spec.destIndex);
  }
}

async function updateHealth(client, patch) {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const vals = cols.map((c) => patch[c]);
  await client.query(`UPDATE replication_health_155to122 SET ${sets}, updated_at = NOW() WHERE id = 1`, vals);
}

// Read a page of source rows past a cursor. cursorCol is always selected (for
// pagination) even when it is not part of the insert columns (server-local
// serial ids are excluded from INSERT so 122's sequences assign fresh values).
async function fetchBatch(spec, afterCursor) {
  const cols = [...spec.columns];
  if (spec.cursorCol && !cols.includes(spec.cursorCol)) cols.push(spec.cursorCol);
  const select = cols.join(', ');
  let sql;
  let params;
  if (spec.cursorCol === null) {
    sql = `SELECT ${select} FROM ${spec.name}`;
    params = [];
  } else {
    const filter = spec.statusFilter ? ` AND ${spec.statusFilter}` : '';
    sql = `SELECT ${select} FROM ${spec.name} WHERE ${spec.cursorCol} > $1${filter} ORDER BY ${spec.cursorCol} LIMIT $2`;
    params = [afterCursor, BATCH];
    // For text-based cursor columns (UUID/varchar), ensure empty string is
    // handled: NULL compare in Postgres always succeeds, so start at '0' for
    // text-type cursors as a safe lower bound.
    if (typeof afterCursor === 'string' && afterCursor === '' && spec.cursorCol !== 'event_id') {
      params[0] = '0';
    }
  }
  const r = await src.query(sql, params);
  return r.rows;
}

// Which logical facts already exist on 122? Returns a Set of '|'-joined keys.
async function existingKeys(spec, rows) {
  const pre = spec.precheck;
  if (!pre || !rows.length) return new Set();
  const filterCols = pre.filter((p) => p.filter);
  const where = [];
  const params = [];
  for (const p of filterCols) {
    const vals = [...new Set(rows.map((r) => String(r[p.label] ?? '')))];
    if (!vals.length) continue;
    const idx = params.length + 1;
    where.push(`${p.expr} = ANY($${idx}::text[])`);
    params.push(vals);
  }
  if (!where.length) return new Set();
  const sel = pre.map((p) => `${p.expr} AS "${p.label}"`).join(', ');
  const r = await dst.query(
    `SELECT ${sel} FROM ${spec.name} WHERE ${where.join(' AND ')}`,
    params);
  return new Set(r.rows.map((x) => pre.map((p) => String(x[p.label] ?? '')).join('|')));
}

function serialize(v) {
  if (v instanceof Date) return v;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

// Insert / upsert a page into 122.
async function copyBatch(spec, rows) {
  const stat = cumulative[spec.name];
  const existing = await existingKeys(spec, rows);
  const toInsert = [];
  for (const row of rows) {
    const key = spec.precheck.map((p) => String(row[p.label] ?? '')).join('|');
    if (spec.precheck && existing.has(key)) { stat.skipped += 1; continue; }
    toInsert.push(row);
  }
  if (!toInsert.length) return;
  const { columns } = spec;
  const placeholders = toInsert.map((_, i) =>
    `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`).join(', ');
  const flat = toInsert.flatMap((row) => columns.map((c) => serialize(row[c])));
  let sql = `INSERT INTO ${spec.name} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${placeholders}`;
  if (spec.mode === 'upsert' && spec.conflict && spec.pkClause) {
    const setCols = spec.columns
      .filter((c) => !spec.precheck.some((p) => p.label === c))
      .map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
    sql += ` ON CONFLICT (${spec.conflict.map((c) => `"${c}"`).join(', ')}) DO UPDATE SET ${setCols}
             WHERE ${spec.newerExpr(spec.name)}`;
  } else if (spec.conflict) {
    sql += ` ON CONFLICT (${spec.conflict.map((c) => `"${c}"`).join(', ')}) DO NOTHING`;
  }
  const r = await dst.query(sql, flat);
  stat.inserted += toInsert.length;
  if (spec.mode === 'upsert' && r.rowCount !== null) {
    stat.updated += Math.max(0, r.rowCount - toInsert.length);
  }
}

// Text cursors start at '' (event_id UUIDs); numeric cursors at 0 (bigint PKs).
const NUMERIC_CURSOR_TABLES = new Set([
  'ng_defect_records', 'station_product_residence', 'sn_journey_events', 'station_data_staging',
]);

async function syncTable(spec) {
  const stat = cumulative[spec.name];
  const deadline = Date.now() + MAX_CYCLE_MS;
  let cursor = NUMERIC_CURSOR_TABLES.has(spec.name) ? '0' : '';
  try {
    for (;;) {
      let rows;
      try {
        rows = await fetchBatch(spec, cursor);
      } catch (e) {
        stat.errors += 1;
        log(`✗ ${spec.name} fetch: ${e.message}`);
        return;
      }
      if (!rows.length) break;
      stat.scanned += rows.length;
      try {
        await copyBatch(spec, rows);
      } catch (e) {
        stat.errors += 1;
        log(`✗ ${spec.name} copy batch: ${e.message}`);
        return;
      }
      if (spec.cursorCol === null) break; // small table fully read in one shot
      cursor = String(rows[rows.length - 1][spec.cursorCol]);
      if (Date.now() > deadline) { log(`  ${spec.name}: time budget hit (cursor=${spec.cursorCol}=${cursor})`); break; }
    }
  } catch (e) {
    stat.errors += 1;
    log(`✗ ${spec.name}: ${e.message}`);
  }
}

async function runCycle(timeBudgetMs) {
  const started = new Date();
  for (const spec of TABLE_SPECS) await syncTable(spec);
  const health = {};
  for (const spec of TABLE_SPECS) health[spec.name] = { ...cumulative[spec.name] };
  await updateHealth(src, {
    last_run_at: started,
    last_success_at: new Date(),
    last_error: null,
    tables: JSON.stringify(health),
    backup_reachable: true,
  });
}

function totalsLine() {
  return TABLE_SPECS
    .map((s) => `${s.name}=i${cumulative[s.name].inserted}/u${cumulative[s.name].updated}/s${cumulative[s.name].skipped}${cumulative[s.name].errors ? '/E' + cumulative[s.name].errors : ''}`)
    .join(' ');
}

async function main() {
  src = new Client(SOURCE_DB);
  dst = new Client(DEST_DB);
  await src.connect();
  await ensureSourceState(src);

  if (process.argv.includes('--once')) {
    try {
      await dst.connect();
      await ensureDestIndexes(dst);
    } catch (e) {
      log(`✗ dest unreachable: ${e.message}`);
      await updateHealth(src, { last_run_at: new Date(), last_error: `dest unreachable: ${e.message}`, backup_reachable: false });
      process.exitCode = 1;
      await src.end();
      return;
    }
    await runCycle(Number(MAX_CYCLE_MS));
    log(`cycle done: ${totalsLine()}`);
    await dst.end();
    await src.end();
    return;
  }

  log(`mirror worker started (daemon, loop=${LOOP_MS}ms, batch=${BATCH}, maxCycle=${MAX_CYCLE_MS}ms)`);
  let first = true;
  for (;;) {
    try {
      if (first) { await dst.connect(); await ensureDestIndexes(dst); first = false; }
      else { await dst.query('SELECT 1'); }
      await runCycle(Number(MAX_CYCLE_MS));
      log(`cycle: ${totalsLine()}`);
    } catch (e) {
      log(`✗ cycle error: ${e.message}`);
      await updateHealth(src, { last_error: e.message, backup_reachable: false }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
}

main().catch((e) => { log(`FATAL: ${e.stack || e.message}`); process.exit(1); });