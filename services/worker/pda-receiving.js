/**
 * pda-receiving.js — PDA 收货/入库接口
 * Handles material receiving, SN scanning, label generation.
 *
 * Usage:
 *   node pda-receiving.js scan --sn <serial> [--bomid <id>] [--wo <code>]
 *   node pda-receiving.js receive --lot <lot> --qty <n> --material <code> [--location <loc>]
 *   node pda-receiving.js short-ship --lot <lot> --qty <n> --reason <text>
 *   node pda-receiving.js close --lot <lot>
 *   node pda-receiving.js status --lot <lot>
 */

import pg from "pg";
import { randomBytes } from "crypto";

const { Pool } = pg;
const pool = new Pool({
  host     : process.env.PGHOST     ?? "127.0.0.1",
  port     : Number(process.env.PGPORT ?? 5432),
  user     : process.env.PGUSER     ?? "postgres",
  password : process.env.PGPASSWORD ?? "postgres",
  database : process.env.PGDATABASE ?? "smt_factory",
  max      : 3,
});

// ── Helpers ──────────────────────────────────────────────────────────────
function genLotNo() {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `LOT-${ds}-${suffix}`;
}

async function sendLINE(msg) { /* same as bom-execute — simplified */ }

// ── Scan SN ──────────────────────────────────────────────────────────────
async function scanSn(serial, bomId, woCode) {
  const client = await pool.connect();
  try {
    // Register the material lot
    const lotNo = genLotNo();
    await client.query(
      `INSERT INTO material_lots (lot_no, serial_no, bom_id, wo_code, status, created_at)
       VALUES ($1,$2,$3,$4,'incoming',now())`,
      [lotNo, serial, bomId ?? null, woCode ?? null]
    );
    return { lot_no: lotNo, serial, status: "incoming" };
  } finally {
    client.release();
  }
}

// ── Receive ──────────────────────────────────────────────────────────────
async function receive(lotNo, qty, materialCode, location) {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE material_lots
       SET received_qty = $1, location = $2, status = 'iqc_pending', received_at = now()
       WHERE lot_no = $3`,
      [qty, location ?? null, lotNo]
    );
    return { lot_no: lotNo, qty, material: materialCode, location: location ?? null, status: "iqc_pending" };
  } finally {
    client.release();
  }
}

// ── Short Ship ───────────────────────────────────────────────────────────
async function shortShip(lotNo, qty, reason) {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE material_lots
       SET received_qty = $1, status = 'short_ship', short_ship_reason = $3, received_at = now()
       WHERE lot_no = $2`,
      [qty, lotNo, reason]
    );
    return { lot_no: lotNo, qty, status: "short_ship" };
  } finally {
    client.release();
  }
}

// ── Close ────────────────────────────────────────────────────────────────
async function closeLot(lotNo) {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE material_lots SET status = 'closed', closed_at = now() WHERE lot_no = $1`,
      [lotNo]
    );
    return { lot_no: lotNo, status: "closed" };
  } finally {
    client.release();
  }
}

// ── Status ───────────────────────────────────────────────────────────────
async function getStatus(lotNo) {
  const rows = await pool.query(
    `SELECT * FROM material_lots WHERE lot_no = $1`, [lotNo]
  );
  return rows.rows[0] ?? null;
}

// ── CLI ──────────────────────────────────────────────────────────────────
async function main() {
  const [action, ...args] = process.argv.slice(2);
  const get = (name, fallback = "") => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i+1]??fallback : fallback; };

  try {
    let result;
    switch (action) {
      case "scan":
        result = await scanSn(get("sn"), get("bomid") ? Number(get("bomid")) : null, get("wo"));
        break;
      case "receive":
        result = await receive(get("lot"), Number(get("qty",0)), get("material"), get("location"));
        break;
      case "short-ship":
        result = await shortShip(get("lot"), Number(get("qty",0)), get("reason","缺货"));
        break;
      case "close":
        result = await closeLot(get("lot"));
        break;
      case "status":
        result = await getStatus(get("lot"));
        break;
      default:
        console.error("Usage: pda-receiving.js scan|receive|short-ship|close|status [--key val]");
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
