/**
 * station_ng_sync_once.mjs — test run
 */
import { query, shutdown } from './services/_shared/db.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'station_sync_state.json');

// Auto line (51-59) + Manual line (92-99)
const STATIONS = [
  // Auto line
  { ip: '192.168.6.51', name: 'manu_ict',         label: '51-ICT',    line_name: '自动线' },
  { ip: '192.168.6.52', name: 'manu_fct',         label: '52-FCT',    line_name: '自动线' },
  { ip: '192.168.6.53', name: 'manu_hivolt_ate',  label: '53-HIVOLT', line_name: '自动线' },
  { ip: '192.168.6.55', name: 'manu_assem_ate',   label: '55-ASSEM',  line_name: '自动线' },
  { ip: '192.168.6.56', name: 'manu_package_ate', label: '56-PACK',   line_name: '自动线' },
  { ip: '192.168.6.57', name: 'manu_supersonic',  label: '57-ULTRA',  line_name: '自动线' },
  { ip: '192.168.6.58', name: 'manu_agingcab',    label: '58-AGING',  line_name: '自动线' },
  { ip: '192.168.6.59', name: 'manu_pallet_binding', label: '59-PALLET', line_name: '自动线' },
  // Manual line
  { ip: '192.168.6.92', name: 'manu_fct',         label: '92-FCT',    line_name: '手动线' },
  { ip: '192.168.6.93', name: 'manu_depanel',     label: '93-DEPANEL',line_name: '手动线' },
  { ip: '192.168.6.95', name: 'manu_assem_ate',   label: '95-ASSEM',  line_name: '手动线' },
  { ip: '192.168.6.96', name: 'manu_supersonic',  label: '96-ULTRA',  line_name: '手动线' },
  { ip: '192.168.6.97', name: 'manu_agingcab',   label: '97-AGING',  line_name: '手动线' },
  { ip: '192.168.6.98', name: 'manu_hivolt_ate', label: '98-HIPOT',  line_name: '手动线' },
  { ip: '192.168.6.99', name: 'manu_package_ate', label: '99-PACK',   line_name: '手动线' },
];

const MES_API = 'http://192.168.6.155:8080';
const SCAN_BATCH_URL = `${MES_API}/api/mes/stations/scan/batch`;

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {}
  return {};
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function httpGet(host, port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: host, port, path: p, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
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
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 15000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Station NG Sync Test ===\n');

  for (const st of STATIONS) {
    const state = loadState();
    const key = `sync_${st.name}`;
    const sentSet = new Set(state[key] || []);
    console.log(`\n[${st.label}] ${st.ip}`);
    console.log(`  Already synced: ${sentSet.size}`);

    let ngRecords = [];
    let snRecords = [];

    try {
      ngRecords = await httpGet(st.ip, 10080, '/ng_pool');
      if (Array.isArray(ngRecords)) console.log(`  ng_pool: ${ngRecords.length} records`);
      else console.log(`  ng_pool: not an array`);
    } catch (e) { console.log(`  ng_pool ERROR: ${e.message}`); }

    try {
      snRecords = await httpGet(st.ip, 10080, '/sn_records');
      if (Array.isArray(snRecords)) console.log(`  sn_records: ${snRecords.length} records`);
      else console.log(`  sn_records: not an array`);
    } catch (e) { console.log(`  sn_records ERROR: ${e.message}`); }

    // Collect FAIL (result can be 'FAIL' or 'NG')
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

    console.log(`  Total FAIL: ${failSnMap.size}`);
    const newFails = [...failSnMap.values()].filter(r => !sentSet.has(r.sn));
    console.log(`  New FAIL (not yet synced): ${newFails.length}`);

    if (newFails.length > 0) {
      console.log(`  Sending to MES...`);
      const payload = {
        stationCode: st.name,
        records: newFails.map(r => ({
          pcbSerial: r.sn,
          result: r.result,
          occurredAt: r.time ? new Date(r.time).toISOString() : new Date().toISOString(),
        })),
      };

      try {
        const res = await httpPost(SCAN_BATCH_URL, payload);
        console.log(`  MES response: ${res.status}`);
        if (res.status === 201) {
          for (const r of newFails) sentSet.add(r.sn);
          state[key] = [...sentSet];
          saveState(state);
          console.log(`  Synced ${newFails.length} records!`);
        } else {
          console.log(`  MES error: ${JSON.stringify(res.body).substring(0, 300)}`);
        }
      } catch (e) {
        console.log(`  POST failed: ${e.message}`);
      }
    }
  }

  await shutdown();
  console.log('\n=== Done ===');
}

main().catch(e => { console.error(e); process.exit(1); });
