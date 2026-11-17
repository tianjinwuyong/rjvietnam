const http = require('http');

function shelf(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '192.168.6.118', port: 8093,
      path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => resolve({ status: res.statusCode, body: resBody }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const paths = [
    ['POST', '/api/shelf/ShelfOut', { labelIdList: ['TEST'], color: 6 }],
    ['POST', '/api/shelf/shelf-out', { labelIdList: ['TEST'], color: 6 }],
    ['POST', '/api/shelf/LightOff', { labelIdList: ['TEST'] }],
    ['POST', '/api/shelf/LightOut', { labelIdList: ['TEST'], color: 0 }],
    ['POST', '/api/shelf/LedOn', { labelId: 'TEST', color: 6 }],
    ['POST', '/api/shelf/LedControl', { labelId: 'TEST', color: 6 }],
    ['POST', '/api/shelf/ShelfOutGY', { labelIdList: ['TEST'], color: 6 }],
    ['POST', '/api/shelf/CellLightOn', { shelfCode: 'L001A', cellNumber: '01', color: 6 }],
    ['POST', '/api/shelf/CellLight', { shelfCode: 'L001A', cellNumber: '01', color: 6 }],
    ['POST', '/api/shelf/LightOnAll', { shelfCode: 'L001A', color: 6 }],
    ['POST', '/api/shelf/InventoryOut', { labelIdList: ['TEST'], color: 6 }],
    ['POST', '/api/shelf/InventoryAdd', { labelId: 'TEST', shelfCode: 'L001A' }],
    ['GET', '/api/shelf/ShelfOut', null],
    ['GET', '/api/shelf/list', null],
    ['GET', '/api/shelf/status', null],
  ];

  const results = [];
  for (const [method, path, body] of paths) {
    const r = await shelf(method, path, body);
    const b = r.body || '';
    const ok = b.includes('OK') || b.includes('成功');
    const ng = b.includes('NG');
    const prefix = ok ? 'OK' : ng ? 'NG' : '??';
    if (!b.includes('404')) results.push(`${prefix} ${method} ${path}: ${b.substring(0, 100)}`);
  }

  console.log('=== Non-404 responses ===');
  results.forEach(r => console.log(r));

  // Test LightOnAllEmptyLocation with all colors
  console.log('\n=== LightOnAllEmptyLocation color test ===');
  for (const color of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const r = await shelf('POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode: 'L001A', color });
    console.log(`  L001A color=${color}: ${r.body.includes('OK') || r.body.includes('成功') ? 'OK' : r.body.substring(0, 60)}`);
    await sleep(400);
  }
  await shelf('POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode: 'L001A', color: 0 });
  await shelf('POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode: 'L002A', color: 0 });
}

main().catch(e => console.error('Error:', e.message));
