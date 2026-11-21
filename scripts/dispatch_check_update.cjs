const http = require('http');
const { Pool } = require('pg');

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 8080, path, method: 'GET' }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

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

(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

  // 1. Check API before
  const before = await apiGet('/api/dispatch/sessions/4');
  const session = before.session || before;
  console.log('BEFORE:');
  console.log('  progress.loaded:', session.progress?.loaded);
  console.log('  progress.total:', session.progress?.total);
  const liNaBefore = session.assignments.filter(a => a.assignedPda === 'PDA002' && a.status === 'loaded').length;
  console.log('  Li Na loaded:', liNaBefore);

  // 2. DB: mark 2 pending Li Na items as loaded
  const client = await pool.connect();
  const result = await client.query(`SELECT id, material_code, assigned_operator FROM material_dispatch_assignments WHERE dispatch_session_id=4 AND status='pending' AND assigned_operator='Li Na' ORDER BY id LIMIT 2`);
  console.log('\nWill load:', result.rows.map(r => r.material_code));

  for (const row of result.rows) {
    await client.query(`UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.id]);
    console.log('  DB updated:', row.material_code);
  }

  // 3. Fire SSE event
  await postJson('/api/pda/events', { from: 'test', type: 'MATERIAL_LOADED', payload: { sessionId: 4, workOrderCode: '26061010006', operator: 'Li Na' } });
  console.log('\nSSE event fired');

  await new Promise(r => setTimeout(r, 2000));

  // 4. Check API after
  const after = await apiGet('/api/dispatch/sessions/4');
  const sessionAfter = after.session || after;
  console.log('\nAFTER (API):');
  console.log('  progress.loaded:', sessionAfter.progress?.loaded);
  console.log('  progress.total:', sessionAfter.progress?.total);
  const liNaAfter = sessionAfter.assignments.filter(a => a.assignedPda === 'PDA002' && a.status === 'loaded').length;
  console.log('  Li Na loaded:', liNaAfter);

  // 5. Check DB directly
  const dbAfter = await client.query(`SELECT COUNT(*) FROM material_dispatch_assignments WHERE dispatch_session_id=4 AND status='loaded' AND assigned_operator='Li Na'`);
  console.log('  Li Na loaded (DB):', dbAfter.rows[0].count);

  await client.release();
  await pool.end();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
