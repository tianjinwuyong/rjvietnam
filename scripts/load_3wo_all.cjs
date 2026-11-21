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

async function loadAllForSession(session, client) {
  const pending = await client.query(
    `SELECT id, material_code, assigned_operator FROM material_dispatch_assignments WHERE dispatch_session_id=$1 AND status='pending'`,
    [session.id]
  );
  console.log(`Session #${session.id} (${session.workOrderCode}): loading ${pending.rows.length} materials...`);
  for (const row of pending.rows) {
    await client.query(
      `UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [row.id]
    );
    await fireSSE('MATERIAL_LOADED', {
      sessionId: session.id, workOrderCode: session.workOrderCode,
      materialCode: row.material_code, operator: row.assigned_operator
    });
  }
  const r = await client.query(
    `SELECT COUNT(*) FILTER (WHERE status='loaded') as loaded, COUNT(*) as total FROM material_dispatch_assignments WHERE dispatch_session_id=$1`,
    [session.id]
  );
  console.log(`  Done: ${r.rows[0].loaded}/${r.rows[0].total} loaded`);
}

async function main() {
  const client = await pool.connect();
  try {
    // Step 1: Load all of session #4
    const s4 = await client.query(`SELECT id, work_order_code FROM material_dispatch_sessions WHERE id=4`);
    await loadAllForSession({ id: s4.rows[0].id, workOrderCode: s4.rows[0].work_order_code }, client);

    // Step 2: Find 2 more WOs with released status + active BOM
    // Find WOs with released status + active BOM, excluding those with active dispatch sessions
    const wos = await client.query(`
      SELECT wo.id, wo.code, b.id as bom_id
      FROM work_orders wo
      JOIN boms b ON b.product_id = wo.product_id AND b.status = 'active'
      WHERE wo.status = 'released'
        AND wo.code NOT IN (
          SELECT DISTINCT mds.work_order_code FROM material_dispatch_sessions mds WHERE mds.status = 'active'
        )
      ORDER BY wo.id LIMIT 2
    `);
    console.log('\nCreating sessions for WOs:', wos.rows.map(r => r.code).join(', '));

    for (const wo of wos.rows) {
      console.log(`\nCreating session for WO ${wo.code}...`);
      const r = await postJson('/api/dispatch/sessions', { workOrderCode: wo.code, lineCode: 'LINE-01' });
      if (r.session) {
        await loadAllForSession(r.session, client);
      } else {
        console.log(`  Failed:`, JSON.stringify(r).slice(0, 300));
      }
      await new Promise(res => setTimeout(r, 500));
    }

    console.log('\nAll done!');
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error('ERROR:', e.message));
