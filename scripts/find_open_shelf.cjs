const http = require('http');

function shelf(method, path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Try all shelf codes to find one that accepts new labels
  const shelfCodes = ['L002A','L002B','L003A','L003B','L004A','L004B','L005A','L005B'];

  console.log('=== Find shelf that accepts new labels ===\n');

  for (const shelfCode of shelfCodes) {
    const r = await shelf('POST', '/api/shelf/ShelfIn', { labelId: `TEST-${shelfCode}`, shelfCode, materialCode: 'R0603-10K', qty: 5000 });
    const msg = r.body.substring(0, 150);
    const ok = msg.includes('"OK"') || msg.includes('成功');
    const blocked = msg.includes('不允许') || msg.includes('还未上架');
    console.log(`${ok ? '✅' : blocked ? '🔒' : '❌'} ShelfIn ${shelfCode}: ${msg}`);
    if (ok) {
      // Try ShelfOut on this label
      await sleep(300);
      const out = await shelf('POST', '/api/shelf/ShelfOut', { labelIdList: [`TEST-${shelfCode}`], color: 6 });
      console.log(`   ✅ ShelfOut ${`TEST-${shelfCode}`} color=6: ${out.status} ${out.body.substring(0, 100)}`);
      await sleep(1000);
      await shelf('POST', '/api/shelf/ShelfOut', { labelIdList: [`TEST-${shelfCode}`], color: 0 });
    }
  }

  // Also test: maybe we need to use a different shelf in L001A after TEST-IN-001 is cleared
  // Let's check if we can "complete" TEST-IN-001 via InventoryRemoveLable
  console.log('\n=== Try to clear TEST-IN-001 from L001A ===');
  const rem = await shelf('POST', '/api/shelf/InventoryRemoveLable', { labelId: 'TEST-IN-001' });
  console.log(`InventoryRemoveLable TEST-IN-001: ${rem.status} ${rem.body.substring(0, 200)}`);

  // Then try L001A again
  await sleep(300);
  console.log('\n=== Retry L001A after remove ===');
  const retry = await shelf('POST', '/api/shelf/ShelfIn', { labelId: 'NEW-LABEL-001', shelfCode: 'L001A', materialCode: 'R0603-10K', qty: 5000 });
  console.log(`L001A with NEW-LABEL-001: ${retry.status} ${retry.body.substring(0, 200)}`);
}

main().catch(e => console.error('Error:', e.message));
