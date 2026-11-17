const http = require('http');

const req = (method, path, body, headers) => new Promise((res, rej) => {
  const h = Object.assign({}, headers || {});
  if (body) h['Content-Type'] = 'application/json';
  const r = http.request({ hostname: '127.0.0.1', port: 8080, path, method, headers: h }, x => {
    let d = '';
    x.on('data', c => d += c);
    x.on('end', () => {
      try { res({ s: x.statusCode, b: JSON.parse(d) }); }
      catch { res({ s: x.statusCode, b: d }); }
    });
  });
  r.on('error', rej);
  if (body) r.write(JSON.stringify(body));
  r.end();
});

(async () => {
  const lr = await req('POST', '/auth/login', { username: 'VN_OP_001', password: 'Factory@123' });
  const t = lr.b && lr.b.data && lr.b.data.token;
  const auth = { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' };

  const probStations = ['ASSY-ATE-01', 'AGING-01', 'CARTON-BIND-01'];
  for (const sc of probStations) {
    const r = await req('POST', '/mes/events', { payload: { stationCode: sc, pcbSerial: 'TEST-DEBUG', result: 'PASS', eventType: 'SCAN', lineCode: 'MANUAL-LINE' } }, auth);
    console.log(sc + ':', r.s, typeof r.b === 'object' ? JSON.stringify(r.b) : r.b);
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
