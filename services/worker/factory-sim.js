/**
 * factory-sim.js — Vietnam SMT Factory Rolling Simulation
 *
 * Simulates realistic factory production by writing mock data directly to the DB.
 * MES/WMS/BOM/HR agents read from the same DB — their patrol cycles will pick up
 * this data as if it came from a real live factory.
 *
 * Usage:
 *   node factory-sim.js seed          # One-shot: seed WOs, runs, material lots, initial events
 *   node factory-sim.js rolling [sec] # Continuous production events (default: 15s interval)
 *   node factory-sim.js status        # Show current factory state summary
 *   node factory-sim.js reset         # Clear simulation data (keep master data)
 *
 * Environment:
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 */

import pg from "pg";
const { Pool } = pg;

// ── DB Pool ────────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.PGHOST     ?? "127.0.0.1",
  port:     Number(process.env.PGPORT ?? 5432),
  user:     process.env.PGUSER     ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 5,
});

async function query(sql, params = []) {
  const c = await pool.connect();
  try { return c.query(sql, params); }
  finally { c.release(); }
}

function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${ts} [${level}] ${msg}`);
}

// ── Config ────────────────────────────────────────────────────────────
const LINE_CODE  = "L001";
const LINE_ID    = null; // resolved from DB
const PRODUCT    = "PCBA-AURORA-CTRL";
const WORK_ORDERS = ["26061020007", "26062910001", "26062910002"];
const STATIONS_L001 = [
  { code: "AI1-01",    type: "ai_insert_1",   machine: "AI1-01" },
  { code: "PRINT-01",  type: "smt_mounter_1", machine: "PRINT-01" },
  { code: "SPI-01",    type: "smt_mounter_1", machine: "SPI-01" },
  { code: "NXT-01",    type: "smt_mounter_1", machine: "NXT-01" },
  { code: "NXT-02",    type: "smt_mounter_2", machine: "NXT-02" },
  { code: "NXT-03",    type: "smt_mounter_2", machine: "NXT-03" },
  { code: "REFLOW-01", type: "smt_aoi",       machine: "REFLOW-01" },
  { code: "AOI-01",    type: "smt_aoi",       machine: "AOI-01" },
  { code: "PCBA-LOAD", type: "pcba_loading",  machine: null },
  { code: "PDA-01",    type: "pda_scan",      machine: "PDA-01" },
  { code: "WS-AOI-01", type: "wsaoi",         machine: "WS-AOI-01" },
  { code: "ICT-01",    type: "ict",           machine: "ICT-01" },
  { code: "FCT-01",    type: "fct",           machine: "FCT-01" },
  { code: "DEPANEL-01",type: "depanel",       machine: "DEPANEL-01" },
  { code: "SN-BIND-01",type: "sn_bind_pcba",  machine: null },
  { code: "ATE1-01",   type: "ate_1",         machine: "ATE1-01" },
  { code: "ULTRA-01",  type: "ultrasonic",    machine: "ULTRA-01" },
  { code: "BI-LOAD-01",type: "burnin_load",   machine: "BI-LOAD-01" },
  { code: "BI-TEST-01",type: "burnin_test",  machine: null },
  { code: "HIPOT-01",  type: "hipot",         machine: "HIPOT-01" },
  { code: "ATE2-01",   type: "ate_2",         machine: "ATE2-01" },
  { code: "SN-CODE-01",type: "sn_bind_code",  machine: null },
  { code: "PACK-01",  type: "packing",       machine: null },
  { code: "PALLET-01",type: "pallet_label",   machine: null },
];

// Defect probability per station (realistic yield rates)
const STATION_DEFECT_RATE = {
  "AI1-01":     0.008,  // 0.8%
  "PRINT-01":    0.015,  // 1.5%
  "SPI-01":     0.020,  // 2.0% fail → needs rework
  "NXT-01":     0.005,  // 0.5%
  "NXT-02":     0.005,
  "NXT-03":     0.005,
  "REFLOW-01":  0.003,  // 0.3%
  "AOI-01":     0.025,  // 2.5% detected
  "PCBA-LOAD":  0.001,
  "PDA-01":     0.000,
  "WS-AOI-01":  0.010,
  "ICT-01":     0.015,
  "FCT-01":     0.020,
  "DEPANEL-01": 0.002,
  "SN-BIND-01": 0.000,
  "ATE1-01":    0.010,
  "ULTRA-01":   0.005,
  "BI-LOAD-01": 0.000,
  "BI-TEST-01": 0.008,
  "HIPOT-01":   0.003,
  "ATE2-01":    0.012,
  "SN-CODE-01": 0.000,
  "PACK-01":    0.000,
  "PALLET-01":  0.000,
};

// ── Helpers ────────────────────────────────────────────────────────────
let _lineId = null;
let _stationIds = {};
let _productId = null;
let _woIds = {};
let _opIds = {};

async function resolveIds() {
  if (_lineId) return; // already resolved

  // Line
  const lr = await query(`SELECT id FROM production_lines WHERE internal_code = $1`, [LINE_CODE]);
  _lineId = lr.rows[0]?.id;
  if (!_lineId) throw new Error(`Line ${LINE_CODE} not found — run seed first`);

  // Stations
  const sr = await query(`
    SELECT s.code, s.id, st.code AS station_type
    FROM stations s JOIN station_types st ON st.id = s.station_type_id
    WHERE s.line_id = $1
  `, [_lineId]);
  for (const row of sr.rows) {
    _stationIds[row.code] = row.id;
  }

  // Product
  const pr = await query(`SELECT id FROM products WHERE code = $1`, [PRODUCT]);
  _productId = pr.rows[0]?.id;

  // Operators
  const opR = await query(`SELECT id, username FROM users WHERE role_id = (SELECT id FROM roles WHERE code = 'smt_operator') LIMIT 3`);
  for (const row of opR.rows) { _opIds[row.username] = row.id; }

  log("INFO", `Resolved: line=${_lineId}, stations=${Object.keys(_stationIds).length}, ops=${Object.keys(_opIds).length}`);
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sn8(prefix = "SN") {
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function resultForStation(code, defectRate) {
  if (code === "PDA-01" || code === "SN-BIND-01" || code === "SN-CODE-01" || code === "PACK-01" || code === "PALLET-01" || code === "PCBA-LOAD") {
    return "pass"; // non-inspection stations
  }
  return Math.random() < defectRate ? "fail" : "pass";
}

// ── Seed initial data ─────────────────────────────────────────────────
async function cmdSeed() {
  log("INFO", "=== Factory Sim: SEED ===");
  await resolveIds();

  // 1. Update line L001 to running
  await query(`UPDATE production_lines SET status = 'running' WHERE internal_code = $1`, [LINE_CODE]);
  log("INFO", `Line ${LINE_CODE} set to running`);

  // 2. Create 2 more work orders for rolling simulation
  const woList = [
    { code: "26062910001", qty: 4800, product: PRODUCT },
    { code: "26062910002", qty: 7200, product: PRODUCT },
  ];
  for (const wo of woList) {
    // Try insert, skip if exists
    try {
      await query(`
        INSERT INTO work_orders (code, customer_po_id, product_id, line_id, work_order_type, planned_qty, completed_qty, status, released_at)
        SELECT $1,
               (SELECT id FROM customer_pos LIMIT 1),
               (SELECT id FROM products WHERE code = $3 LIMIT 1),
               $2, 1, $4, 0, 'released', NOW()
        ON CONFLICT (code) DO NOTHING
      `, [wo.code, _lineId, wo.product, wo.qty]);
      log("INFO", `WO ${wo.code} ${wo.qty}pcs seeded`);
    } catch (e) { /* skip */ }
  }

  // 3. Create mes_runs for L001
  const allWoCodes = [WORK_ORDERS[0], "26062910001", "26062910002"];
  for (const woCode of allWoCodes) {
    const existing = await query(`SELECT id FROM mes_runs WHERE work_order_code = $1 AND line_id = $2`, [woCode, _lineId]);
    if (existing.rows.length === 0) {
      const woR = await query(`SELECT planned_qty FROM work_orders WHERE code = $1`, [woCode]);
      const planned = woR.rows[0]?.planned_qty ?? 5000;
      await query(`
        INSERT INTO mes_runs (work_order_code, line_id, status, planned_qty, completed_qty, started_at)
        VALUES ($1, $2, 'running', $3, 0, NOW())
      `, [woCode, _lineId, planned]);
      log("INFO", `mes_run created: ${woCode} on ${LINE_CODE} (${planned}pcs)`);
    }
  }

  // 4. Create material lots (released for WMS)
  const materials = [
    { code: "PCB-AURORA-CTRL", supplier: "SUP-HN-PCB",      qty: 10000 },
    { code: "R-0603-10K-1",    supplier: "SUP-TPE-RES",     qty: 50000 },
    { code: "R-0603-4K7-1",   supplier: "SUP-TPE-RES",     qty: 50000 },
    { code: "C-0805-100NF",   supplier: "SUP-SZ-CAP",      qty: 80000 },
  ];
  for (const m of materials) {
    const lotNo = `${m.code}-${Date.now().toString(36).slice(-4).toUpperCase()}-LOT`;
    await query(`
      INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status)
      SELECT
        (SELECT id FROM materials WHERE code = $1 LIMIT 1),
        (SELECT id FROM suppliers WHERE code = $2 LIMIT 1),
        $3, $4, 'released'
      ON CONFLICT (lot_no) DO NOTHING
    `, [m.code, m.supplier, lotNo, m.qty]);
    log("INFO", `material_lot: ${lotNo} (${m.code}) x${m.qty} [released]`);
  }

  // 5. Create initial feeder bindings for WO 26061010008
  const fbWo = "26061020007";
  const feederSlots = ["F01","F02","F03","F04","F05","F06","F07","F08"];
  for (const slot of feederSlots) {
    const matCode = pick(materials).code;
    const lotR = await query(`SELECT lot_no FROM material_lots WHERE material_id = (SELECT id FROM materials WHERE code = $1 LIMIT 1) AND iqc_status = 'released' LIMIT 1`, [matCode]);
    const lotNo = lotR.rows[0]?.lot_no ?? `LOT-${matCode}-DEFAULT`;
    await query(`
      INSERT INTO feeder_bindings (work_order_id, line_id, machine_id, material_lot_id, feeder_no, reel_code, operator_id, bound_at)
      SELECT
        (SELECT id FROM work_orders WHERE code = $1 LIMIT 1),
        $2,
        (SELECT id FROM machines WHERE code = 'NXT-01' LIMIT 1),
        (SELECT id FROM material_lots WHERE lot_no = $3 LIMIT 1),
        $4, $3,
        (SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE code = 'smt_operator') LIMIT 1),
        NOW()
      ON CONFLICT DO NOTHING
    `, [fbWo, _lineId, lotNo, slot]);
  }
  log("INFO", `Feeder bindings created for ${fbWo}: ${feederSlots.length} slots`);

  // 6. Backfill station_events for last 3 hours (so agents have historical data)
  await seedHistoricalEvents(3);

  // 7. Create a stagnation event
  await query(`
    INSERT INTO stagnation_log (sn, pcb_no, station_code, line_code, stagnation_minutes, stagnation_level, status, work_order_code, product_model, created_at)
    VALUES ($1, $2, 'AOI-01', $3, 45, 'yellow', 'open', $4, $5, NOW() - INTERVAL '20 minutes')
  `, [sn8(), sn8("PCB"), LINE_CODE, "26061020007", PRODUCT]);

  // 8. Create a downtime record
  const dtNo = `DT-${Date.now().toString(36).toUpperCase()}`;
  await query(`
    INSERT INTO downtime_records (downtime_no, line_code, reason_code, reason_detail, start_at, status, operator)
    VALUES ($1, $2, 'DT-001', '换线调试 NXT-01 → NXT-02', NOW() - INTERVAL '18 minutes', 'open', 'VN_OP_001')
  `, [dtNo, LINE_CODE]);

  // 9. Create a scrap record
  await query(`
    INSERT INTO scrap_records (sn, pcb_no, scrap_station, line_code, scrap_reason_code, scrap_reason_detail, quantity, status, work_order_code, created_at)
    VALUES ($1, $2, 'AOI-01', $3, 'SCRAP-003', '元件偏移超限', 1, 'pending', $4, NOW() - INTERVAL '10 minutes')
  `, [sn8(), sn8("PCB"), LINE_CODE, "26061020007"]);

  log("INFO", "=== Seed complete ===");
  await showStatus();
}

// ── Seed historical station events ────────────────────────────────────
async function seedHistoricalEvents(hoursBack = 3) {
  const now = Date.now();
  const startMs = now - hoursBack * 3600 * 1000;
  const intervalMs = 90 * 1000; // 1 event every 90 seconds
  const events = [];

  for (let t = startMs; t < now; t += intervalMs) {
    const ts = new Date(t);
    const pcb = sn8("PCB");
    let currentWo = pick(["26061020007", "26062910001"]);
    // Each PCB goes through each station
    for (const st of STATIONS_L001) {
      const defectRate = STATION_DEFECT_RATE[st.code] ?? 0.005;
      const result = resultForStation(st.code, defectRate);
      events.push({
        ts, pcb,
        station: st,
        result,
        wo: currentWo,
      });
      // Some boards fail AOI and get reworked (clone with pass)
      if (st.code === "AOI-01" && result === "fail") {
        events.push({ ts: new Date(ts.getTime() + 5000), pcb, station: st, result: "pass", wo: currentWo });
      }
    }
  }

  // Batch insert
  const INSERT_SQL = `
    INSERT INTO station_events_2026 (pcb_serial_id, station_id, machine_id, operator_id, event_type, result, occurred_at)
    SELECT
      COALESCE((SELECT id FROM pcb_serials WHERE serial_no = $1 LIMIT 1), 0),
      $2, $3, $4, 'production', $5, $6
  `;

  for (const ev of events) {
    const sid  = _stationIds[ev.station.code];
    const mid  = ev.station.machine ? (await query(`SELECT id FROM machines WHERE code = $1`, [ev.station.machine])).rows[0]?.id : null;
    const opId = Object.values(_opIds)[0];
    if (!sid) continue;
    try {
      await query(INSERT_SQL, [ev.pcb, sid, mid, opId, ev.result, ev.ts.toISOString()]);
    } catch (_) {}
  }

  log("INFO", `Seeded ${events.length} historical station_events (${hoursBack}h backfill)`);
}

// ── Rolling simulation ─────────────────────────────────────────────────
let rollingActive = false;
let rollingCount = 0;

async function tickRolling() {
  if (!rollingActive) return;
  rollingCount++;
  await resolveIds();

  // How many PCBs to simulate in this tick (every 15s = ~10-20 PCBs)
  const batchSize = rand(8, 18);
  log("INFO", `=== Rolling tick ${rollingCount}: ${batchSize} PCBs ===`);

  for (let i = 0; i < batchSize; i++) {
    const pcb   = sn8("PCB");
    const wo    = pick(["26061020007", "26062910001", "26062910002"]);
    const opKey = pick(Object.keys(_opIds));
    const opId  = _opIds[opKey];

    for (const st of STATIONS_L001) {
      const defectRate = STATION_DEFECT_RATE[st.code] ?? 0.005;
      const result     = resultForStation(st.code, defectRate);
      const sid        = _stationIds[st.code];
      if (!sid) continue;

      // Machine id
      let mid = null;
      if (st.machine) {
        try {
          const mr = await query(`SELECT id FROM machines WHERE code = $1`, [st.machine]);
          mid = mr.rows[0]?.id;
        } catch (_) {}
      }

      const ts = new Date();
      try {
        await query(`
          INSERT INTO station_events_2026 (pcb_serial_id, station_id, machine_id, operator_id, event_type, result, occurred_at)
          VALUES (0, $1, $2, $3, 'production', $4, $5)
        `, [sid, mid, opId, result, ts.toISOString()]);
      } catch (_) {}

      // If AOI fail → reinsert same PCB for rework pass
      if (st.code === "AOI-01" && result === "fail") {
        await query(`
          INSERT INTO station_events_2026 (pcb_serial_id, station_id, machine_id, operator_id, event_type, result, occurred_at)
          VALUES (0, $1, $2, $3, 'production', 'pass', $4)
        `, [sid, mid, opId, new Date(ts.getTime() + 4000).toISOString()]);
        // Log scrap record for the failed board
        await query(`
          INSERT INTO scrap_records (sn, pcb_no, scrap_station, line_code, scrap_reason_code, scrap_reason_detail, quantity, status, work_order_code, created_at)
          VALUES ($1, $2, $3, $4, 'SCRAP-002', 'AOI检测不良', 1, 'pending', $5, $6)
          ON CONFLICT DO NOTHING
        `, [sn8("RW"), pcb, st.code, LINE_CODE, wo, ts.toISOString()]);
      }

      // Occasionally create stagnation (every ~50 PCBs)
      if (st.code === "AOI-01" && Math.random() < 0.02) {
        await query(`
          INSERT INTO stagnation_log (sn, pcb_no, station_code, line_code, stagnation_minutes, stagnation_level, status, work_order_code, product_model, created_at)
          VALUES ($1, $2, $3, $4, $5, 'yellow', 'open', $6, $7, $8)
        `, [sn8("STG"), pcb, st.code, LINE_CODE, rand(15, 60), wo, PRODUCT, ts.toISOString()]);
      }
    }

    // Update mes_runs completed_qty for this WO
    await query(`
      UPDATE mes_runs
      SET completed_qty = completed_qty + 1, updated_at = NOW()
      WHERE work_order_code = $1 AND line_id = $2 AND status = 'running'
    `, [wo, _lineId]);

    // Update work_orders completed_qty
    await query(`
      UPDATE work_orders
      SET completed_qty = completed_qty + 1
      WHERE code = $1
    `, [wo]);
  }

  // Occasionally add downtime (2% chance per tick)
  if (Math.random() < 0.02) {
    const reasons = [
      { code: "DT-001", detail: "换线调试" },
      { code: "DT-003", detail: "物料短缺等待" },
      { code: "DT-002", detail: "设备预防性保养" },
    ];
    const r = pick(reasons);
    const dtNo = `DT-${Date.now().toString(36).toUpperCase()}`;
    await query(`
      INSERT INTO downtime_records (downtime_no, line_code, reason_code, reason_detail, start_at, status, operator)
      VALUES ($1, $2, $3, $4, NOW(), 'open', $5)
    `, [dtNo, LINE_CODE, r.code, r.detail, opKey]);
    log("WARN", `Downtime created: ${r.code} - ${r.detail}`);
  }

  // Log rolling status every 10 ticks
  if (rollingCount % 10 === 0) {
    await showStatus();
  }
}

async function cmdRolling(intervalSec = 15) {
  log("INFO", `=== Factory Sim: ROLLING (every ${intervalSec}s) ===`);
  await resolveIds();
  rollingActive = true;

  // Ensure mes_runs are running
  const runs = await query(`SELECT work_order_code, status FROM mes_runs WHERE line_id = $1`, [_lineId]);
  if (runs.rows.length === 0) {
    log("WARN", "No mes_runs found — run 'seed' first!");
    return;
  }
  for (const r of runs.rows) {
    if (r.status !== "running") {
      await query(`UPDATE mes_runs SET status = 'running', started_at = NOW() WHERE work_order_code = $1`, [r.work_order_code]);
    }
  }

  log("INFO", "Press Ctrl+C to stop.");
  while (rollingActive) {
    try {
      await tickRolling();
    } catch (err) {
      log("ERR", `tickRolling error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, intervalSec * 1000));
  }
}

// ── Status ─────────────────────────────────────────────────────────────
async function showStatus() {
  try {
    await resolveIds();

    const [runs, recentEvents, stagnations, scraps, downtimes] = await Promise.all([
      query(`SELECT mr.work_order_code, mr.status, mr.planned_qty, mr.completed_qty, wo.product_id
             FROM mes_runs mr JOIN work_orders wo ON wo.code = mr.work_order_code
             WHERE mr.line_id = $1`, [_lineId]),
      query(`SELECT COUNT(*) cnt FROM station_events WHERE occurred_at > NOW() - INTERVAL '10 minutes'`),
      query(`SELECT COUNT(*) cnt FROM stagnation_log WHERE status = 'open' AND created_at > NOW() - INTERVAL '1 hour'`),
      query(`SELECT COUNT(*) cnt FROM scrap_records WHERE status = 'pending' AND created_at > NOW() - INTERVAL '1 hour'`),
      query(`SELECT COUNT(*) cnt FROM downtime_records WHERE status = 'open' AND created_at > NOW() - INTERVAL '1 hour'`),
    ]);

    const line = [
      `产线 ${LINE_CODE}`,
      `WOs: ${runs.rows.map(r => `${r.work_order_code}(${r.completed_qty}/${r.planned_qty} ${r.status})`).join(", ")}`,
      `Events(10min): ${recentEvents.rows[0]?.cnt ?? 0}`,
      `停滞: ${stagnations.rows[0]?.cnt ?? 0}`,
      `待报废: ${scraps.rows[0]?.cnt ?? 0}`,
      `停机: ${downtimes.rows[0]?.cnt ?? 0}`,
    ].join(" | ");

    console.log(`\n🏭 [FACTORY STATUS] ${line}\n`);
  } catch (err) {
    log("ERR", `showStatus: ${err.message}`);
  }
}

// ── Reset ──────────────────────────────────────────────────────────────
async function cmdReset() {
  log("WARN", "Clearing simulation data...");
  await query(`DELETE FROM station_events_2026`);
  await query(`DELETE FROM mes_runs`);
  await query(`DELETE FROM stagnation_log`);
  await query(`DELETE FROM scrap_records`);
  await query(`DELETE FROM downtime_records`);
  await query(`UPDATE production_lines SET status = 'idle'`);
  log("INFO", "Reset complete.");
}

// ── CLI ───────────────────────────────────────────────────────────────
const [, , cmd, arg] = process.argv;

switch (cmd) {
  case "seed":
    cmdSeed().then(() => process.exit(0)).catch(e => { log("ERR", e.message); process.exit(1); });
    break;
  case "rolling": {
    const interval = parseInt(arg, 10) || 15;
    cmdRolling(interval).catch(e => { log("ERR", e.message); process.exit(1); });
    break;
  }
  case "status":
    showStatus().then(() => process.exit(0)).catch(e => { log("ERR", e.message); process.exit(1); });
    break;
  case "reset":
    cmdReset().then(() => process.exit(0)).catch(e => { log("ERR", e.message); process.exit(1); });
    break;
  default:
    console.log(`Factory Rolling Simulation

Usage:
  node factory-sim.js seed          # Seed WOs, runs, material lots, historical events
  node factory-sim.js rolling [s]  # Continuous production (default 15s interval)
  node factory-sim.js status        # Show current factory state
  node factory-sim.js reset         # Clear all simulation data

Prerequisites:
  1. psql -f database/migrations/001_initial_factory_schema.sql
  2. psql -f database/migrations/002_inter_agent_messages.sql
  3. psql -f database/migrations/003_factory_sim_schema.sql
  4. psql -f database/seeds/001_demo_factory_seed.sql
  5. node factory-sim.js seed

Then run agents:
  node mes-manager.js watch     # MES patrol
  node wms-manager.js watch     # WMS patrol
  node plant-manager.js morning  # Plant Manager morning briefing
`);
    process.exit(1);
}

// Graceful shutdown
process.on("SIGINT", () => {
  log("INFO", "Stopping factory simulation...");
  rollingActive = false;
  process.exit(0);
});
