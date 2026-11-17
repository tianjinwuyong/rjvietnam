import { createServer } from 'http';
import { spawn } from 'child_process';

const server = spawn('node', ['services/api/server.js'], {
  cwd: 'C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\smt-factory-system',
  stdio: ['ignore', 'pipe', 'pipe']
});

let log = '';
server.stdout.on('data', d => { log += d.toString(); process.stdout.write(d); });
server.stderr.on('data', d => { log += d.toString(); process.stderr.write(d); });

// Wait for server to start
await new Promise(r => setTimeout(r, 5000));

// Call feeder-validate
const http = await import('http');
const opts = { hostname: '127.0.0.1', port: 8080, path: '/mes/feeder-validate', method: 'POST', headers: { 'Content-Type': 'application/json' } };
const body = JSON.stringify({ workOrderCode: '26061010008', machineCode: 'ST-L001-01', channelCode: 'L001', feederCode: 'FD-F01', slotNo: 'F01', materialCode: 'R-0603-10K-1', operator: 'VN_OP_001' });
const req = http.request(opts, res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    console.log('\n=== RESPONSE ===');
    console.log('Status:', res.statusCode);
    console.log(JSON.stringify(JSON.parse(d), null, 2));
    console.log('\n=== SERVER LOG ===');
    console.log(log);
    server.kill();
    process.exit(0);
  });
});
req.on('error', e => { console.error(e.message); server.kill(); process.exit(1); });
req.write(body); req.end();
