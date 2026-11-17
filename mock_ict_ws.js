// Mock ICT WebSocket server on port 1004 — for testing ICT Bridge locally
const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 1004 });
console.log('[ICT Mock] WS server running on ws://localhost:1004');

wss.on('connection', (ws) => {
  console.log('[ICT Mock] Client connected');
  ws.send(JSON.stringify({ type: 'connected', msg: 'ICT mock server ready' }));

  // Send a test NG event after 2s
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'ng', sn: 'TEST-MOCK-001', errorcode: 'MOCK-001', operator: 'mock_op' }));
    console.log('[ICT Mock] Sent NG: TEST-MOCK-001');
  }, 2000);

  // Send more events every 10s
  let count = 2;
  const interval = setInterval(() => {
    const result = Math.random() < 0.4 ? 'ng' : 'pass';
    const sn = `TEST-MOCK-${String(count).padStart(3, '0')}`;
    ws.send(JSON.stringify({
      type: result,
      sn,
      errorcode: result === 'ng' ? `MOCK-${count}` : undefined,
      operator: 'mock_op'
    }));
    console.log(`[ICT Mock] Sent ${result.toUpperCase()}: ${sn}`);
    count++;
  }, 10000);

  ws.on('close', () => {
    clearInterval(interval);
    console.log('[ICT Mock] Client disconnected');
  });
});
