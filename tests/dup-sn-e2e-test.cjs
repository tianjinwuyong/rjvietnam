/**
 * dup-sn-e2e-test.cjs — 手动线全流程重码检测测试
 * 逻辑：
 *   第1次扫码 → 201，无 snDuplicateId
 *   第2次扫码 → 201，有 snDuplicateId → DUP 正确
 *
 * 运行：node tests/dup-sn-e2e-test.cjs
 */

const http = require('http');
const { Pool } = require('pg');

const BASE = { hostname: '127.0.0.1', port: 8080 };
const TEST_SN_BASE = '05K41G' + Date.now().toString().slice(-4);
const LINE_CODE = 'MANUAL-LINE';

const STATIONS = [
  { code: 'AOI-01',       ip: '192.168.6.90',   seq: 1  },
  { code: 'ICT-01',       ip: '192.168.6.91',   seq: 2  },
  { code: 'FCT-01',       ip: '192.168.6.92',   seq: 3  },
  { code: 'DEPANEL-01',   ip: '192.168.6.93',   seq: 4  },
  { code: 'SHELL-BIND-01',ip: '192.168.6.94',   seq: 5  },
  { code: 'ASSY-ATE-01',  ip: '192.168.6.95',   seq: 6  },
  { code: 'ULTRA-01',     ip: '192.168.6.96',   seq: 7  },
  { code: 'AGING-01',     ip: '192.168.6.97',   seq: 8  },
  { code: 'HIPOT-01',     ip: '192.168.6.98',   seq: 9  },
  { code: 'PACK-ATE-01',  ip: '192.168.6.99',   seq: 10 },
  { code: 'CARTON-BIND-01',ip:'192.168.6.100',  seq: 11 },
];

let token = null;
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

function apiReq(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = { ...BASE, path, method, headers };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cleanupSn(sn) {
  const p = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  try {
    await p.query("DELETE FROM pcb_serials WHERE serial_no = $1", [sn]);
  } catch(e) { /* silent */ }
  try {
    await p.query("DELETE FROM sn_duplicate_attempts WHERE sn = $1", [sn]);
  } catch(e) { /* silent */ }
  await p.end();
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  // 0. Login
  process.stdout.write('[0] POST /auth/login... ');
  const loginRes = await apiReq('POST', '/auth/login', { username: 'VN_OP_001', password: 'Factory@123' });
  if (loginRes.status !== 200) { console.log('FAIL:', JSON.stringify(loginRes.body)); process.exit(1); }
  token = loginRes.body?.data?.token;
  console.log('OK');

  // 0b. Station login for all stations
  for (const st of STATIONS) {
    process.stdout.write(`[0b] POST /auth/station-login (${st.code})... `);
    await apiReq('POST', '/auth/station-login', { operator: 'VN_OP_001', stationCode: st.code }, token);
    console.log('OK');
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('  手动线全流程 DUP SN 检测测试');
  console.log('══════════════════════════════════════════════\n');

  for (const station of STATIONS) {
    const sn = `${TEST_SN_BASE}${station.seq.toString().padStart(2, '0')}`;
    console.log(`\n▶ Station ${station.seq}/11: ${station.code} (${station.ip})`);
    console.log(`  SN: ${sn}`);

    await cleanupSn(sn);
    await delay(200);

    // 第1次扫码 — PASS
    process.stdout.write(`  [1/2] 第1次扫码 (PASS)... `);
    const r1 = await apiReq('POST', '/api/mes/events', {
      action: 'station_scan',
      payload: {
        pcbSerial: sn,
        stationCode: station.code,
        machineCode: 'TEST-MACHINE',
        operator: 'VN_OP_001',
        eventType: 'station_scan',
        result: 'pass',
        lineCode: LINE_CODE,
      }
    }, token);
    await delay(500);

    if (r1.status !== 201) {
      console.log(`❌ 第1次扫码失败 status=${r1.status}: ${JSON.stringify(r1.body).slice(0,100)}`);
      failed++;
      continue;
    }
    const firstId = r1.body?.data?.item?.stationEventId;
    if (r1.body?.data?.item?.snDuplicateId) {
      console.log(`❌ 第1次扫码不应触发DUP，但返回 snDuplicateId`);
      failed++;
      continue;
    }
    console.log(`✓ 通过 eventId=${firstId}`);

    // 第2次扫码 — DUP
    process.stdout.write(`  [2/2] 第2次扫码 (DUP)... `);
    const r2 = await apiReq('POST', '/api/mes/events', {
      action: 'station_scan',
      payload: {
        pcbSerial: sn,
        stationCode: station.code,
        machineCode: 'TEST-MACHINE',
        operator: 'VN_OP_001',
        eventType: 'station_scan',
        result: 'pass',
        lineCode: LINE_CODE,
      }
    }, token);
    await delay(500);

    if (r2.status !== 201) {
      console.log(`❌ 第2次扫码失败 status=${r2.status}`);
      failed++;
      continue;
    }
    const dupId = r2.body?.data?.item?.snDuplicateId;
    if (dupId) {
      console.log(`✓ DUP 检测正确！snDuplicateId=${dupId}`);
      passed++;
    } else {
      console.log(`❌ DUP 未检测到！第2次扫码无 snDuplicateId`);
      console.log(`    响应:`, JSON.stringify(r2.body).slice(0,200));
      failed++;
    }

    await cleanupSn(sn);
  }

  await pool.end();

  console.log('\n══════════════════════════════════════════════');
  console.log(`  结果: ${passed}/11 通过, ${failed}/11 失败`);
  console.log('══════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
