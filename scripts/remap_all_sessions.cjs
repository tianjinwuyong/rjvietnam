const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
async function main() {
  const client = await pool.connect();
  try {
    // Add 4 more shelf racks (L006A/B, L007A/B) = 80 more cells → total 280 cells
    const newShelfCodes = ['L006A', 'L006B', 'L007A', 'L007B'];
    for (const code of newShelfCodes) {
      for (let i = 1; i <= 20; i++) {
        const cellNumber = String(i).padStart(2, '0');
        await client.query(`
          INSERT INTO shelf_cells (shelf_code, cell_number, cell_status)
          VALUES ($1, $2, 'empty')
          ON CONFLICT DO NOTHING
        `, [code, cellNumber]);
      }
    }
    console.log('Added 80 new shelf cells (L006A/B, L007A/B)');

    const supR = await client.query(`SELECT id FROM suppliers LIMIT 1`);
    const supplierId = supR.rows[0]?.id;

    // Clear existing session-mapped shelf_cells so we start clean
    await client.query(`
      UPDATE shelf_cells sc SET material_lot_id = NULL, cell_status = 'empty', updated_at = NOW()
      FROM material_lots ml
      WHERE ml.id = sc.material_lot_id AND ml.label_id LIKE 'S%'
    `);
    await client.query(`DELETE FROM material_lots WHERE label_id LIKE 'S%'`);
    console.log('Cleared existing S4/S5/S6 lots and shelf_cells');

    // Remap all 3 sessions cleanly: S4→L001A-L003A, S5→L003B-L005A, S6→L005B-L007B
    const shelfMap = {
      4: ['L001A','L001B','L002A','L002B','L003A'],  // 100 cells for S4
      5: ['L003B','L004A','L004B','L005A'],           // 80 cells for S5
      6: ['L005B','L006A','L006B','L007A','L007B'],   // 100 cells for S6
    };

    for (const [sessionId, shelves] of Object.entries(shelfMap)) {
      const prefix = `S${sessionId}`;
      const mats = await client.query(`
        SELECT DISTINCT m.id as material_id, m.code as material_code
        FROM material_dispatch_assignments mda
        JOIN materials m ON m.code = mda.material_code
        WHERE mda.dispatch_session_id = $1
      `, [sessionId]);

      console.log(`\nSession ${sessionId}: ${mats.rows.length} materials → shelves [${shelves.join(',')}]`);

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
        if (!lotId) continue;

        await client.query(`
          UPDATE shelf_cells SET material_lot_id = $1, cell_status = 'occupied', updated_at = NOW()
          WHERE shelf_code = $2 AND cell_number = $3
        `, [lotId, shelfCode, cellNumber]);

        cellIdx++;
      }
      console.log(`  Mapped ${cellIdx} materials`);
    }

    // Final summary
    const total = await client.query(`
      SELECT COUNT(*) as cnt FROM shelf_cells sc
      JOIN material_lots ml ON ml.id = sc.material_lot_id
      WHERE ml.label_id LIKE 'S%'
    `);
    const perSession = await client.query(`
      SELECT LEFT(ml.label_id, 2) as sess, COUNT(*) as cnt
      FROM shelf_cells sc
      JOIN material_lots ml ON ml.id = sc.material_lot_id
      WHERE ml.label_id LIKE 'S%'
      GROUP BY LEFT(ml.label_id, 2)
      ORDER BY sess
    `);
    console.log(`\nTotal shelf_cells with session label_ids: ${total.rows[0].cnt}`);
    perSession.rows.forEach(r => console.log(`  Session ${r.sess}: ${r.cnt} cells`));

    const allCells = await client.query(`SELECT COUNT(*) FILTER (WHERE cell_status='occupied') as occ, COUNT(*) as total FROM shelf_cells`);
    console.log(`All cells: ${allCells.rows[0].occ} occupied / ${allCells.rows[0].total} total`);

  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
