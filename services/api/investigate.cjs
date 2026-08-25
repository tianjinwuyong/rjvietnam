const pg = require('pg');
const pool = new pg.Pool({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });
async function main() {
  // Check current lot state
  const lot = await pool.query("SELECT id, lot_no, received_qty, reserved_qty FROM material_lots WHERE lot_no = 'LOT-26071020017'");
  console.log('LOT:', JSON.stringify(lot.rows[0]));

  // Check if there's a trigger on material_lots
  const triggers = await pool.query(`
    SELECT trigger_name, event_manipulation, action_statement
    FROM information_schema.triggers
    WHERE event_object_schema = 'public' AND event_object_table = 'material_lots'
  `);
  console.log('TRIGGERS:', JSON.stringify(triggers.rows, null, 2));

  // Check what other tables might have constraint issues related to received_qty
  const constraints = await pool.query(`
    SELECT conname, conrelid::regclass AS table_name, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid IN (
      SELECT oid FROM pg_class WHERE relname IN ('material_lots', 'feeder_binding_events', 'inventory_transactions')
    ) AND conname LIKE '%received%'
  `);
  console.log('CONSTRAINTS:', JSON.stringify(constraints.rows, null, 2));

  // Check recent feeder_binding_events for this lot
  const recent = await pool.query("SELECT id, work_order_code, machine_code, slot_no, qty, status, bound_at FROM feeder_binding_events WHERE lot_no = 'LOT-26071020017' ORDER BY bound_at DESC LIMIT 5");
  console.log('RECENT BINDINGS:', JSON.stringify(recent.rows, null, 2));

  await pool.end();
}
main().catch(e => console.error(e.message));
