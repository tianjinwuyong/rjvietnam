import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ host: '127.0.0.1', database: 'smt_factory', user: 'postgres', password: 'postgres' });
try {
  await pool.query('ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS shelf_placed_at TIMESTAMPTZ');
  console.log('Done: shelf_placed_at column added');
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await pool.end();
}
