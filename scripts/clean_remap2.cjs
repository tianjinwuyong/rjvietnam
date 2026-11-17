const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
async function main() {
  const client = await pool.connect();
  try {
    // Clear S* shelf_cells first (already done, but safe to repeat)
    await client.query(`UPDATE shelf_cells SET material_lot_id = NULL, cell_status = 'empty' WHERE material_lot_id::text IN (SELECT id::text FROM material_lots WHERE label_id LIKE 'S%')`);
    // Delete all S lots
    await client.query(`DELETE FROM material_lots WHERE label_id LIKE 'S%'`);
    console.log('Cleared S lots and shelf_cells');

    const supR = await client.query(`SELECT id FROM suppliers LIMIT 1`);
    const supplierId = supR.rows[0]?.id;

    // Shelf mapping: S4→L001A-L003A, S5→L003B-L005A, S6→L005B-L007B
    const shelfMap = { 4: ['L001A','L001B','L002A','L002B','L003A'], 5: ['L003B','L004A','L004B','L005A'], 6: ['L005B','L006A','L006B','L007A','L007B'] };

    for (const [sessionId, shelves] of Object.entries(shelfMap)) {
      const prefix = `S${sessionId}`;
      const mats = await client.query(`
        SELECT DISTINCT m.id as material_id, m.code as material_code
        FROM material_dispatch_assignments mda
        JOIN materials m ON m.code = mda.material_code
        WHERE mda.dispatch_session_id = $1
        ORDER BY m.code
      `, [sessionId]);

      console.log(`\nSession ${sessionId}: ${mats.rows.length} materials → [${shelves.join(',')}]`);

      let cellIdx = 0;
      for (const mat of mats.rows) {
        const labelId = `${prefix}-${mat.material_code}`;
        const shelfCode = shelves[Math.floor(cellIdx / 20) % shelves.length];
        const cellNumber = String((cellIdx % 20) + 1).padStart(2, '0');

        const lotR = await client.query(`
          INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, lot_status, label_id)
          VALUES ($1, $2, $3, 50000, 'released', 'open', $4)
          RETURNING id
        `, [mat.material_id, supplierId, `LOT-${labelId}`, labelId]);
        const lotId = lotR.rows[0]?.id;

        const mapped = await client.query(`
          UPDATE shelf_cells SET material_lot_id = $1, cell_status = 'occupied', updated_at = NOW()
          WHERE shelf_code = $2 AND cell_number = $3
          RETURNING id
        `, [lotId, shelfCode, cellNumber]);

        if (!mapped.rows.length) {
          console.log(`  NO CELL: ${labelId} → ${shelfCode}/${cellNumber}`);
        }
        cellIdx++;
      }
      console.log(`  Done: ${cellIdx} lots mapped`);
    }

    // Final summary
    const cells = await client.query(`SELECT COUNT(*) FILTER (WHERE cell_status='occupied') as occ, COUNT(*) as total FROM shelf_cells`);
    const lots = await client.query(`SELECT LEFT(label_id, 2) as sess, COUNT(*) as cnt FROM material_lots WHERE label_id LIKE 'S%' GROUP BY LEFT(label_id, 2) ORDER BY sess`);
    const mapped = await client.query(`SELECT LEFT(ml.label_id, 2) as sess, COUNT(*) as cnt FROM shelf_cells sc JOIN material_lots ml ON ml.id = sc.material_lot_id WHERE ml.label_id LIKE 'S%' GROUP BY LEFT(ml.label_id, 2) ORDER BY sess`);

    console.log('\n=== Results ===');
    console.log(`Shelf cells: ${cells.rows[0].occ}/${cells.rows[0].total} occupied`);
    console.log('Lots by session:', lots.rows.map(r => `${r.sess}:${r.cnt}`).join(', '));
    console.log('Mapped by session:', mapped.rows.map(r => `${r.sess}:${r.cnt}`).join(', '));

  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
