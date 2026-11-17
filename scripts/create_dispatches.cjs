const http = require('http');

function api(path, method = 'GET', body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({ hostname: 'localhost', port: 8080, path, method, headers }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Login
  const loginRes = await api('/auth/login', 'POST', { username: 'PMC_CN_01', password: 'Factory@123' });
  let login;
  try { login = JSON.parse(loginRes.body); } catch { console.log('Login error:', loginRes.body); return; }
  const token = login.data?.token || login.token;
  if (!token) { console.log('No token:', loginRes.body.substring(0, 300)); return; }
  console.log('Logged in as PMC_CN_01');

  // List work orders - try both paths
  for (const p of ['/pmc/work-orders', '/work-orders', '/mes/work-orders']) {
    const r = await api(p, 'GET', null, token);
    console.log(p, r.status, r.body.substring(0, 300));
  }
}

main().catch(e => console.error(e.message));
