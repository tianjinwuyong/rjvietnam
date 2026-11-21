const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
async function main() {
  const client = await pool.connect();
  try {
    // Add more shelf cells (L004A, L004B, L005A, L005B) to accommodate all sessions
    const newShelfCodes = ['L004A', 'L004B', 'L005A', 'L005B'];
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
    console.log('Added new shelf cells');

    const supR = await client.query(`SELECT id FROM suppliers LIMIT 1`);
    const supplierId = supR.rows[0]?.id;

    // Map remaining S5 overflow lots (102 remaining)
    const s5Overflow = await client.query(`
      SELECT ml.id as lot_id, m.code as material_code
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      WHERE ml.label_id LIKE 'S5-%'
      AND ml.id NOT IN (SELECT material_lot_id FROM shelf_cells WHERE material_lot_id IS NOT NULL)
    `);
    console.log(`\nS5 overflow unmapped: ${s5Overflow.rows.length}`);

    const emptyCells5 = await client.query(`
      SELECT sc.id, sc.shelf_code, sc.cell_number
      FROM shelf_cells sc
      WHERE sc.cell_status = 'empty'
      AND sc.id NOT IN (SELECT id FROM shelf_cells WHERE material_lot_id IS NOT NULL)
      ORDER BY sc.shelf_code, sc.cell_number
    `);
    console.log(`Empty cells available: ${emptyCells5.rows.length}`);

    let cellIdx = 0;
    for (const lot of s5Overflow.rows) {
      const cell = emptyCells5.rows[cellIdx];
      if (!cell) { console.log(`  No cell for S5 lot ${lot.material_code}`); continue; }
      await client.query(`
        UPDATE shelf_cells SET material_lot_id = $1, cell_status = 'occupied', updated_at = NOW()
        WHERE id = $2
      `, [lot.lot_id, cell.id]);
      cellIdx++;
    }
    console.log(`  Mapped ${cellIdx} S5 overflow lots`);

    // Map all S6 lots
    const s6Lots = await client.query(`
      SELECT ml.id as lot_id, m.code as material_code
      FROM material_lots ml
      JOIN materials m ON m.id = ml.material_id
      WHERE ml.label_id LIKE 'S6-%'
    `);
    console.log(`\nS6 lots to map: ${s6Lots.rows.length}`);

    const emptyCells6 = await client.query(`
      SELECT sc.id, sc.shelf_code, sc.cell_number
      FROM shelf_cells sc
      WHERE sc.cell_status = 'empty'
      AND sc.id NOT IN (SELECT material_lot_id::int FROM shelf_cells WHERE material_lot_id IS NOT NULL)
      ORDER BY sc.shelf_code, sc.cell_number
    `);
    console.log(`Empty cells for S6: ${emptyCells6.rows.length}`);

    cellIdx = 0;
    for (const lot of s6Lots.rows) {
      const cell = emptyCells6.rows[cellIdx];
      if (!cell) { console.log(`  No cell for S6 lot ${lot.material_code}`); continue; }
      await client.query(`
        UPDATE shelf_cells SET material_lot_id = $1, cell_status = 'occupied', updated_at = NOW()
        WHERE id = $2
      `, [lot.lot_id, cell.id]);
      cellIdx++;
    }
    console.log(`  Mapped ${cellIdx} S6 lots`);

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
    console.log(`\nTotal mapped: ${total.rows[0].cnt}`);
    perSession.rows.forEach(r => console.log(`  ${r.sess}: ${r.cnt} cells`));

    const allCells = await client.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE cell_status='occupied') as occ FROM shelf_cells`);
    console.log(`\nAll shelf_cells: ${allCells.rows[0].occ} occupied / ${allCells.rows[0].total} total`);

  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
