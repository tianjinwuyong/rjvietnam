const http = require('http');
const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

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

function fireSSE(type, payload) {
  return postJson('/api/pda/events', { from: 'test_script', type, payload });
}

async function main() {
  const client = await pool.connect();
  try {
    // Find 3 work orders with released status that have BOM materials
    const wos = await client.query(`
      SELECT wo.id, wo.code, wo.product_id, b.id as bom_id
      FROM work_orders wo
      JOIN boms b ON b.product_id = wo.product_id AND b.status = 'active'
      WHERE wo.status = 'released' AND wo.id != 10
      ORDER BY wo.id
      LIMIT 3
    `);
    console.log('Will create sessions for:');
    wos.rows.forEach(r => console.log(`  #${r.id} ${r.code} product=${r.product_id} bom=${r.bom_id}`));

    const sessions = [];
    for (const wo of wos.rows) {
      console.log(`\nCreating session for WO ${wo.code}...`);
      const r = await postJson('/api/dispatch/sessions', { workOrderCode: wo.code, lineCode: 'LINE-01' });
      if (r.session) {
        sessions.push(r.session);
        console.log(`  Session #${r.session.id} - ${r.session.assignments?.length ?? 0} assignments`);
      } else {
        console.log(`  Failed:`, JSON.stringify(r).slice(0, 200));
      }
    }

    console.log(`\n${sessions.length} sessions created. Loading all materials...`);

    for (const sess of sessions) {
      const pending = sess.assignments?.filter(a => a.status === 'pending') || [];
      console.log(`\nSession #${sess.id} (${sess.workOrderCode}): ${pending.length} pending materials`);
      for (const a of pending) {
        await client.query(
          `UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`,
          [a.id]
        );
        await fireSSE('MATERIAL_LOADED', {
          sessionId: sess.id, workOrderCode: sess.workOrderCode,
          materialCode: a.materialCode, operator: a.assignedOperator
        });
      }
      // Brief pause between sessions
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\nAll materials loaded!');
    for (const sess of sessions) {
      const r = await client.query(
        `SELECT COUNT(*) FILTER (WHERE status='loaded') as loaded, COUNT(*) as total FROM material_dispatch_assignments WHERE dispatch_session_id=$1`,
        [sess.id]
      );
      console.log(`  Session #${sess.id} (${sess.workOrderCode}): ${r.rows[0].loaded}/${r.rows[0].total} loaded`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error('ERROR:', e.message));
