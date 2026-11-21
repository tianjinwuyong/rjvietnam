const http = require('http');

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost', port: 8080, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const wos = ['26061010003', '26061010010'];
  for (const wo of wos) {
    console.log(`Creating session for ${wo}...`);
    try {
      const r = await postJson('/api/dispatch/sessions', { workOrderCode: wo, lineCode: 'LINE-01' });
      if (r.session) {
        console.log(`  OK: session #${r.session.id}, ${r.session.assignments?.length} assignments`);
      } else {
        console.log(`  Failed:`, JSON.stringify(r).slice(0, 200));
      }
    } catch (e) {
      console.log(`  Error:`, e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}
main();
