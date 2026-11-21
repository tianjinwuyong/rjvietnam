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
    const sessionId = 3;

    console.log('=== Re-register PDAs to session #3 ===');
    // Register 3 PDAs
    const pdas = [
      ['PDA001', 'Zhang Wei', 'LINE-01'],
      ['PDA002', 'Li Na', 'LINE-01'],
      ['PDA003', 'Wang Qiang', 'LINE-01'],
    ];

    for (const [pdaId, op, line] of pdas) {
      const r = await apiJoinPda(sessionId, pdaId, op, line);
      console.log(`${pdaId} joined: reassigned=${r.reassignedCount}`);
    }

    // Get updated assignments
    const s1 = await apiGetSession(sessionId);
    const assignments = s1.session.assignments;
    console.log(`Total assignments: ${assignments.length}`);

    // Group by PDA
    const pdaMap = {};
    for (const a of assignments) {
      if (a.assignedPda) {
        if (!pdaMap[a.assignedPda]) pdaMap[a.assignedPda] = [];
        pdaMap[a.assignedPda].push(a);
      }
    }

    console.log('Assignment distribution:');
    for (const [pda, asns] of Object.entries(pdaMap)) {
      console.log(`  ${pda}: ${asns.length} assigned`);
    }

    console.log('\n=== Claim some materials for each PDA ===');
    let claimed = 0;
    for (const [pdaId, opName] of pdas) {
      const pdaAsns = pdaMap[pdaId] || [];
      const toClaim = pdaAsns.slice(0, 5);
      for (const a of toClaim) {
        const r = await apiClaim(a.id, pdaId, opName);
        if (r.success) claimed++;
      }
      console.log(`  ${pdaId} claimed ${toClaim.length}`);
    }
    console.log(`Total claimed: ${claimed}`);

    console.log('\n=== Mark all claimed as loaded ===');
    const r = await client.query(`
      UPDATE material_dispatch_assignments
      SET status = 'loaded', loaded_at = NOW(), updated_at = NOW()
      WHERE dispatch_session_id = $1 AND status = 'loading'
      RETURNING id
    `, [sessionId]);
    console.log(`Marked ${r.rowCount} as loaded`);

    const s2 = await apiGetSession(sessionId);
    console.log(`\nFinal progress: ${s2.session.progress.loaded}/${s2.session.progress.total}`);
    console.log(`PDAs in session: ${s2.session.pdas.map(p => p.pdaId).join(', ')}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
