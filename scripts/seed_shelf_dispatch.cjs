// Seed script: creates label_ids + shelf_cells for dispatch sessions 4, 5, 6
// Run: node scripts/seed_shelf_dispatch.cjs
const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

const SHELF_CODES = ['L001A', 'L001B', 'L002A', 'L002B', 'L003A', 'L003B'];
const CELLS_PER_SHELF = 20;

async function main() {
  const client = await pool.connect();
  try {
    // Ensure shelf storage locations exist (no zone column - storage_locations uses area/shelf_code)
    for (const code of SHELF_CODES) {
      await client.query(`
        INSERT INTO storage_locations (code, name_zh, name_en, name_vi, location_type, area)
        VALUES ($1, $1, $1, $1, 'shelf', 'L')
        ON CONFLICT (code) DO NOTHING
      `, [code]);
    }

    // Ensure we have at least one supplier
    const supR = await client.query(`SELECT id FROM suppliers LIMIT 1`);
    const supplierId = supR.rows[0]?.id;
    if (!supplierId) throw new Error('No supplier found - run seeds first');

    // Ensure shelf_cells exist for each shelf/cell combo
    for (const shelfCode of SHELF_CODES) {
      for (let i = 1; i <= CELLS_PER_SHELF; i++) {
        const cellNumber = String(i).padStart(2, '0');
        await client.query(`
          INSERT INTO shelf_cells (shelf_code, cell_number, cell_status)
          VALUES ($1, $2, 'empty')
          ON CONFLICT DO NOTHING
        `, [shelfCode, cellNumber]);
      }
    }
    console.log('Shelf cells initialized');

    // Process each session
    for (const sessionId of [4, 5, 6]) {
      const prefix = `S${sessionId}`;

      // Get distinct materials for this session
      const mats = await client.query(`
        SELECT DISTINCT m.id as material_id, m.code as material_code
        FROM material_dispatch_assignments mda
        JOIN materials m ON m.code = mda.material_code
        WHERE mda.dispatch_session_id = $1
      `, [sessionId]);

      console.log(`\nSession ${sessionId}: ${mats.rows.length} unique materials`);

      let cellIdx = (sessionId - 4) * 40; // Session 4 starts at cell 0, session 5 at cell 40, session 6 at cell 80

      for (const mat of mats.rows) {
        const labelId = `${prefix}-${mat.material_code}`;
        const shelfCode = SHELF_CODES[Math.floor(cellIdx / CELLS_PER_SHELF) % SHELF_CODES.length];
        const cellNumber = String((cellIdx % CELLS_PER_SHELF) + 1).padStart(2, '0');

        // Create material lot with label_id
        const lotR = await client.query(`
          INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, lot_status, label_id)
          VALUES ($1, $2, $3, 50000, 'released', 'open', $4)
          ON CONFLICT DO NOTHING
          RETURNING id
        `, [mat.material_id, supplierId, `LOT-${labelId}`, labelId]);

        let lotId = lotR.rows[0]?.id;
        if (!lotId) {
          // Lot already exists - find it
          const existing = await client.query(`SELECT id FROM material_lots WHERE label_id = $1`, [labelId]);
          lotId = existing.rows[0]?.id;
        }

        if (lotId) {
          // Assign lot to shelf cell (find an empty cell)
          const updateR = await client.query(`
            UPDATE shelf_cells
            SET material_lot_id = $1, cell_status = 'occupied', updated_at = NOW()
            WHERE shelf_code = $2 AND cell_number = $3 AND (material_lot_id IS NULL OR material_lot_id = $1)
            RETURNING id
          `, [lotId, shelfCode, cellNumber]);

          if (!updateR.rows.length) {
            // Cell already occupied - find any empty cell in this shelf via subquery
            const emptyR = await client.query(`
              UPDATE shelf_cells
              SET material_lot_id = $1, cell_status = 'occupied', updated_at = NOW()
              WHERE ctid = (SELECT ctid FROM shelf_cells WHERE shelf_code = $2 AND cell_status = 'empty' LIMIT 1)
              RETURNING id
            `, [lotId, shelfCode]);
            if (emptyR.rows.length) {
              console.log(`  ${labelId} -> ${shelfCode} (overflow cell)`);
            }
          }
        }

        cellIdx++;
      }
    }

    // Verify
    const verified = await client.query(`
      SELECT sc.shelf_code, sc.cell_number, sc.cell_status, ml.label_id
      FROM shelf_cells sc
      JOIN material_lots ml ON ml.id = sc.material_lot_id
      WHERE ml.label_id LIKE 'S%'
      ORDER BY sc.shelf_code, sc.cell_number
      LIMIT 20
    `);
    console.log('\nVerification - first 20 mapped cells:');
    verified.rows.forEach(r => console.log(`  ${r.shelf_code}/${r.cell_number} ${r.cell_status} ${r.label_id}`));

    const total = await client.query(`SELECT COUNT(*) FROM shelf_cells sc JOIN material_lots ml ON ml.id = sc.material_lot_id WHERE ml.label_id LIKE 'S%'`);
    console.log(`\nTotal mapped: ${total.rows[0].count} cells with session label_ids`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
