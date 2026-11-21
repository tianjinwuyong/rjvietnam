const http = require('http');

function shelfReq(method, path, body) {
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
        catch (e) { resolve({ status: res.statusCode, data: resBody }); }
      });
    });
    req.on('error', e => reject(e));
    if (data !== '{}') req.write(data);
    req.end();
  });
}

function shelfGet(path) { return shelfReq('GET', path, null); }
function shelfPost(path, body) { return shelfReq('POST', path, body); }

async function main() {
  console.log('=== Check Smart Shelf Controller Inventory ===\n');

  // Check if there's an inventory or label list endpoint
  const endpoints = [
    '/api/shelf/list',
    '/api/shelf/inventory',
    '/api/shelf/labels',
    '/api/shelf/status',
  ];
  for (const ep of endpoints) {
    try {
      const r = await shelfGet(ep);
      console.log(`GET ${ep}:`, r.status, typeof r.data === 'string' ? r.data.substring(0, 100) : JSON.stringify(r.data).substring(0, 200));
    } catch(e) { console.log(`GET ${ep}: ERROR ${e.message}`); }
  }

  // Try ShelfIn with a test label to see if it accepts it
  console.log('\n--- Test ShelfIn with S4 label ---');
  const inRes = await shelfPost('/api/shelf/ShelfIn', {
    labelId: 'S4-R0212-01046',
    shelfCode: 'L001A',
    materialCode: 'R0212-01046',
    qty: 5000
  });
  console.log('ShelfIn result:', JSON.stringify(inRes));

  // Now try ShelfOut with that label
  await new Promise(r => setTimeout(r, 500));
  console.log('\n--- Test ShelfOut with S4 label (after ShelfIn) ---');
  const outRes = await shelfPost('/api/shelf/ShelfOut', {
    labelIdList: ['S4-R0212-01046'],
    color: 6
  });
  console.log('ShelfOut result:', JSON.stringify(outRes));

  // Turn off
  await new Promise(r => setTimeout(r, 1000));
  const offRes = await shelfPost('/api/shelf/ShelfOut', {
    labelIdList: ['S4-R0212-01046'],
    color: 0
  });
  console.log('ShelfOut off:', JSON.stringify(offRes));

  // Now try with a label that exists in the shelf's own inventory
  // Check what label format the shelf uses
  console.log('\n--- Check T_ShelfAndLabelInfo via ShelfOutGY ---');
  const gyRes = await shelfPost('/api/shelf/ShelfOutGY', {
    labelIdList: ['TSN00001'],
    color: 0
  });
  console.log('ShelfOutGY (probe):', JSON.stringify(gyRes));
}

main().catch(e => console.error('Error:', e.message));
