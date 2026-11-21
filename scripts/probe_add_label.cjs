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
      res.on('end', () => resolve({ status: res.statusCode, body: resBody }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Test add/register label via ShelfIn variations ===\n');

  // ShelfIn variations - different formats
  const tests = [
    // Standard ShelfIn (this got 405 before - method not allowed)
    [{ labelId: 'TEST-SIM-001', shelfCode: 'L001A', materialCode: 'R0603-10K', qty: 5000 }],
    // Without labelId but with labelIdList
    [{ shelfCode: 'L001A', labelIdList: ['TEST-SIM-001'] }],
    // JSON string format
    [{ shelfCode: 'L001A', labelIdListJson: '["TEST-SIM-001"]' }],
    // Different shelf code
    [{ labelId: 'TEST-SIM-001', shelfCode: 'L002A' }],
    // With different label format (like the error mentioned - TEST-IN-001)
    [{ labelId: 'TEST-IN-001', shelfCode: 'L001A' }],
  ];

  for (const body of tests) {
    const r = await shelf('POST', '/api/shelf/ShelfIn', body);
    let msg = r.body.substring(0, 150);
    // Check for interesting content
    if (msg.includes('TEST-SIM') || msg.includes('不允许') || msg.includes('成功') || msg.includes('OK') || msg.includes('exists')) {
      console.log(`✅ ShelfIn: ${JSON.stringify(body)}`);
      console.log(`   → ${r.status} ${msg}`);
    } else {
      console.log(`   ShelfIn: ${JSON.stringify(body)} → ${r.status} ${msg.substring(0, 80)}`);
    }
  }

  console.log('\n=== Try light on ALL empty locations ===');
  // LightOnAllEmptyLocation works (it's the one that worked before for "空库位")
  const light = await shelf('POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode: 'L001A', color: 6 });
  console.log(`LightOnAllEmptyLocation L001A color=6: ${light.status} ${light.body.substring(0, 100)}`);
  await new Promise(r => setTimeout(r, 1000));
  const lightOff = await shelf('POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode: 'L001A', color: 0 });
  console.log(`LightOnAllEmptyLocation L001A color=0: ${lightOff.status} ${lightOff.body.substring(0, 100)}`);

  console.log('\n=== Try light on single cell with shelf code + cell ===');
  const cellOn = await shelf('POST', '/api/shelf/LightOnCell', { shelfCode: 'L001A', cellNumber: '01', color: 6 });
  console.log(`LightOnCell L001A/01 color=6: ${cellOn.status} ${cellOn.body.substring(0, 100)}`);
  await new Promise(r => setTimeout(r, 1000));
  const cellOff = await shelf('POST', '/api/shelf/LightOnCell', { shelfCode: 'L001A', cellNumber: '01', color: 0 });
  console.log(`LightOnCell L001A/01 color=0: ${cellOff.status} ${cellOff.body.substring(0, 100)}`);
}

main().catch(e => console.error('Error:', e.message));
