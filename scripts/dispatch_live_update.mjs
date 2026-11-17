import pg from 'pg';
import http from 'http';
const { Pool } = pg;

const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

function fireSSE(type, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ from: 'test_script', type, payload, priority: 'info' });
    const req = http.request({
      hostname: 'localhost', port: 8080, path: '/api/pda/events',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const client = await pool.connect();
  try {
    // Get some pending assignments for each operator
    const result = await client.query(`
      SELECT id, material_code, assigned_operator, assigned_pda
      FROM material_dispatch_assignments
      WHERE dispatch_session_id = 4 AND status = 'pending'
      ORDER BY assigned_operator, id
      LIMIT 12
    `);

    const operators = ['Li Na', 'Wang Qiang'];
    const byOperator = { 'Li Na': [], 'Wang Qiang': [] };
    for (const row of result.rows) {
      if (byOperator[row.assigned_operator] && byOperator[row.assigned_operator].length < 6) {
        byOperator[row.assigned_operator].push(row);
      }
    }

    console.log('Loading materials for operators...');
    for (const op of operators) {
      const assignments = byOperator[op];
      console.log(`\n${op} (${assignments.length} materials):`);
      for (const a of assignments) {
        // Mark as loaded directly in DB
        await client.query(`
          UPDATE material_dispatch_assignments
          SET status = 'loaded', loaded_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [a.id]);
        console.log(`  Loaded: ${a.material_code} (id=${a.id})`);

        // Fire SSE event
        await fireSSE('MATERIAL_LOADED', {
          sessionId: 4,
          workOrderCode: '26061010006',
          materialCode: a.material_code,
          operator: op,
          assignmentId: a.id
        });
        await new Promise(r => setTimeout(r, 1500)); // 1.5s between loads
      }
    }

    console.log('\nDone! Check the dispatch board.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
