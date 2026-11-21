// Full 33-station integration test via HTTP API
// Run: node tests/full-station-test.js
// Tests /mes/events (POST NG) + /mes/ng-registry/check (GET with lineCode)

const BASE = 'http://localhost:8080/api';
const TEST_SN = 'FULL-TEST-' + Date.now();

const stations = [
  // SMT-LINE
  { stationCode: 'AI-VERT-01',  lineCode: 'SMT-LINE',   seq: 1, parent: null },
  { stationCode: 'PRINT-01',    lineCode: 'SMT-LINE',   seq: 3, parent: null },
  { stationCode: 'SPI-01',      lineCode: 'SMT-LINE',   seq: 4, parent: null },
  { stationCode: 'NXT-01',      lineCode: 'SMT-LINE',   seq: 5, parent: null },
  { stationCode: 'SMT-AOI-01',  lineCode: 'SMT-LINE',   seq: 6, parent: null },
  { stationCode: 'PDA-01',      lineCode: 'SMT-LINE',   seq: 7, parent: null },
  // AUTO-LINE
  { stationCode: 'PDA-01',      lineCode: 'AUTO-LINE',  seq: 1, parent: null },
  { stationCode: 'AOI-01',      lineCode: 'AUTO-LINE',  seq: 2, parent: null },
  { stationCode: 'ICT-01',      lineCode: 'AUTO-LINE',  seq: 3, parent: null },
  { stationCode: 'FCT-01',      lineCode: 'AUTO-LINE',  seq: 4, parent: null },
  { stationCode: 'DEPANEL-01',  lineCode: 'AUTO-LINE',  seq: 5, parent: null },
  { stationCode: 'SHELL-BIND-01',lineCode:'AUTO-LINE',  seq: 6, parent: null },
  { stationCode: 'ASSY-ATE-01', lineCode: 'AUTO-LINE',  seq: 7, parent: null },
  { stationCode: 'ULTRA-01',    lineCode: 'AUTO-LINE',  seq: 8, parent: null },
  { stationCode: 'AGING-01',    lineCode: 'AUTO-LINE',  seq: 9, parent: null },
  // MANUAL-LINE
  { stationCode: 'PDA-01',      lineCode: 'MANUAL-LINE', seq: 1,  parent: null },
  { stationCode: 'AOI-01',      lineCode: 'MANUAL-LINE', seq: 2,  parent: null },
  { stationCode: 'ICT-01',      lineCode: 'MANUAL-LINE', seq: 3,  parent: null },
  { stationCode: 'FCT-01',      lineCode: 'MANUAL-LINE', seq: 4,  parent: null },
  { stationCode: 'DEPANEL-01',  lineCode: 'MANUAL-LINE', seq: 5,  parent: null },
  { stationCode: 'SHELL-BIND-01',lineCode:'MANUAL-LINE', seq: 6,  parent: null },
  { stationCode: 'ASSY-ATE-01', lineCode: 'MANUAL-LINE', seq: 7,  parent: null },
  { stationCode: 'ULTRA-01',    lineCode: 'MANUAL-LINE', seq: 8,  parent: null },
  { stationCode: 'AGING-01',    lineCode: 'MANUAL-LINE', seq: 9,  parent: null },
  { stationCode: 'HIPOT-01',    lineCode: 'MANUAL-LINE', seq: 10, parent: null },
  { stationCode: 'PACK-ATE-01', lineCode: 'MANUAL-LINE', seq: 11, parent: null },
  { stationCode: 'CARTON-BIND-01',lineCode:'MANUAL-LINE',seq: 12, parent: null },
  { stationCode: 'PALLET-BIND-01',lineCode:'MANUAL-LINE',seq: 13, parent: null },
  // PACK-LINE (parent=AUTO-LINE)
  { stationCode: 'HIPOT-PACK-01', lineCode: 'PACK-LINE', seq: 1, parent: 'AUTO-LINE' },
  { stationCode: 'PACK-ATE-01',   lineCode: 'PACK-LINE', seq: 2, parent: 'AUTO-LINE' },
  { stationCode: 'CARTON-BIND-01',lineCode: 'PACK-LINE', seq: 3, parent: 'AUTO-LINE' },
  { stationCode: 'PALLET-BIND-01',lineCode: 'PACK-LINE', seq: 4, parent: 'AUTO-LINE' },
];

async function api(path, opts = {}) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: r.status, body: json };
  } catch (e) {
    return { status: -1, body: { error: e.message } };
  }
}

async function run() {
  let passed = 0, failed = 0;

  // Step 1: POST NG at ICT-01 via /mes/events
  console.log('\n[1] POST FAIL NG at ICT-01 (AUTO-LINE seq=3) via /mes/events...');
  const seed = await api('/mes/events', {
    method: 'POST',
    body: {
      action: 'station_scan',
      payload: {
        stationCode: 'ICT-01',
        pcbSerial: TEST_SN,
        result: 'fail',
        errorCode: 'ERR-SEQ3',
        channel: 'CH-A',
        operator: 'test_op',
        source: 'test',
        lineName: '自动线',
      },
    },
  });
  console.log(`    Status: ${seed.status}  code=${seed.body.code}  id=${seed.body.data?.ngDefectId}`);
  if (seed.status === 200 || seed.status === 201) { console.log('    ✓'); passed++; }
  else { console.log('    ✗ FAIL —', seed.body.error || seed.body.message || JSON.stringify(seed.body).substring(0,100)); failed++; }

  // Step 2: Test all stations via GET /ng-registry/check
  console.log('\n[2] GET /ng-registry/check for all 33 stations...');
  console.log('─'.repeat(90));
  console.log(`${'Station'.padEnd(20)} ${'Line'.padEnd(14)} ${'Seq'} ${'Count'}  ${'Expected'}`);
  console.log('─'.repeat(90));

  for (const s of stations) {
    const r = await api(`/mes/ng-registry/check?sn=${TEST_SN}&stationCode=${s.stationCode}&lineCode=${s.lineCode}`);
    const count = r.body.data?.count ?? -1;
    let expected;
    if (s.lineCode === 'AUTO-LINE' && s.seq > 3) expected = 1;
    else if (s.lineCode === 'PACK-LINE') expected = 1;
    else if (s.lineCode === 'MANUAL-LINE') expected = 0;
    else expected = 0;

    const ok = count === expected;
    if (ok) passed++; else failed++;
    console.log(
      `${s.stationCode.padEnd(20)} ${s.lineCode.padEnd(14)} ${String(s.seq).padStart(3)} ${String(count).padStart(5)}  ${String(expected).padStart(8)}  ${ok ? '✓' : '✗ FAIL'}`,
    );
    if (!ok) console.log(`    Response:`, JSON.stringify(r.body).substring(0, 200));
  }

  // Step 3: PACK-LINE parent inheritance
  console.log('\n[3] PACK-LINE parent check (HIPOT-PACK-01 should see AUTO-LINE NG)...');
  const pack = await api(`/mes/ng-registry/check?sn=${TEST_SN}&stationCode=HIPOT-PACK-01&lineCode=PACK-LINE`);
  const packCount = pack.body.data?.count ?? -1;
  const fromParent = (pack.body.data?.records || []).filter(r => r.lineCode === 'AUTO-LINE').length;
  console.log(`    count=${packCount}  from_parent=${fromParent}  ${packCount === 1 && fromParent === 1 ? '✓' : '✗ FAIL'}`);
  if (packCount === 1 && fromParent === 1) passed++; else failed++;

  // Step 4: FCT-01 upstream
  console.log('\n[4] FCT-01 (AUTO-LINE seq=4) upstream NG...');
  const fct = await api(`/mes/ng-registry/check?sn=${TEST_SN}&stationCode=FCT-01&lineCode=AUTO-LINE`);
  const fctCount = fct.body.data?.count ?? -1;
  console.log(`    count=${fctCount}  expected=1  ${fctCount === 1 ? '✓' : '✗ FAIL'}`);
  if (fctCount === 1) passed++; else failed++;

  // Step 5: AOI-01 upstream (should be 0)
  console.log('\n[5] AOI-01 (AUTO-LINE seq=2) upstream NG...');
  const aoi = await api(`/mes/ng-registry/check?sn=${TEST_SN}&stationCode=AOI-01&lineCode=AUTO-LINE`);
  const aoiCount = aoi.body.data?.count ?? -1;
  console.log(`    count=${aoiCount}  expected=0  ${aoiCount === 0 ? '✓' : '✗ FAIL'}`);
  if (aoiCount === 0) passed++; else failed++;

  // Step 6: No lineCode → 400
  console.log('\n[6] /ng-registry/check without lineCode → 400...');
  const bad = await api(`/mes/ng-registry/check?sn=${TEST_SN}&stationCode=FCT-01`);
  console.log(`    status=${bad.status}  expected=400  ${bad.status === 400 ? '✓' : '✗ FAIL'}`);
  if (bad.status === 400) passed++; else failed++;

  console.log('\n' + '═'.repeat(50));
  console.log(`TOTAL: ${passed} passed / ${failed} failed / ${stations.length + 6} tests`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
