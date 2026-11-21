/**
 * station_ng_sync.mjs
 * 定时从工站本地 10080 API 读取 NG/SN 记录，上报到 MES
 *
 * 使用: node station_ng_sync.mjs
 * 定时: 每 30 秒轮询一次
 */

import { query, shutdown } from './services/_shared/db.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'station_sync_state.json');

// Auto line: ICT(51), FCT(52) + Manual line stations (192.168.6.92-99)
const STATIONS = [
  // Auto line
  { ip: '192.168.6.51', name: 'manu_ict',   label: 'ICT',      line_name: '自动线' },
  { ip: '192.168.6.52', name: 'manu_fct',   label: 'FCT',      line_name: '自动线' },
  // Manual line
  { ip: '192.168.6.92', name: 'manu_fct',        label: 'FCT',      line_name: '手动线' },
  { ip: '192.168.6.93', name: 'manu_depanel',     label: 'DEPANEL',  line_name: '手动线' },
  { ip: '192.168.6.95', name: 'manu_assem_ate',   label: 'ASSEM',    line_name: '手动线' },
  { ip: '192.168.6.96', name: 'manu_supersonic',  label: 'ULTRA',    line_name: '手动线' },
  { ip: '192.168.6.97', name: 'manu_agingcab',    label: 'AGING',    line_name: '手动线' },
  { ip: '192.168.6.98', name: 'manu_hivolt_ate',  label: 'HIPOT',    line_name: '手动线' },
  { ip: '192.168.6.99', name: 'manu_package_ate', label: 'PACK_ATE', line_name: '手动线' },
];

const MES_API = 'http://192.168.6.155:8080';
const SCAN_BATCH_URL = `${MES_API}/api/mes/stations/scan/batch`;
const POLL_INTERVAL_MS = 30_000;
const MES_TIMEOUT_MS = 10_000;

// ── State ──────────────────────────────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── HTTP helper ─────────────────────────────────────────────────────────────
function httpGet(host, port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port, path, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: MES_TIMEOUT_MS,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// ── Sync one station ────────────────────────────────────────────────────────
async function syncStation(station) {
  const { ip, name, label, line_name } = station;
  const state = loadState();
  const key = `sync_${name}`;
  const lastSnKey = `${key}_last_sn`;
  const sentSet = new Set(state[key] || []);

  let ngRecords = [];
  let snRecords = [];

  try {
    ngRecords = await httpGet(ip, 10080, '/ng_pool');
    if (!Array.isArray(ngRecords)) ngRecords = [];
  } catch (e) {
    console.log(`[${label}] ng_pool fetch failed: ${e.message}`);
  }

  try {
    snRecords = await httpGet(ip, 10080, '/sn_records');
    if (!Array.isArray(snRecords)) snRecords = [];
  } catch (e) {
    console.log(`[${label}] sn_records fetch failed: ${e.message}`);
  }

  // Build FAIL records (result can be 'FAIL' or 'NG')
  const failSnMap = new Map();

  for (const r of ngRecords) {
    if (r.sn && (r.result === 'FAIL' || r.result === 'NG')) {
      failSnMap.set(r.sn, { sn: r.sn, result: r.result === 'NG' ? 'fail' : r.result, time: r.time || '', channel: r.channel || '', errorCode: r.errorCode || '' });
    }
  }

  for (const r of snRecords) {
    if (r.sn && (r.result === 'FAIL' || r.result === 'NG') && !failSnMap.has(r.sn)) {
      failSnMap.set(r.sn, { sn: r.sn, result: r.result === 'NG' ? 'fail' : r.result, time: r.time || '' });
    }
  }

  if (failSnMap.size === 0) {
    console.log(`[${label}] No FAIL records`);
    return;
  }

  // Filter unsent
  const newFails = [...failSnMap.values()].filter(r => !sentSet.has(r.sn));

  if (newFails.length === 0) {
    console.log(`[${label}] All ${failSnMap.size} FAIL records already synced`);
    return;
  }

  // Send to MES
  const payload = {
    stationCode: name,
    records: newFails.map(r => ({
      pcbSerial: r.sn,
      result: r.result,
      occurredAt: r.time ? new Date(r.time).toISOString() : new Date().toISOString(),
    })),
  };

  console.log(`[${label}] Sending ${newFails.length} FAIL records to MES (stationCode=${name})`);

  try {
    const res = await httpPost(SCAN_BATCH_URL, payload);
    if (res.status === 201) {
      console.log(`[${label}] MES accepted ${newFails.length} records`);
      // Mark as synced
      for (const r of newFails) sentSet.add(r.sn);
      state[key] = [...sentSet];
      saveState(state);
    } else {
      console.log(`[${label}] MES rejected: ${res.status} - ${JSON.stringify(res.body).substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`[${label}] MES POST failed: ${e.message}`);
  }
}

// ── Main loop ───────────────────────────────────────────────────────────────
async function main() {
  console.log('Station NG Sync starting...');
  console.log(`MES API: ${MES_API}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log('---');

  while (true) {
    const start = Date.now();
    for (const station of STATIONS) {
      await syncStation(station);
    }
    const elapsed = Date.now() - start;
    console.log(`[${new Date().toISOString()}] Cycle done in ${elapsed}ms`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
