const pg = require('pg');
const pool = new pg.Pool({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });
async function main() {
  // Set label_id on a valid lot so bind API can find it
  const r1 = await pool.query("UPDATE material_lots SET label_id = 'LOT-26071020017' WHERE lot_no = 'LOT-26071020017' RETURNING lot_no, label_id, material_id");
  console.log('Updated lot:', JSON.stringify(r1.rows[0]));

  // Get material code for the lot
  const mat = await pool.query("SELECT m.code, m.name_zh, ml.material_id FROM material_lots ml JOIN materials m ON m.id = ml.material_id WHERE ml.lot_no = 'LOT-26071020017'");
  console.log('Material:', JSON.stringify(mat.rows[0]));

  // Check if there's a feeder for NXT-02
  const feeders = await pool.query("SELECT * FROM feeders WHERE machine_code = 'NXT-02' OR feeder_code LIKE 'NXT-02%' LIMIT 10");
  console.log('Feeders:', JSON.stringify(feeders.rows, null, 2));

  // Check machine_slots for NXT-02
  const slots = await pool.query("SELECT * FROM machine_slots WHERE machine_code = 'NXT-02' LIMIT 10");
  console.log('Slots:', JSON.stringify(slots.rows, null, 2));

  await pool.end();
}
main().catch(e => console.error(e.message));
