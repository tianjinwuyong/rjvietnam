const http = require('http');

function postFeederLoading(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost', port: 8080, path: '/mes/feeder-loading',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          console.log(`  [${payload.operator}] ${payload.materialCode} → slot ${payload.slotNo}: ${res.statusCode === 200 ? 'OK' : 'FAIL'}`);
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Simulate loading events for session 4
// Materials already loaded: R0304-01003 (Li Na), etc.
// We'll load a few more pending ones for each operator
const loadEvents = [
  // Li Na (PDA002) - load 2 more materials
  { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'A1', feederCode: 'F001', lotNo: 'LOT-LN-01', labelId: null, materialCode: 'C0805-10450', qty: 500, operator: 'Li Na' },
  { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'A2', feederCode: 'F002', lotNo: 'LOT-LN-02', labelId: null, materialCode: 'R0402-10310', qty: 1000, operator: 'Li Na' },

  // Wang Qiang (PDA003) - load 2 materials
  { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'B1', feederCode: 'F003', lotNo: 'LOT-WQ-01', labelId: null, materialCode: 'C0603-10500', qty: 300, operator: 'Wang Qiang' },
  { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'B2', feederCode: 'F004', lotNo: 'LOT-WQ-02', labelId: null, materialCode: 'R0402-10100', qty: 800, operator: 'Wang Qiang' },

  // Zhang Wei (PDA001) - already full (54/54), skip
  // Chen Jie (PDA004) - already full (53/53), skip

  // Li Na again
  { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'A3', feederCode: 'F005', lotNo: 'LOT-LN-03', labelId: null, materialCode: 'C0402-10220', qty: 200, operator: 'Li Na' },

  // Wang Qiang again
  { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'B3', feederCode: 'F006', lotNo: 'LOT-WQ-03', labelId: null, materialCode: 'R0603-10470', qty: 600, operator: 'Wang Qiang' },
];

(async () => {
  console.log('Firing feeder loading events...\n');
  for (const event of loadEvents) {
    await postFeederLoading(event);
    await new Promise(r => setTimeout(r, 2000)); // 2s between events
  }
  console.log('\nAll done. Board should show updated bars.');
})().catch(e => console.error('Error:', e.message));
