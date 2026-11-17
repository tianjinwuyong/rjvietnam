const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  const client = await pool.connect();
  try {
    // Check session 6 overflow - how many empty cells remain after sessions 4/5?
    const emptyAfter = await client.query(`
      SELECT sc.shelf_code, sc.cell_number, sc.cell_status
      FROM shelf_cells sc
      LEFT JOIN material_lots ml ON ml.id = sc.material_lot_id AND ml.label_id LIKE 'S%'
      WHERE sc.cell_status = 'empty' OR ml.label_id IS NULL
      ORDER BY sc.shelf_code, sc.cell_number
    `);
    console.log('Empty/available cells after sessions 4/5:');
    emptyAfter.rows.forEach(r => console.log(`  ${r.shelf_code}/${r.cell_number} ${r.cell_status}`));

    // Session 6 has 111 unique materials - fix overflow
    const prefix = 'S6';
    const mats = await client.query(`
      SELECT DISTINCT m.id as material_id, m.code as material_code
      FROM material_dispatch_assignments mda
      JOIN materials m ON m.code = mda.material_code
      WHERE mda.dispatch_session_id = 6
    `);

    const supR = await client.query(`SELECT id FROM suppliers LIMIT 1`);
    const supplierId = supR.rows[0]?.id;

    // Find empty cells for session 6 overflow
    const emptyCells = await client.query(`
      SELECT sc.id, sc.shelf_code, sc.cell_number
      FROM shelf_cells sc
      LEFT JOIN material_lots ml ON ml.id = sc.material_lot_id AND ml.label_id LIKE 'S%'
      WHERE sc.cell_status = 'empty' AND ml.id IS NULL
      ORDER BY sc.shelf_code, sc.cell_number
      LIMIT 20
    `);
    console.log(`\nEmpty cells available: ${emptyCells.rows.length}`);

    // Get S6 materials that don't have lots yet
    const overflowMats = await client.query(`
      SELECT m.id as material_id, m.code as material_code
      FROM material_dispatch_assignments mda
      JOIN materials m ON m.code = mda.material_code
      LEFT JOIN material_lots ml ON ml.material_id = m.id AND ml.label_id LIKE 'S6-%'
      WHERE mda.dispatch_session_id = 6 AND ml.id IS NULL
    `);
    console.log(`\nSession 6 overflow materials: ${overflowMats.rows.length}`);

    let cellIdx = 0;
    for (const mat of overflowMats.rows) {
      const labelId = `${prefix}-${mat.material_code}`;
      const cell = emptyCells.rows[cellIdx];
      if (!cell) { console.log(`  No empty cell for ${labelId}`); continue; }

      const lotR = await client.query(`
        INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, lot_status, label_id)
        VALUES ($1, $2, $3, 50000, 'released', 'open', $4)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [mat.material_id, supplierId, `LOT-${labelId}`, labelId]);

      let lotId = lotR.rows[0]?.id;
      if (!lotId) {
        const existing = await client.query(`SELECT id FROM material_lots WHERE label_id = $1`, [labelId]);
        lotId = existing.rows[0]?.id;
      }

      if (lotId) {
        await client.query(`
          UPDATE shelf_cells SET material_lot_id = $1, cell_status = 'occupied', updated_at = NOW()
          WHERE id = $2
        `, [lotId, cell.id]);
        console.log(`  ${labelId} -> ${cell.shelf_code}/${cell.cell_number}`);
      }
      cellIdx++;
    }

    // Final verification
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
    console.log(`\nTotal mapped: ${total.rows[0].cnt}`);
    perSession.rows.forEach(r => console.log(`  ${r.sess}: ${r.cnt}`));

  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
