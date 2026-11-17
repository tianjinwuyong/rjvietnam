import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

const sql = `
-- Add quality + machine fields to solder_paste_openings
ALTER TABLE solder_paste_openings
  ADD COLUMN IF NOT EXISTS open_temp DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS open_humidity DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS open_image_url TEXT,
  ADD COLUMN IF NOT EXISTS line_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS machine_code VARCHAR(40);

-- Add image + machine fields to solder_paste_consumption
ALTER TABLE solder_paste_consumption
  ADD COLUMN IF NOT EXISTS consume_image_url TEXT,
  ADD COLUMN IF NOT EXISTS line_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS machine_code VARCHAR(40);
`;

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO _migrations (filename, hash, applied_at) VALUES ('207b_solder_paste_fields.sql', 'solder_paste_fields_v1', NOW()) ON CONFLICT (filename) DO UPDATE SET hash = 'solder_paste_fields_v1', applied_at = NOW()`);
    await client.query('COMMIT');
    console.log('Fields added successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
run();
