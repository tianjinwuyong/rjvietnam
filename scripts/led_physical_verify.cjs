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
  const racks = ['L001A', 'L001B', 'L002A', 'L002B'];

  console.log('=== Smart Rack LED Physical Verification ===');
  console.log('Watch the rack LEDs! They should light up cyan (color=6) one by one.\n');

  // Light each rack sequentially
  for (const rack of racks) {
    process.stdout.write(`  ${rack} color=6 (cyan)... `);
    const r = await shelf('POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode: rack, color: 6 });
    const ok = r.body.includes('OK') || r.body.includes('成功');
    console.log(ok ? 'OK' : 'FAIL: ' + r.body.substring(0, 60));
    await sleep(800);
  }

  console.log('\n  All lit. Stay ON for 3 seconds...');
  await sleep(3000);

  // Turn all off
  console.log('\n=== Turning all OFF ===');
  for (const rack of racks) {
    await shelf('POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode: rack, color: 0 });
    process.stdout.write(`  ${rack} off. `);
    await sleep(300);
  }

  console.log('\n\nDone. Did you see the LEDs light up?');
}

main().catch(e => console.error('Error:', e.message));
