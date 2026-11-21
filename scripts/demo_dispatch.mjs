import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function apiCreateSession(workOrderCode, lineCode, pdaId, operator) {
  const res = await fetch('http://localhost:8080/api/dispatch/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workOrderCode, lineCode, pdaId, operator })
  });
  return res.json();
}

async function apiJoinPda(sessionId, pdaId, operator, lineCode) {
  const res = await fetch('http://localhost:8080/api/dispatch/pdas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, pdaId, operator, lineCode })
  });
  return res.json();
}

async function apiClaim(assignmentId, pdaId, operator) {
  const res = await fetch('http://localhost:8080/api/dispatch/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignmentId, pdaId, operator })
  });
  return res.json();
}

async function apiGetSession(id) {
  const res = await fetch(`http://localhost:8080/api/dispatch/sessions/${id}`);
  return res.json();
}

async function main() {
  const client = await pool.connect();
  try {
    // 1. Clear existing sessions
    console.log('=== CLEAR OLD SESSIONS ===');
    await client.query("DELETE FROM material_dispatch_assignments WHERE dispatch_session_id IN (SELECT id FROM material_dispatch_sessions)");
    await client.query("DELETE FROM material_dispatch_sessions");
    console.log('Cleared\n');

    // 2. Create a fresh session for WO 26061010006
    console.log('=== CREATE SESSION ===');
    const r1 = await apiCreateSession('26061010006', 'LINE-01', 'PDA001', 'Zhang Wei');
    const sessionId = r1.session.id;
    console.log(`Session #${sessionId} created`);
    console.log(`Total materials: ${r1.session.progress.total}`);
    console.log(`PDAs: ${r1.session.pdas.length}\n`);

    // 3. Join more PDAs
    console.log('=== JOIN PDAs ===');
    await apiJoinPda(sessionId, 'PDA002', 'Li Na', 'LINE-01');
    console.log('PDA002 joined');
    await apiJoinPda(sessionId, 'PDA003', 'Wang Qiang', 'LINE-01');
    console.log('PDA003 joined');
    await apiJoinPda(sessionId, 'PDA004', 'Chen Jie', 'LINE-01');
    console.log('PDA004 joined\n');

    const s1 = await apiGetSession(sessionId);
    const assignments = s1.session.assignments;
    const pdaMap = {};
    for (const a of assignments) {
      if (a.assignedPda) {
        if (!pdaMap[a.assignedPda]) pdaMap[a.assignedPda] = [];
        pdaMap[a.assignedPda].push(a);
      }
    }
    console.log('Assignment distribution:');
    for (const [pda, asns] of Object.entries(pdaMap)) {
      console.log(`  ${pda} (${asns.filter(a => a.assignedOperator).length}): ${asns.length} assigned`);
    }
    console.log('');

    // 4. Claim + load for PDA002 (5 materials)
    console.log('=== PDA002 CLAIM + LOAD ===');
    const pda002asns = pdaMap['PDA002'] || [];
    for (let i = 0; i < Math.min(5, pda002asns.length); i++) {
      await apiClaim(pda002asns[i].id, 'PDA002', 'Li Na');
      console.log(`  Claimed: ${pda002asns[i].materialCode}`);
    }
    // Mark as loaded
    await client.query(`
      UPDATE material_dispatch_assignments
      SET status = 'loaded', loaded_at = NOW(), updated_at = NOW()
      WHERE dispatch_session_id = $1 AND status = 'loading'
    `, [sessionId]);
    const s2 = await apiGetSession(sessionId);
    console.log(`PDA002 done: ${s2.session.progress.loaded}/${s2.session.progress.total} loaded\n`);

    // 5. Claim + load for PDA003 (3 materials)
    console.log('=== PDA003 CLAIM + LOAD ===');
    const pda003asns = (pdaMap['PDA003'] || []).filter(a => a.status === 'pending');
    for (let i = 0; i < Math.min(3, pda003asns.length); i++) {
      await apiClaim(pda003asns[i].id, 'PDA003', 'Wang Qiang');
      console.log(`  Claimed: ${pda003asns[i].materialCode}`);
    }
    await client.query(`
      UPDATE material_dispatch_assignments
      SET status = 'loaded', loaded_at = NOW(), updated_at = NOW()
      WHERE dispatch_session_id = $1 AND status = 'loading'
    `, [sessionId]);
    const s3 = await apiGetSession(sessionId);
    console.log(`PDA003 done: ${s3.session.progress.loaded}/${s3.session.progress.total} loaded\n`);

    // 6. Final state
    console.log('=== FINAL STATE ===');
    console.log(`Session #${sessionId}, WO 26061010006`);
    console.log(`Progress: ${s3.session.progress.loaded}/${s3.session.progress.total}`);
    console.log(`PDAs: ${s3.session.pdas.map(p => p.pdaId).join(', ')}`);
    console.log('');
    console.log('========================================');
    console.log('NOW OPEN: http://localhost:5178');
    console.log('Login: ADMIN_VN_01 / Factory@123');
    console.log('Click: 产线与质量 > MES 执行');
    console.log('Tab: 物料配送看板 (13th tab)');
    console.log('Click session card: 26061010006');
    console.log('========================================');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
