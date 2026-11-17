import http from 'http';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = { hostname: '127.0.0.1', port: 8080, path, method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

// Test feeder-validate with a real WO and slot
const r1 = await post('/mes/feeder-validate', {
  workOrderCode: '26061010008',
  machineCode: 'L001',
  channelCode: 'L001',
  feederCode: 'FD-F01',
  slotNo: 'F01',
  materialCode: 'R-0603-10K-1',
  operator: 'VN_OP_001'
});
console.log('Status:', r1.status);
console.log(JSON.stringify(r1.body, null, 2));
