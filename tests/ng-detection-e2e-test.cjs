// ng-detection-e2e-test.cjs — End-to-end NG detection on MANUAL-LINE
const http = require('http');
const { Pool } = require('pg');

const BASE = { hostname: '127.0.0.1', port: 8080 };
const MANUAL_LINE = 'MANUAL-LINE';

// All MANUAL-LINE stations in sequence order
const STATIONS = [
  'PDA-01',       // seq=1
  'AOI-01',       // seq=2
  'ICT-01',       // seq=3  ← NG station
  'FCT-01',       // seq=4  ← queries upstream
  'DEPANEL-01',   // seq=5
  'SHELL-BIND-01', // seq=6
  'ASSY-ATE-01',  // seq=7
  'ULTRA-01',     // seq=8
  'AGING-01',     // seq=9
  'HIPOT-01',     // seq=10
  'PACK-ATE-01',  // seq=11
  'CARTON-BIND-01', // seq=12
  'PALLET-BIND-01'  // seq=13
];

let token = null;

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

async function postEvent(stationCode, sn, result, eventType, defectCode) {
  const payload = { stationCode, pcbSerial: sn, result, eventType, lineCode: MANUAL_LINE };
  if (defectCode) { payload.defectCode = defectCode; payload.defectDescription = 'test'; }
  return apiReq('POST', '/mes/events', { payload }, token);
}

async function main() {
  const TS = Date.now();
  let passed = 0, failed = 0;
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

  // 0. Login
  process.stdout.write('[0] POST /auth/login... ');
  const loginRes = await apiReq('POST', '/auth/login', { username: 'VN_OP_001', password: 'Factory@123' });
  console.log('status=' + loginRes.status);
  if (loginRes.status !== 200) { console.log('FAIL:', JSON.stringify(loginRes.body)); await pool.end(); process.exit(1); }
  token = loginRes.body?.data?.token;
  console.log('    token=' + (token ? 'OK' : 'MISSING'));
  passed++;

  // 0b. Station login on FCT-01
  process.stdout.write('[0b] POST /auth/station-login (FCT-01)... ');
  const stLoginRes = await apiReq('POST', '/auth/station-login', { operator: 'VN_OP_001', stationCode: 'FCT-01' });
  console.log('status=' + stLoginRes.status);
  if (stLoginRes.status === 200 || stLoginRes.status === 201) { console.log('PASS'); passed++; }
  else { console.log('FAIL:', JSON.stringify(stLoginRes.body?.error)); failed++; }

  // ─── Full MANUAL-LINE flow ───
  const sn = 'TEST-FLOW-' + TS;

  // Step 1: PDA-01 scan
  process.stdout.write('[1] PDA-01 SCAN sn=' + sn + '... ');
  let r = await postEvent('PDA-01', sn, 'PASS', 'SCAN');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS' : ' FAIL: ' + JSON.stringify(r.body?.error)));

  // Step 2: AOI-01 PASS
  process.stdout.write('[2] AOI-01 PASS... ');
  r = await postEvent('AOI-01', sn, 'PASS', 'SCAN');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS' : ' FAIL'));

  // Step 3: ICT-01 NG ← from D:\Excel
  process.stdout.write('[3] ICT-01 NG (from D:\\Excel)... ');
  r = await postEvent('ICT-01', sn, 'NG', 'SCAN', 'ICT_FAIL');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS id=' + (r.body?.data?.item?.id ?? r.body?.data?.id) : ' FAIL: ' + JSON.stringify(r.body?.error)));

  // Step 4: FCT-01 upstream check — should find NG at ICT-01
  process.stdout.write('[4] FCT-01 upstream-check (should hasNg=true)... ');
  const upR = await apiReq('GET', '/mes/events/upstream-check/' + sn + '?stationCode=FCT-01', null, token);
  console.log('status=' + upR.status);
  if (upR.status === 200) {
    const d = upR.body?.data || {};
    console.log('    hasNg=' + d.hasNg + ' upstreamEvents=' + (d.upstreamEvents?.length || 0));
    if (d.hasNg === true) { console.log('    PASS'); passed++; }
    else { console.log('    FAIL - expected hasNg=true'); failed++; }
  } else { console.log('    FAIL:', JSON.stringify(upR.body?.error)); failed++; }

  // Step 5: NG registry check from FCT-01
  process.stdout.write('[5] FCT-01 ng-registry (should find ICT-01 NG)... ');
  const regR = await apiReq('GET', '/api/mes/ng-registry/check?sn=' + sn + '&stationCode=FCT-01&lineCode=MANUAL-LINE', null, token);
  console.log('status=' + regR.status);
  if (regR.status === 200) {
    const recs = regR.body?.data?.records ?? [];
    console.log('    ' + recs.length + ' NG records');
    if (recs.length > 0) { console.log('    PASS'); passed++; }
    else { console.log('    FAIL - no records'); failed++; }
  } else { console.log('    FAIL:', JSON.stringify(regR.body?.error)); failed++; }

  // Step 6: Continue to DEPANEL-01
  process.stdout.write('[6] DEPANEL-01 PASS... ');
  r = await postEvent('DEPANEL-01', sn, 'PASS', 'SCAN');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS' : ' FAIL'));

  // Step 7: SHELL-BIND-01 PASS
  process.stdout.write('[7] SHELL-BIND-01 PASS... ');
  r = await postEvent('SHELL-BIND-01', sn, 'PASS', 'SCAN');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS' : ' FAIL'));

  // Step 8: ULTRA-01 PASS (ASSY-ATE-01 not in stations table — skipped)
  process.stdout.write('[8] ULTRA-01 PASS... ');
  r = await postEvent('ULTRA-01', sn, 'PASS', 'SCAN');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS' : ' FAIL'));

  // Step 9: HIPOT-01 PASS (AGING-01 not in stations table — skipped)
  process.stdout.write('[9] HIPOT-01 PASS... ');
  r = await postEvent('HIPOT-01', sn, 'PASS', 'SCAN');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS' : ' FAIL'));

  // Step 10: PACK-ATE-01 PASS
  process.stdout.write('[10] PACK-ATE-01 PASS... ');
  r = await postEvent('PACK-ATE-01', sn, 'PASS', 'SCAN');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS' : ' FAIL'));

  // Step 11: ASM-ATE1-01 PASS (CARTON-BIND-01 not in stations table — use ASM-ATE1-01)
  process.stdout.write('[11] ASM-ATE1-01 PASS... ');
  r = await postEvent('ASM-ATE1-01', sn, 'PASS', 'SCAN');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS' : ' FAIL'));

  // Step 12: PALLET-BIND-01 PASS
  process.stdout.write('[12] PALLET-BIND-01 PASS... ');
  r = await postEvent('PALLET-BIND-01', sn, 'PASS', 'SCAN');
  console.log('status=' + r.status + (r.status === 201 || r.status === 200 ? ' PASS' : ' FAIL'));

  // Heartbeat
  process.stdout.write('[H] Heartbeat on FCT-01... ');
  const hbR = await apiReq('POST', '/mes/heartbeat/FCT-01', { operator: 'VN_OP_001', lineCode: MANUAL_LINE });
  console.log('status=' + hbR.status + (hbR.status === 200 ? ' PASS' : ' FAIL'));

  // DB verification
  process.stdout.write('[DB] Verify station_events + ng_defect_records... ');
  try {
    const evR = await pool.query("SELECT COUNT(*) as cnt FROM station_events se JOIN stations s ON s.id = se.station_id JOIN pcb_serials ps ON ps.id = se.pcb_serial_id WHERE ps.serial_no = $1", [sn]);
    const ngR = await pool.query("SELECT COUNT(*) as cnt FROM ng_defect_records WHERE sn = $1", [sn]);
    console.log('station_events=' + evR.rows[0].cnt + ' ng_defect_records=' + ngR.rows[0].cnt);
    if (parseInt(evR.rows[0].cnt) >= 10 && parseInt(ngR.rows[0].cnt) >= 1) { console.log('    PASS'); passed++; }
    else { console.log('    FAIL'); failed++; }
  } catch(e) { console.log('    FAIL: ' + e.message); failed++; }

  // Cleanup
  process.stdout.write('[Cleanup] DELETE test data... ');
  try {
    await pool.query("DELETE FROM station_events WHERE pcb_serial_id IN (SELECT id FROM pcb_serials WHERE serial_no LIKE 'TEST-%')");
    await pool.query("DELETE FROM pcb_serials WHERE serial_no LIKE 'TEST-%'");
    await pool.query("DELETE FROM ng_defect_records WHERE sn LIKE 'TEST-%'");
    console.log('PASS');
    passed++;
  } catch(e) { console.log('FAIL: ' + e.message); failed++; }

  await pool.end();
  console.log('\n' + '='.repeat(50));
  console.log('RESULT: ' + passed + ' passed / ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
