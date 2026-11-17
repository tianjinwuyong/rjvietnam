import http from 'http';
const body = JSON.stringify({ workOrderCode: '26061010008', operator: 'VN_OP_001', lineCode: 'L001' });
const opts = { hostname: '127.0.0.1', port: 8080, path: '/mes/work-start', method: 'POST', headers: { 'Content-Type': 'application/json' } };
const req = http.request(opts, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try { console.log(JSON.stringify(JSON.parse(d), null, 2)); }
    catch { console.log(d); }
  });
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
