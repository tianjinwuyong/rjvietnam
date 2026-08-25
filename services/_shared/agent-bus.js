/**
 * agent-bus.js — Shared inter-agent communication library
 *
 * All factory AI managers (MES, WMS, BOM, HR, RDA) use this module
 * to send and receive asynchronous messages via the PostgreSQL queue.
 *
 * Usage:
 *   import { sendAgentMessage, pollAgentMessages, completeAgentMessage,
 *            failAgentMessage, callAgentQuery, initAgentBus } from "../_shared/agent-bus.js";
 */

import pg from "pg";
import { spawn } from "child_process";
import { existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";

// ── Pool (lazy init) ─────────────────────────────────────────────────────────
let _pool;

export function getPool() {
  if (!_pool) {
    _pool = new pg.Pool({
      host:     process.env.PGHOST     ?? "127.0.0.1",
      port:     Number(process.env.PGPORT ?? 5432),
      user:     process.env.PGUSER     ?? "postgres",
      password: process.env.PGPASSWORD ?? "postgres",
      database: process.env.PGDATABASE ?? "smt_factory",
      max: 2,
    });
  }
  return _pool;
}

// ── Agent identity ────────────────────────────────────────────────────────────
// Each manager sets AGENT_ID env var. Defaults to "mes-ai" for MES manager.
export const AGENT_ID = process.env.AGENT_ID ?? "mes-ai";

// ── Message ID generator ──────────────────────────────────────────────────────
function genMessageId(prefix = "msg") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Logging ──────────────────────────────────────────────────────────────────
const LOG_FILE = process.env.AGENT_LOG ?? join(process.cwd(), "services/worker", `${AGENT_ID}.log`);

export function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] [${AGENT_ID}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + "\n"); } catch (_) {}
}

// ── Init: ensure queue table exists ─────────────────────────────────────────
export async function initAgentBus() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inter_agent_messages (
      id              BIGSERIAL PRIMARY KEY,
      message_id      VARCHAR(64)  NOT NULL UNIQUE,
      source_agent    VARCHAR(32) NOT NULL,
      target_agent    VARCHAR(32) NOT NULL,
      message_type    VARCHAR(32) NOT NULL,   -- request|response|event|broadcast
      subject         VARCHAR(128) NOT NULL,
      payload         JSONB       NOT NULL DEFAULT '{}',
      correlation_id  VARCHAR(64),              -- links response to original request
      priority       VARCHAR(16)  DEFAULT 'normal', -- critical|high|normal|low
      status         VARCHAR(16)  DEFAULT 'pending', -- pending|processing|completed|failed|dead
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      processed_at   TIMESTAMPTZ,
      expires_at     TIMESTAMPTZ,
      error_message  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_iam_target_status
      ON inter_agent_messages (target_agent, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_iam_source
      ON inter_agent_messages (source_agent, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_iam_subject
      ON inter_agent_messages (subject);
    CREATE INDEX IF NOT EXISTS idx_iam_priority
      ON inter_agent_messages (priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_iam_correlation
      ON inter_agent_messages (correlation_id);
  `);
  log("INFO", `agent-bus initialised (agent=${AGENT_ID})`);
}

// ── Send an async message to another agent via the DB queue ────────────────
/**
 * @param {string} targetAgent - 'wms-ai'|'bom-ai'|'hr-ai'|'rda-ai'|'worker'|'*'
 * @param {string} subject    - Message subject (e.g. 'material_issued')
 * @param {object} body       - Message payload
 * @param {object} [opts]
 * @param {string} [opts.priority='normal']   - critical|high|normal|low
 * @param {number} [opts.ttlSeconds=86400]    - Time-to-live in seconds (default 24h)
 * @param {string} [opts.correlationId]       - For response correlation
 * @param {string} [opts.messageType='event']  - request|response|event|broadcast
 * @returns {Promise<string>} message_id
 */
export async function sendAgentMessage(targetAgent, subject, body, opts = {}) {
  const pool = getPool();
  const messageId = genMessageId(AGENT_ID);
  const messageType = opts.correlationId ? "response" : (opts.messageType ?? "event");

  await pool.query(
    `INSERT INTO inter_agent_messages
       (message_id, source_agent, target_agent, message_type, subject, payload,
        priority, correlation_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
       CASE WHEN $9::int IS NOT NULL
            THEN NOW() + ($9::text || ' seconds')::interval
            ELSE NULL END)`,
    [
      messageId,
      AGENT_ID,
      targetAgent,
      messageType,
      subject,
      JSON.stringify(body),
      opts.priority ?? "normal",
      opts.correlationId ?? null,
      opts.ttlSeconds != null ? String(opts.ttlSeconds) : null,
    ]
  );

  log("INFO", `[SEND] ${targetAgent} :: ${subject} (id=${messageId})`);
  return messageId;
}

// ── Poll pending messages for this agent ────────────────────────────────────
/**
 * @param {string} [agentId] - defaults to AGENT_ID
 * @param {number} [limit=20]
 * @returns {Promise<Array>} messages (already marked status='processing')
 */
export async function pollAgentMessages(agentId = AGENT_ID, limit = 20) {
  const pool = getPool();

  const result = await pool.query(`
    SELECT * FROM inter_agent_messages
    WHERE target_agent IN ($1, '*')
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 0
        WHEN 'high'    THEN 1
        WHEN 'normal' THEN 2
        WHEN 'low'    THEN 3
      END,
      created_at ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  `, [agentId, limit]);

  if (result.rows.length > 0) {
    const ids = result.rows.map(r => r.id);
    await pool.query(
      `UPDATE inter_agent_messages SET status = 'processing'
       WHERE id = ANY($1::bigint[])`,
      [ids]
    );
  }

  return result.rows;
}

// ── Mark a message as completed ─────────────────────────────────────────────
/**
 * @param {string} messageId
 * @param {object} [responseData]
 */
export async function completeAgentMessage(messageId, responseData = null) {
  const pool = getPool();
  if (responseData) {
    await pool.query(
      `UPDATE inter_agent_messages
       SET status = 'completed', processed_at = NOW(),
           payload = payload || $2::jsonb
       WHERE message_id = $1`,
      [messageId, JSON.stringify({ _response: responseData })]
    );
  } else {
    await pool.query(
      `UPDATE inter_agent_messages
       SET status = 'completed', processed_at = NOW()
       WHERE message_id = $1`,
      [messageId]
    );
  }
}

// ── Mark a message as failed ────────────────────────────────────────────────
/**
 * @param {string} messageId
 * @param {string} errorMessage
 */
export async function failAgentMessage(messageId, errorMessage) {
  const pool = getPool();
  await pool.query(
    `UPDATE inter_agent_messages
     SET status = 'failed', processed_at = NOW(), error_message = $2
     WHERE message_id = $1`,
    [messageId, errorMessage]
  );
}

// ── Sync call to another agent's query script ───────────────────────────────
/**
 * @param {string} scriptPath - absolute path to the query script
 * @param {string} scope      - query scope
 * @param {object} [args]     - key-value CLI args
 * @returns {Promise<object>}  parsed JSON response { ok, data, error }
 */
export async function callAgentQuery(scriptPath, scope, args = {}) {
  const cmdArgs = [scriptPath, scope];
  for (const [key, value] of Object.entries(args)) {
    cmdArgs.push(`--${key}`, String(value));
  }

  return new Promise((resolve, reject) => {
    const child = spawn("node", cmdArgs, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) {
        reject(new Error(`[${scriptPath}] exit ${code}: ${err || out}`));
      } else {
        try { resolve(JSON.parse(out)); }
        catch { reject(new Error(`Invalid JSON from ${scriptPath}: ${out.slice(0, 200)}`)); }
      }
    });
  });
}

// ── Retry wrapper for agent calls ───────────────────────────────────────────
/**
 * Retry a callable up to maxRetries times with exponential back-off.
 * @param {Function} fn        - async () => result
 * @param {number} maxRetries
 * @param {number[]} delaysMs  - delays between attempts in ms [1st, 2nd, ...]
 * @returns {Promise}
 */
export async function callWithRetry(fn, maxRetries = 2, delaysMs = [1000, 5000]) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = delaysMs[attempt - 1] ?? delaysMs[delaysMs.length - 1];
        log("WARN", `[RETRY] attempt ${attempt + 1} failed: ${err.message}, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// ── Sync request → wait for response via correlation ID ─────────────────────
/**
 * Send a request and wait for the response (up to ttlSeconds).
 * Uses polling against the queue.
 *
 * @param {string} targetAgent
 * @param {string} subject
 * @param {object} body
 * @param {object} [opts]  - same as sendAgentMessage + extra pollIntervalMs, ttlSeconds
 * @returns {Promise<object>} response payload
 */
export async function requestAgentResponse(targetAgent, subject, body, opts = {}) {
  const correlationId = genMessageId("req");
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const ttlMs = (opts.ttlSeconds ?? 60) * 1000;
  const deadline = Date.now() + ttlMs;

  await sendAgentMessage(targetAgent, subject, body, { ...opts, correlationId });

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const pool = getPool();
    const result = await pool.query(`
      SELECT * FROM inter_agent_messages
      WHERE correlation_id = $1 AND status = 'completed'
      LIMIT 1
    `, [correlationId]);

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const response = row.payload?._response ?? row.payload;
      await completeAgentMessage(row.message_id); // clean up
      return response;
    }
  }

  throw new Error(`Agent response timeout: ${targetAgent} ${subject} (ttl=${opts.ttlSeconds}s)`);
}

// ── Broadcast to all agents ─────────────────────────────────────────────────
/**
 * @param {string} subject
 * @param {object} body
 * @param {object} [opts]
 */
export async function broadcastMessage(subject, body, opts = {}) {
  return sendAgentMessage("*", subject, body, { ...opts, messageType: "broadcast" });
}

// ── Queue health check ───────────────────────────────────────────────────────
/**
 * @returns {Promise<{pending: number, processing: number, dead: number, byAgent: object}>}
 */
export async function agentBusHealth() {
  const pool = getPool();
  const [counts, byAgent] = await Promise.all([
    pool.query(`
      SELECT status, COUNT(*)::int AS cnt
      FROM inter_agent_messages
      WHERE created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY status
    `),
    pool.query(`
      SELECT target_agent, COUNT(*)::int AS cnt
      FROM inter_agent_messages
      WHERE status = 'pending'
        AND created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY target_agent
      ORDER BY cnt DESC
    `),
  ]);

  const result = { pending: 0, processing: 0, dead: 0, byAgent: {} };
  for (const row of counts.rows) {
    if (row.status === "pending") result.pending = row.cnt;
    else if (row.status === "processing") result.processing = row.cnt;
    else if (row.status === "dead") result.dead = row.cnt;
  }
  for (const row of byAgent.rows) {
    result.byAgent[row.target_agent] = row.cnt;
  }
  return result;
}
