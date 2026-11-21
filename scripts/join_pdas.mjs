import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

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
    const sessionId = 4;

    // Re-register PDAs
    console.log('Joining PDAs...');
    await apiJoinPda(sessionId, 'PDA001', 'Zhang Wei', 'LINE-01');
    await apiJoinPda(sessionId, 'PDA002', 'Li Na', 'LINE-01');
    await apiJoinPda(sessionId, 'PDA003', 'Wang Qiang', 'LINE-01');
    await apiJoinPda(sessionId, 'PDA004', 'Chen Jie', 'LINE-01');

    const s1 = await apiGetSession(sessionId);
    console.log(`PDAs registered: ${s1.session.pdas.map(p => p.pdaId).join(', ')}`);

    const assignments = s1.session.assignments;
    const pdaMap = {};
    for (const a of assignments) {
      if (a.assignedPda && !pdaMap[a.assignedPda]) pdaMap[a.assignedPda] = [];
      if (a.assignedPda) pdaMap[a.assignedPda].push(a);
    }

    // Claim + load 5 materials for PDA002
    console.log('PDA002 claiming...');
    const pda002 = (pdaMap['PDA002'] || []).slice(0, 5);
    for (const a of pda002) {
      await apiClaim(a.id, 'PDA002', 'Li Na');
    }
    await client.query(`UPDATE material_dispatch_assignments SET status='loaded', loaded_at=NOW(), updated_at=NOW() WHERE dispatch_session_id=$1 AND status='loading'`, [sessionId]);
    const s2 = await apiGetSession(sessionId);
    console.log(`PDA002 done: ${s2.session.progress.loaded}/${s2.session.progress.total} loaded`);

    // Claim + load 3 materials for PDA003
    console.log('PDA003 claiming...');
    const pda003 = (pdaMap['PDA003'] || []).filter(a => a.status === 'pending').slice(0, 3);
    for (const a of pda003) {
      await apiClaim(a.id, 'PDA003', 'Wang Qiang');
    }
    await client.query(`UPDATE material_dispatch_assignments SET status='loaded', loaded_at=NOW(), updated_at=NOW() WHERE dispatch_session_id=$1 AND status='loading'`, [sessionId]);
    const s3 = await apiGetSession(sessionId);
    console.log(`PDA003 done: ${s3.session.progress.loaded}/${s3.session.progress.total} loaded`);
    console.log(`PDAs: ${s3.session.pdas.map(p => p.pdaId).join(', ')}`);
    console.log('READY - take screenshot now');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
