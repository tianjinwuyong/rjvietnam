// ── MES replication worker: 122 (backup) → 155 (primary) ─────────────────────
// Pulls events from 192.168.6.122's station_data_staging ledger that the
// primary (this host, 155) does not yet have, and replays them through the
// primary's own /api/pda/events pipeline so every business projection runs
// exactly once on 155.
//
// Why event replay through the API (not row copy):
//   - station_data_staging is only the durable ledger; business tables
//     (ng_defect_records, station_production_events, alarms, …) are written by
//     the API route handlers. Copying ledger rows alone would miss projections.
//   - Re-POSTing the original raw_payload with its eventId makes the insert
//     idempotent (ON CONFLICT(event_id) DO NOTHING) and re-runs projections
//     for exactly the events 155 is missing.
//
// Idempotency: watermark advances per scanned batch; existence checks skip
// events already present on 155. Events 155 rejects (4xx) are durably recorded
// in 155's staging as FAILED by the API's finish hook and the watermark still
// advances — 155 is authoritative for its own accept/reject decisions.

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const BACKUP_DB = {
  host: process.env.REPL_BACKUP_HOST || '192.168.6.122',
  port: Number(process.env.REPL_BACKUP_PORT || 5432),
  user: process.env.REPL_BACKUP_USER || 'smt_factory',
  password: process.env.REPL_BACKUP_PASSWORD || 'smt_factory',
  database: process.env.REPL_BACKUP_DATABASE || 'smt_factory',
  connectionTimeoutMillis: 8000,
};

const PRIMARY_DB = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'smt_factory',
  password: process.env.PGPASSWORD || 'smt_factory',
  database: process.env.PGDATABASE || 'smt_factory',
  connectionTimeoutMillis: 8000,
};

const TARGET_API = process.env.REPL_TARGET_API || 'http://127.0.0.1:8080';
const INGEST_PATH = '/api/pda/events';
const BATCH_SIZE = Number(process.env.REPL_BATCH || 2000);
const LOOP_MS = Number(process.env.REPL_LOOP_MS || 30000);
const MAX_CYCLE_MS = Number(process.env.REPL_MAX_CYCLE_MS || 25000);
const PAGE_GAP_MS = Number(process.env.REPL_PAGE_GAP_MS || 400); // only after batches that hit the API
const START_AT = process.env.REPL_START_AT || '0'; // '0' | 'max' | <staging_id>

const BACKUP_ONLY_STATUSES = ['CLEANED', 'PROJECTED'];

function nowIso() { return new Date().toISOString(); }
function log(msg) {
  const line = `[${nowIso()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(__dirname, 'replication.log'), line + '\n', 'utf8');
  } catch (_) { /* logging must never crash the worker */ }
}

let primaryClient = null;
let backupClient = null;
// Cumulative counters persisted in replication_health across cycles
const cumulative = { scanned: 0, replayed: 0, skippedExisting: 0, rejected: 0 };

async function ensurePrimaryState(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS replication_watermark(
    id smallint PRIMARY KEY DEFAULT 1,
    last_staging_id bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT NOW())`);
  await client.query(`INSERT INTO replication_watermark(id) VALUES (1)
    ON CONFLICT (id) DO NOTHING`);
  await client.query(`CREATE TABLE IF NOT EXISTS replication_health(
    id smallint PRIMARY KEY DEFAULT 1,
    last_run_at timestamptz,
    last_success_at timestamptz,
    last_error text,
    watermark bigint NOT NULL DEFAULT 0,
    scanned bigint NOT NULL DEFAULT 0,
    replayed bigint NOT NULL DEFAULT 0,
    skipped_existing bigint NOT NULL DEFAULT 0,
    rejected bigint NOT NULL DEFAULT 0,
    backup_reachable boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT NOW())`);
  await client.query(`INSERT INTO replication_health(id) VALUES (1)
    ON CONFLICT (id) DO NOTHING`);
  // Schema drift: tables may have been created by an older worker version.
  await client.query(`ALTER TABLE replication_health ADD COLUMN IF NOT EXISTS backup_reachable boolean NOT NULL DEFAULT false`);
  await client.query(`ALTER TABLE replication_health ADD COLUMN IF NOT EXISTS last_error text`);
}

async function ensureBackupIndex(client) {
  // (status, staging_id) supports the batched watermark scan with an index
  await client.query(`CREATE INDEX IF NOT EXISTS station_data_staging_status_id_idx
    ON station_data_staging (status, staging_id)`);
}

async function seedWatermark(primary, backup) {
  if (START_AT === 'max') {
    const r = await backup.query(`SELECT COALESCE(max(staging_id), 0)::bigint AS m FROM station_data_staging`);
    await primary.query(`UPDATE replication_watermark SET last_staging_id = $1 WHERE id = 1`, [r.rows[0].m]);
    log(`watermark seeded to max backup staging_id=${r.rows[0].m}`);
  } else if (/^\d+$/.test(START_AT) && Number(START_AT) > 0) {
    await primary.query(`UPDATE replication_watermark SET last_staging_id = $1 WHERE id = 1`, [Number(START_AT)]);
    log(`watermark seeded to ${START_AT}`);
  }
}

async function readWatermark(client) {
  const r = await client.query(`SELECT last_staging_id FROM replication_watermark WHERE id = 1`);
  return r.rows[0]?.last_staging_id || 0;
}

async function writeWatermark(client, lastStagingId) {
  await client.query(`UPDATE replication_watermark SET last_staging_id = $1, updated_at = NOW() WHERE id = 1`,
    [lastStagingId]);
}

async function updateHealth(client, patch) {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const vals = cols.map((c) => patch[c]);
  await client.query(`UPDATE replication_health SET ${sets}, updated_at = NOW() WHERE id = 1`, vals);
}

async function fetchBackupBatch(client, afterId) {
  const r = await client.query(
    `SELECT staging_id, event_id, station_code, raw_payload
       FROM station_data_staging
      WHERE staging_id > $1 AND status = ANY($2::text[])
      ORDER BY staging_id
      LIMIT $3`,
    [afterId, BACKUP_ONLY_STATUSES, BATCH_SIZE]);
  return r.rows;
}

async function existingEventIds(primary, eventIds) {
  if (!eventIds.length) return new Set();
  const r = await primary.query(
    `SELECT event_id FROM station_data_staging WHERE event_id = ANY($1::text[])`,
    [eventIds]);
  return new Set(r.rows.map((x) => x.event_id));
}

async function replayOne(row) {
  const body = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : row.raw_payload;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${TARGET_API}${INGEST_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function runOnce(primary, backup, timeBudgetMs) {
  const started = new Date();
  const watermark = await readWatermark(primary);
  const cycle = { scanned: 0, replayed: 0, skippedExisting: 0, rejected: 0, error: null, timedOut: false };
  let cursor = watermark;
  const deadline = Date.now() + timeBudgetMs;

  try {
    let batch = await fetchBackupBatch(backup, cursor);

    while (batch.length) {
      cycle.scanned += batch.length;
      cumulative.scanned += batch.length;
      const eventIds = batch.map((r) => r.event_id);
      const existing = await existingEventIds(primary, eventIds);
      let hitApi = false;

      for (const row of batch) {
        if (existing.has(row.event_id)) { cycle.skippedExisting += 1; cumulative.skippedExisting += 1; continue; }
        let res;
        try {
          res = await replayOne(row);
          hitApi = true;
        } catch (fetchErr) {
          // Network/abort — 155 unreachable. Do NOT advance past this row.
          cycle.error = `fetch failed at staging_id=${row.staging_id}: ${fetchErr.message}`;
          log(`⚠  ${cycle.error}`);
          await writeWatermark(primary, cursor); // rows before cursor are safe
          return cycle;
        }
        if (res.ok) { cycle.replayed += 1; cumulative.replayed += 1; }
        else {
          if (res.status >= 500) {
            cycle.error = `HTTP ${res.status} at staging_id=${row.staging_id} (retry next loop)`;
            log(`⚠  ${cycle.error}`);
            await writeWatermark(primary, cursor);
            return cycle;
          }
          cycle.rejected += 1; cumulative.rejected += 1; // 4xx: 155 authoritative
        }
      }

      cursor = batch[batch.length - 1].staging_id;
      await writeWatermark(primary, cursor);

      if (Date.now() > deadline) { cycle.timedOut = true; break; }
      batch = await fetchBackupBatch(backup, cursor);
      if (batch.length && hitApi) await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
    }
  } catch (err) {
    cycle.error = `loop error: ${err.message}`;
    log(`⚠  ${cycle.error}`);
  }

  await updateHealth(primary, {
    last_run_at: started,
    last_success_at: cycle.error ? null : new Date(),
    last_error: cycle.error,
    watermark: cursor ?? watermark,
    scanned: cumulative.scanned,
    replayed: cumulative.replayed,
    skipped_existing: cumulative.skippedExisting,
    rejected: cumulative.rejected,
    backup_reachable: true,
  });
  return cycle;
}

async function main() {
  primaryClient = new Client(PRIMARY_DB);
  backupClient = new Client(BACKUP_DB);
  await primaryClient.connect();
  await ensurePrimaryState(primaryClient);

  // ── one-shot mode: run a single cycle and exit ──────────────────────────
  if (process.argv.includes('--once')) {
    try {
      await backupClient.connect();
      await ensureBackupIndex(backupClient);
      await seedWatermark(primaryClient, backupClient);
    } catch (e) {
      log(`⚠ backup unreachable: ${e.message}`);
      await updateHealth(primaryClient, {
        last_run_at: new Date(), last_error: `backup unreachable: ${e.message}`, backup_reachable: false,
      });
      process.exitCode = 1;
      await primaryClient.end();
      return;
    }
    const cycle = await runOnce(primaryClient, backupClient, Number(MAX_CYCLE_MS));
    log(`cycle done scanned=${cycle.scanned} replayed=${cycle.replayed} skipped=${cycle.skippedExisting} rejected=${cycle.rejected}${cycle.error ? ' error=' + cycle.error : ''}${cycle.timedOut ? ' (time budget hit)' : ''}`);
    await backupClient.end();
    await primaryClient.end();
    return;
  }

  // ── daemon mode: loop forever ───────────────────────────────────────────
  log(`replication worker started (daemon, loop=${LOOP_MS}ms, batch=${BATCH_SIZE}, maxCycle=${MAX_CYCLE_MS}ms)`);
  let first = true;
  for (;;) {
    let backupOk = false;
    try {
      if (first) {
        await backupClient.connect();
        await ensureBackupIndex(backupClient);
        await seedWatermark(primaryClient, backupClient);
        first = false;
      } else {
        await backupClient.query('SELECT 1');
      }
      backupOk = true;
    } catch (e) {
      backupOk = false;
      log(`⚠ backup unreachable, will retry in ${LOOP_MS}ms: ${e.message}`);
      await updateHealth(primaryClient, {
        last_run_at: new Date(), last_error: `backup unreachable: ${e.message}`, backup_reachable: false,
      }).catch(() => {});
    }
    if (backupOk) {
      try {
        const cycle = await runOnce(primaryClient, backupClient, MAX_CYCLE_MS);
        if (cycle.scanned || cycle.replayed || cycle.rejected || cycle.error)
          log(`cycle scanned=${cycle.scanned} replayed=${cycle.replayed} skipped=${cycle.skippedExisting} rejected=${cycle.rejected}${cycle.error ? ' error=' + cycle.error : ''}${cycle.timedOut ? ' (time budget hit)' : ''}`);
      } catch (e) { log(`⚠ cycle error: ${e.message}`); }
    }
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
}

main().catch((e) => { log(`FATAL: ${e.stack || e.message}`); process.exit(1); });