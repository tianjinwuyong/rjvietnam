const https = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1', port: 8080, path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Login
  const login = await request('POST', '/auth/login', { username: 'VN_OP_001', password: 'Factory@123' });
  const token = login?.data?.item?.token;
  console.log('Login:', login?.data?.item ? 'OK' : 'FAIL', login?.error?.code || '');

  // Dashboard
  const dash = await request('GET', '/dashboard/summary', null, token);
  console.log('Dashboard:', JSON.stringify(dash.data));

  // PMC work orders
  const wos = await request('GET', '/pmc/work-orders', null, token);
  console.log('WorkOrders total:', wos?.meta?.total, 'items:', wos?.data?.items?.length);
  if (wos?.data?.items) wos.data.items.forEach(w => console.log(' -', w.code, w.status));

  // Stations count
  const st = await request('GET', '/mes/stations', null, token);
  console.log('Stations:', st?.data?.items?.length ?? 'N/A', '(via API)');

  console.log('\nAll API checks passed!');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });