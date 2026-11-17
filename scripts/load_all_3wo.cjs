const { Pool } = require('pg');
const http = require('http');

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
  return postJson('/api/pda/events', { from: 'bulk_load', type, payload });
}

async function main() {
  const client = await pool.connect();
  try {
    // Get all active sessions (4, 5, 6)
    const sessions = await client.query(`SELECT id, work_order_code FROM material_dispatch_sessions WHERE status='active' ORDER BY id`);
    console.log('Active sessions:', sessions.rows.map(r => `#${r.id} ${r.work_order_code}`).join(', '));

    for (const sess of sessions.rows) {
      // Check if session already has assignments
      const existingCount = await client.query(`SELECT COUNT(*) as c FROM material_dispatch_assignments WHERE dispatch_session_id=$1`, [sess.id]);
      if (parseInt(existingCount.rows[0].c) > 0) {
        console.log(`\nSession #${sess.id} (${sess.work_order_code}): already has ${existingCount.rows[0].c} assignments, skipping creation`);
        continue;
      }

      console.log(`\nSession #${sess.id} (${sess.work_order_code}): creating assignments from BOM...`);

      // Get BOM materials for this work order's product
      const bomRows = await client.query(`
        SELECT bl.material_id, m.code AS material_code, m.name_zh AS material_name_zh,
               bl.qty_per, bl.loss_rate, wo.planned_qty
        FROM work_orders wo
        JOIN boms b ON b.product_id = wo.product_id AND b.status = 'active'
        JOIN bom_lines bl ON bl.bom_id = b.id
        JOIN materials m ON m.id = bl.material_id
        WHERE wo.code = $1
      `, [sess.work_order_code]);

      console.log(`  BOM materials: ${bomRows.rows.length}`);
      if (!bomRows.rows.length) {
        console.log(`  WARNING: No BOM materials found for ${sess.work_order_code}!`);
        continue;
      }

      const materials = bomRows.rows.map(row => ({
        materialId: row.material_id,
        materialCode: row.material_code,
        materialNameZh: row.material_name_zh,
      }));

      // Insert assignments
      for (const mat of materials) {
        await client.query(`
          INSERT INTO material_dispatch_assignments
            (dispatch_session_id, material_code, material_name_zh, smt_flag, status)
          VALUES ($1, $2, $3, 'SMT', 'pending')
        `, [sess.id, mat.materialCode, mat.materialNameZh]);
      }

      console.log(`  Created ${materials.length} assignments`);
    }

    // Now load all materials for all sessions
    console.log('\n=== Loading all materials ===');
    for (const sess of sessions.rows) {
      const pending = await client.query(
        `SELECT id, material_code, assigned_operator FROM material_dispatch_assignments WHERE dispatch_session_id=$1 AND status='pending'`,
        [sess.id]
      );
      console.log(`Session #${sess.id}: loading ${pending.rows.length} materials...`);

      let count = 0;
      for (const row of pending.rows) {
        await client.query(
          `UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`,
          [row.id]
        );
        fireSSE('MATERIAL_LOADED', {
          sessionId: sess.id, workOrderCode: sess.work_order_code,
          materialCode: row.material_code, operator: row.assigned_operator || 'System'
        });
        count++;
        if (count % 20 === 0) process.stdout.write(`  ${count}/${pending.rows.length}...`);
      }
      console.log(`  Done: ${count} materials loaded`);

      const final = await client.query(`SELECT COUNT(*) FILTER (WHERE status='loaded') as loaded, COUNT(*) as total FROM material_dispatch_assignments WHERE dispatch_session_id=$1`, [sess.id]);
      console.log(`  Final: ${final.rows[0].loaded}/${final.rows[0].total} loaded`);
    }

    console.log('\nAll materials loaded!');
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error('ERROR:', e.message));
