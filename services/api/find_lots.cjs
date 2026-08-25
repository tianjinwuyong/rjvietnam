const pg = require('pg');
const pool = new pg.Pool({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });
async function main() {
  // Find material lots that match BOM materials for WO 26071020017 (bom_id=45)
  const lots = await pool.query(`
    SELECT ml.lot_no, ml.label_id, ml.material_id, ml.received_qty,
           ml.iqc_status, ml.lot_status, ml.lifecycle_status,
           m.code as material_code, m.name_zh
    FROM material_lots ml
    JOIN materials m ON m.id = ml.material_id
    JOIN bom_lines bl ON bl.material_id = ml.material_id
    WHERE bl.bom_id = 45
      AND ml.iqc_status = 'released'
      AND ml.lot_status = 'open'
    LIMIT 20
  `);
  console.log('LOTS FOR WO:', JSON.stringify(lots.rows, null, 2));
  await pool.end();
}
main().catch(e => console.error(e.message));
