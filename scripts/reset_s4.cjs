const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
async function main() {
  const client = await pool.connect();
  try {
    // Reopen session 4
    await client.query("UPDATE material_dispatch_sessions SET status = 'active', updated_at = NOW() WHERE id = 4");
    // Reset 5 loaded assignments to pending (PostgreSQL UPDATE with subquery)
    await client.query(`
      UPDATE material_dispatch_assignments
      SET status = 'pending', loaded_at = NULL, updated_at = NOW()
      WHERE id IN (SELECT id FROM material_dispatch_assignments WHERE dispatch_session_id = 4 AND status = 'loaded' LIMIT 5)
    `);
    console.log('Session 4 reopened with 5 pending assignments');

    const s = await client.query('SELECT status FROM material_dispatch_sessions WHERE id = 4');
    const a = await client.query('SELECT COUNT(*) FILTER (WHERE status = pending) as p, COUNT(*) FILTER (WHERE status = loaded) as l FROM material_dispatch_assignments WHERE dispatch_session_id = 4');
    console.log('Session 4:', s.rows[0].status, '| Pending:', a.rows[0].p, '| Loaded:', a.rows[0].l);

    const labels = await client.query(`
      SELECT COUNT(DISTINCT ml.label_id) as cnt
      FROM material_dispatch_assignments mda
      JOIN materials m ON m.code = mda.material_code
      JOIN material_lots ml ON ml.material_id = m.id AND ml.label_id LIKE 'S4-%'
      WHERE mda.dispatch_session_id = 4
    `);
    console.log('S4 label_ids on rack:', labels.rows[0].cnt);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e.message));
