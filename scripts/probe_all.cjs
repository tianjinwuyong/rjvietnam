const http = require('http');

function shelf(method, path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      hostname: '192.168.6.118', port: 8093,
      path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(resBody) }); }
        catch (e) { resolve({ status: res.statusCode, raw: resBody.substring(0, 300) }); }
      });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    if (data !== '{}') req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Full shelf controller probe ===\n');

  const tests = [
    ['POST', '/api/shelf/InventoryAddLabel', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/InventoryAdd', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/LabelRegister', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/PutLabel', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/LightOn', { shelfCode: 'L001A', cellNumber: '01', color: 6 }],
    ['POST', '/api/shelf/LightOnCell', { shelfCode: 'L001A', cellNumber: '01', color: 6 }],
    ['POST', '/api/shelf/BatchShelfOut', { labelIdList: ['TSN00001'], color: 6 }],
    ['GET', '/api/shelf/Inventory', null],
    ['GET', '/api/shelf/Labels', null],
    ['GET', '/api/shelf/T_ShelfAndLabelInfo', null],
    ['GET', '/api/shelf/AllLabels', null],
    ['POST', '/api/shelf/ShelfOutGY', { labelIdList: ['TSN00001'], color: 6 }],
    ['POST', '/api/shelf/ShelfOutGY', { labelIdList: ['TEST-FAKE-001'], color: 6 }],
    ['POST', '/api/shelf/InventoryRemoveLable', { labelId: 'TEST-FAKE-001' }],
  ];

  for (const [method, path, body] of tests) {
    const r = await shelf(method, path, body);
    const d = r.error || (typeof r.data === 'string' ? r.data : JSON.stringify(r.data || r.raw || ''));
    const ok = r.status === 200 && d.includes('"Result":"OK"');
    const ng = r.status === 200 && d.includes('"Result":"NG"');
    const prefix = ok ? '✅' : ng ? '⚠️' : r.status === 0 ? '❌' : '?';
    console.log(`${prefix} ${method} ${path}`);
    if (body) console.log(`   ${JSON.stringify(body)}`);
    console.log(`   → ${r.status} ${d.substring(0, 150)}`);
  }
}

main().catch(e => console.error('Error:', e.message));
