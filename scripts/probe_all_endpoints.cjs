const http = require('http');

function shelf(method, path, body) {
  return new Promise((resolve, reject) => {
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
    req.on('error', e => reject(e));
    if (data !== '{}') req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Full shelf controller probe ===\n');

  // Try all shelf endpoints
  const endpoints = [
    // Inventory management
    ['POST', '/api/shelf/InventoryAddLabel', { labelId: 'TSN00001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/InventoryAddLabel', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/InventoryAdd', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/LabelRegister', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/RegisterLabel', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    // Put label on shelf (same as ShelfIn but different name)
    ['POST', '/api/shelf/PutLabel', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/StoreLabel', { labelId: 'TEST-FAKE-001', shelfCode: 'L001A' }],
    // Light on specific cell
    ['POST', '/api/shelf/LightOn', { shelfCode: 'L001A', cellNumber: '01', color: 6 }],
    ['POST', '/api/shelf/LightOnCell', { shelfCode: 'L001A', cellNumber: '01', color: 6 }],
    ['POST', '/api/shelf/LightOnLocation', { shelfCode: 'L001A', cellNumber: '01', color: 6 }],
    // Batch shelf out
    ['POST', '/api/shelf/BatchShelfOut', { labelIdList: ['TSN00001'], color: 6 }],
    // Inventory list
    ['GET', '/api/shelf/Inventory', null],
    ['GET', '/api/shelf/Labels', null],
    ['GET', '/api/shelf/T_ShelfAndLabelInfo', null],
    ['GET', '/api/shelf/AllLabels', null],
    // Existing known endpoint variations
    ['POST', '/api/shelf/ShelfOutGY', { labelIdList: ['TSN00001'], color: 6 }],
    ['POST', '/api/shelf/ShelfOutGY', { labelIdList: ['TEST-FAKE-001'], color: 6 }],
  ];

  for (const [method, path, body] of endpoints) {
    const r = await shelf(method, path, body);
    const d = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    const prefix = r.status === 200 && d.includes('"OK"') ? '✅' : r.status === 200 ? '⚠️' : '❌';
    console.log(`${prefix} ${method} ${path}`);
    if (body) console.log(`   body: ${JSON.stringify(body)}`);
    console.log(`   → ${r.status} ${d.substring(0, 120)}`);
  }
}

main().catch(e => console.error('Error:', e.message));
