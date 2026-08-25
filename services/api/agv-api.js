/**
 * agv-api.js — AGV Fleet REST API Server
 *
 * Provides HTTP endpoints for AGV devices to communicate with MES.
 * AGV devices poll for commands; MES enqueues commands via DB.
 *
 * Usage:
 *   node agv-api.js                    # production
 *   node agv-api.js --dev              # dev with verbose logging
 *
 * Port: AGV_API_PORT (default 8081)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const app = express();

// ── Config ──────────────────────────────────────────────────────────────────
const PORT        = Number(process.env.AGV_API_PORT ?? 8081);
const JWT_SECRET  = process.env.JWT_SECRET ?? 'smt-factory-secret-2026';
const JWT_EXPIRY  = process.env.JWT_EXPIRY ?? '24h';
const PGHOST      = process.env.PGHOST ?? '127.0.0.1';
const PGPORT      = Number(process.env.PGPORT ?? 5432);
const PGUSER      = process.env.PGUSER ?? 'postgres';
const PGPASSWORD  = process.env.PGPASSWORD ?? 'postgres';
const PGDATABASE  = process.env.PGDATABASE ?? 'smt_factory';

const pgPool = new Pool({ host: PGHOST, port: PGPORT, user: PGUSER, password: PGPASSWORD, database: PGDATABASE, max: 5 });

const DEV = process.argv.includes('--dev');
const log = (level, msg, meta = {}) => {
  if (DEV || level === 'ERROR') console.log(`[${new Date().toISOString()}] [${level}] ${msg}`, Object.keys(meta).length ? meta : '');
};

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Request logger
app.use((req, _res, next) => {
  if (DEV) log('INFO', `${req.method} ${req.path}`);
  next();
});

// ── Auth ─────────────────────────────────────────────────────────────────────
// AGV device auth: POST /auth/token { device_code, device_secret }
// Returns JWT that AGV includes as Authorization: Bearer <token>

const AGV_DEVICE_SECRET = process.env.AGV_DEVICE_SECRET ?? 'agv-device-secret-2026';

app.post('/auth/token', async (req, res) => {
  const { device_code, device_secret } = req.body ?? {};
  if (!device_code || !device_secret) {
    return res.status(400).json({ error: 'device_code and device_secret required' });
  }
  if (device_secret !== AGV_DEVICE_SECRET) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  // Verify device exists in fleet
  const fleet = await pgPool.query('SELECT id, code, agv_type FROM agv_fleet WHERE code = $1', [device_code]);
  if (!fleet.rows.length) return res.status(404).json({ error: 'device not found' });

  const token = jwt.sign(
    { sub: device_code, type: 'agv-device', agv_id: fleet.rows[0].id, agv_type: fleet.rows[0].agv_type },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
  log('INFO', `Token issued for ${device_code}`);
  res.json({ token, expires_in: JWT_EXPIRY });
});

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAgvAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.agv = jwt.verify(token, JWT_SECRET);
    if (req.agv.type !== 'agv-device') throw new Error('not an AGV device');
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token' });
  }
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'agv-api', port: PORT, ts: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// AGV Device Endpoints (AGV → MES)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /agv/heartbeat
 * AGV sends periodic alive signal. Updates last_heartbeat_at in fleet table.
 * Body: { battery_pct, x_coord, y_coord, heading, speed_mps, status, zone_code }
 */
app.post('/agv/heartbeat', requireAgvAuth, async (req, res) => {
  const { battery_pct, x_coord, y_coord, heading, speed_mps, status, zone_code } = req.body ?? {};
  const agvCode = req.agv.sub;

  try {
    // Resolve zone_id if zone_code provided
    let zoneId = null;
    if (zone_code) {
      const zone = await pgPool.query('SELECT id FROM agv_zones WHERE code = $1', [zone_code]);
      zoneId = zone.rows[0]?.id ?? null;
    }

    await pgPool.query(`
      UPDATE agv_fleet
      SET battery_pct = COALESCE($1, battery_pct),
          x_coord     = COALESCE($2, x_coord),
          y_coord     = COALESCE($3, y_coord),
          heading     = COALESCE($4, heading),
          speed_mps   = COALESCE($5, speed_mps),
          status      = COALESCE($6, status),
          current_zone_id = COALESCE($7, current_zone_id),
          last_heartbeat_at = NOW(),
          updated_at   = NOW()
      WHERE code = $8
    `, [battery_pct, x_coord, y_coord, heading, speed_mps, status, zoneId, agvCode]);

    res.json({ ok: true, received_at: new Date().toISOString() });
  } catch (err) {
    log('ERROR', `heartbeat failed for ${agvCode}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /agv/status
 * AGV reports detailed status. Updates fleet + logs to agv_positions.
 * Body: { battery_pct, x_coord, y_coord, heading, speed_mps, status, zone_code, task_id, load_kg }
 */
app.post('/agv/status', requireAgvAuth, async (req, res) => {
  const { battery_pct, x_coord, y_coord, heading, speed_mps, status, zone_code, task_id, load_kg } = req.body ?? {};
  const agvCode = req.agv.sub;
  const agvId = req.agv.agv_id;

  try {
    let zoneId = null;
    if (zone_code) {
      const zone = await pgPool.query('SELECT id FROM agv_zones WHERE code = $1', [zone_code]);
      zoneId = zone.rows[0]?.id ?? null;
    }

    // Update fleet
    await pgPool.query(`
      UPDATE agv_fleet SET
        battery_pct       = COALESCE($1, battery_pct),
        x_coord           = COALESCE($2, x_coord),
        y_coord           = COALESCE($3, y_coord),
        heading           = COALESCE($4, heading),
        speed_mps         = COALESCE($5, speed_mps),
        status            = COALESCE($6, status),
        current_zone_id   = COALESCE($7, current_zone_id),
        current_task_id   = COALESCE($8, current_task_id),
        last_heartbeat_at = NOW(),
        updated_at        = NOW()
      WHERE code = $9
    `, [battery_pct, x_coord, y_coord, heading, speed_mps, status, zoneId, task_id, agvCode]);

    // Log position
    await pgPool.query(`
      INSERT INTO agv_positions (agv_id, agv_code, zone_id, zone_code, x_coord, y_coord, heading, speed_mps, battery_pct, task_id, occurred_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [agvId, agvCode, zoneId, zone_code, x_coord ?? 0, y_coord ?? 0, heading ?? 0, speed_mps ?? 0, battery_pct ?? 0, task_id ?? null]);

    res.json({ ok: true, logged_at: new Date().toISOString() });
  } catch (err) {
    log('ERROR', `status update failed for ${agvCode}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /agv/task-event
 * AGV reports task lifecycle events.
 * Body: { event_type, task_id, task_code, x_coord, y_coord, zone_code, message }
 * event_type: arrived | docked | departed | completed | failed | stuck | cancelled
 */
app.post('/agv/task-event', requireAgvAuth, async (req, res) => {
  const { event_type, task_id, task_code, x_coord, y_coord, zone_code, message } = req.body ?? {};
  const agvCode = req.agv.sub;
  const agvId = req.agv.agv_id;

  if (!event_type) return res.status(400).json({ error: 'event_type required' });

  try {
    const validEvents = ['arrived', 'docked', 'departed', 'completed', 'failed', 'stuck', 'cancelled'];
    if (!validEvents.includes(event_type)) {
      return res.status(400).json({ error: `invalid event_type: ${event_type}` });
    }

    // Update task status based on event
    const taskStatusMap = {
      arrived:    'en_route',
      docked:     'in_progress',
      departed:   'en_route',
      completed:  'completed',
      failed:     'failed',
      stuck:      'in_progress',
      cancelled:  'cancelled',
    };

    if (task_id && taskStatusMap[event_type]) {
      const completedAt = ['completed', 'failed', 'cancelled'].includes(event_type) ? 'NOW()' : 'NULL';
      await pgPool.query(`
        UPDATE agv_tasks SET
          status = $1,
          started_at = CASE WHEN $1 = 'in_progress' AND started_at IS NULL THEN NOW() ELSE started_at END,
          completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
          updated_at = NOW()
        WHERE id = $2
      `, [taskStatusMap[event_type], task_id]);
    }

    // If stuck, create alert
    if (event_type === 'stuck') {
      await pgPool.query(`
        INSERT INTO agv_alerts (agv_id, agv_code, alert_type, severity, message)
        VALUES ($1, $2, 'stuck', 'critical', $3)
      `, [agvId, agvCode, message ?? `AGV ${agvCode} reported stuck at zone ${zone_code}`]);
    }

    // Create audit entry
    await pgPool.query(`
      INSERT INTO agv_command_queue (agv_code, command_type, payload, status, priority)
      VALUES ($1, $2, $3::jsonb, 'completed', 1)
    `, [agvCode, `task_event_${event_type}`, JSON.stringify({ task_id, task_code, event_type, x_coord, y_coord, zone_code, message })]);

    log('INFO', `task-event from ${agvCode}: ${event_type} task=${task_code ?? task_id}`);
    res.json({ ok: true, event: event_type, ts: new Date().toISOString() });
  } catch (err) {
    log('ERROR', `task-event failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /agv/alert
 * AGV reports an alert (low battery, obstacle, collision, etc.)
 * Body: { alert_type, severity, message, battery_pct }
 * alert_type: low_battery | collision_warning | obstacle | offline | stuck | task_timeout | maintenance_due
 */
app.post('/agv/alert', requireAgvAuth, async (req, res) => {
  const { alert_type, severity, message, battery_pct } = req.body ?? {};
  const agvCode = req.agv.sub;
  const agvId = req.agv.agv_id;

  if (!alert_type) return res.status(400).json({ error: 'alert_type required' });

  try {
    await pgPool.query(`
      INSERT INTO agv_alerts (agv_id, agv_code, alert_type, severity, message)
      VALUES ($1, $2, $3, $4, $5)
    `, [agvId, agvCode, alert_type, severity ?? 'warning', message ?? '']);

    log('WARN', `AGV alert from ${agvCode}: ${alert_type} - ${message}`);
    res.json({ ok: true, alert_id: agvId, ts: new Date().toISOString() });
  } catch (err) {
    log('ERROR', `alert failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Command Polling Endpoints (AGV polls → MES pushes commands here)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /agv/commands?agv_code=AGV-S01&status=pending
 * AGV polls for pending commands addressed to it.
 * Returns oldest pending command (FIFO by priority then created_at).
 */
app.get('/agv/commands', async (req, res) => {
  const { agv_code, status = 'pending', limit = '5' } = req.query;
  if (!agv_code) return res.status(400).json({ error: 'agv_code required' });

  try {
    const rows = await pgPool.query(`
      SELECT id, agv_code, command_type, payload, status, priority, created_at
      FROM agv_command_queue
      WHERE agv_code = $1 AND ($2 = 'all' OR status = $2)
      ORDER BY priority ASC, created_at ASC
      LIMIT $3
    `, [agv_code, status, Number(limit)]);

    res.json({ commands: rows.rows, count: rows.rows.length, polled_at: new Date().toISOString() });
  } catch (err) {
    log('ERROR', `commands poll failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /agv/commands/:id/ack
 * AGV acknowledges a command, moving it to 'acknowledged' status.
 * Body: { accepted: true|false, reason? }
 */
app.post('/agv/commands/:id/ack', async (req, res) => {
  const { id } = req.params;
  const { accepted = true, reason } = req.body ?? {};

  if (!accepted && !reason) return res.status(400).json({ error: 'reason required when rejecting' });

  try {
    const result = await pgPool.query(`
      UPDATE agv_command_queue
      SET status = $1,
          notes  = COALESCE(notes || '; ', '') || COALESCE($2, ''),
          acknowledged_at = NOW()
      WHERE id = $3 AND status = 'pending'
      RETURNING id, command_type, agv_code
    `, [accepted ? 'acknowledged' : 'failed', reason, id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'command not found or already processed' });
    }

    log('INFO', `command ${id} ack: ${accepted ? 'accepted' : 'rejected'} by ${result.rows[0].agv_code}`);
    res.json({ ok: true, status: accepted ? 'acknowledged' : 'failed', command_id: id });
  } catch (err) {
    log('ERROR', `command ack failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /agv/commands/:id/complete
 * AGV marks a command as completed.
 * Body: { outcome: 'success'|'failed', notes? }
 */
app.post('/agv/commands/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { outcome = 'success', notes } = req.body ?? {};

  try {
    const result = await pgPool.query(`
      UPDATE agv_command_queue
      SET status = $1,
          notes = COALESCE(notes || '; ', '') || COALESCE($2, ''),
          completed_at = NOW()
      WHERE id = $3 AND status = 'acknowledged'
      RETURNING id, command_type, agv_code
    `, [outcome === 'success' ? 'completed' : 'failed', notes, id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'command not found or not acknowledged' });
    }

    log('INFO', `command ${id} completed: ${outcome}`);
    res.json({ ok: true, status: outcome, command_id: id });
  } catch (err) {
    log('ERROR', `command complete failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MES → AGV: Command Enqueue (called by MES side, not AGV devices)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /agv/commands (MES internal use)
 * Enqueue a command for an AGV to pick up via poll.
 * Body: { agv_code, command_type, payload: {}, priority? }
 * Returns command id for tracking.
 */
app.post('/agv/commands', async (req, res) => {
  const { agv_code, command_type, payload = {}, priority = 5 } = req.body ?? {};
  if (!agv_code || !command_type) {
    return res.status(400).json({ error: 'agv_code and command_type required' });
  }

  // Auth: require a valid JWT (MES systems use their own token)
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });

  let claims;
  try { claims = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'invalid token' }); }

  try {
    const result = await pgPool.query(`
      INSERT INTO agv_command_queue (agv_code, command_type, payload, status, priority, notes)
      VALUES ($1, $2, $3::jsonb, 'pending', $4, $5)
      RETURNING id, agv_code, command_type, status, priority, created_at
    `, [agv_code, command_type, JSON.stringify(payload), priority, `enqueued_by:${claims.sub ?? 'system'}`]);

    const cmd = result.rows[0];
    log('INFO', `command enqueued: ${cmd.id} → ${agv_code}:${command_type}`);
    res.status(201).json({ ok: true, command: cmd });
  } catch (err) {
    log('ERROR', `enqueue failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /agv/commands/queue?agv_code=X&status=pending
 * MES-side query: view command queue state.
 */
app.get('/agv/commands/queue', async (req, res) => {
  const { agv_code, status, limit = '100' } = req.query;
  try {
    let query = 'SELECT * FROM agv_command_queue WHERE 1=1';
    const params = [];
    if (agv_code) { params.push(agv_code); query += ` AND agv_code = $${params.length}`; }
    if (status)   { params.push(status);   query += ` AND status = $${params.length}`; }
    query += ` ORDER BY priority ASC, created_at ASC LIMIT $${params.length + 1}`;
    params.push(Number(limit));
    const rows = await pgPool.query(query, params);
    res.json({ commands: rows.rows, count: rows.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /agv/commands/:id
 * MES cancels a pending command.
 */
app.delete('/agv/commands/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pgPool.query(`
      UPDATE agv_command_queue SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING id
    `, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'command not found or not pending' });
    res.json({ ok: true, cancelled: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Fleet & Task Read-only (for MES internal use)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /agv/fleet
 * Returns current fleet status. Requires JWT (any valid).
 */
app.get('/agv/fleet', async (_req, res) => {
  try {
    const rows = await pgPool.query(`
      SELECT f.id, f.code, f.agv_type, f.status, f.battery_pct,
             f.x_coord, f.y_coord, f.heading, f.speed_mps,
             f.current_zone_id, f.current_task_id, f.last_heartbeat_at,
             f.total_tasks, f.total_distance_m,
             z.code AS zone_code, z.name_zh AS zone_name
      FROM agv_fleet f
      LEFT JOIN agv_zones z ON z.id = f.current_zone_id
      ORDER BY f.code
    `);
    res.json({ fleet: rows.rows, count: rows.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /agv/tasks?status=pending
 * Returns task queue. Requires JWT.
 */
app.get('/agv/tasks', async (req, res) => {
  const { status, agv_code, limit = '100' } = req.query;
  try {
    let query = `
      SELECT t.id, t.task_code, t.task_type, t.priority, t.status,
             t.from_zone_id, t.to_zone_id, t.agv_id,
             t.load_type, t.load_kg, t.created_at, t.started_at, t.completed_at,
             fz.code AS from_zone, fz.name_zh AS from_zone_name,
             tz.code AS to_zone,   tz.name_zh AS to_zone_name,
             af.code AS agv_code, af.agv_type
      FROM agv_tasks t
      LEFT JOIN agv_zones fz ON fz.id = t.from_zone_id
      LEFT JOIN agv_zones tz ON tz.id = t.to_zone_id
      LEFT JOIN agv_fleet af ON af.id = t.agv_id
      WHERE 1=1
    `;
    const params = [];
    if (status)   { params.push(status);   query += ` AND t.status = $${params.length}`; }
    if (agv_code) { params.push(agv_code); query += ` AND af.code = $${params.length}`; }
    query += ` ORDER BY t.priority ASC, t.created_at ASC LIMIT $${params.length + 1}`;
    params.push(Number(limit));
    const rows = await pgPool.query(query, params);
    res.json({ tasks: rows.rows, count: rows.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  log('ERROR', `Unhandled: ${err.message}`);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[AGV-API] listening on http://0.0.0.0:${PORT}`);
  console.log(`[AGV-API] PostgreSQL: ${PGHOST}:${PGPORT}/${PGDATABASE}`);
  console.log(`[AGV-API] JWT secret: ${JWT_SECRET.slice(0, 8)}...`);
});

export { app, pgPool };
