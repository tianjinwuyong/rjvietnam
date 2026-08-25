const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'smt_factory',
  user: 'postgres',
  password: 'postgres',
});

async function migrate() {
  const cols = [
    ['work_order_code', 'varchar(80)'],
    ['area', 'varchar(40)'],
    ['auto_execute', 'boolean NOT NULL DEFAULT false'],
    ['ornith_summary', 'text'],
    ['feedback', 'varchar(20)'],
    ['feedback_by', 'varchar(80)'],
    ['feedback_at', 'timestamptz'],
    ['cycle_id', 'varchar(40)'],
  ];

  for (const [col, def] of cols) {
    try {
      await pool.query(`ALTER TABLE wms_manager_audit ADD COLUMN IF NOT EXISTS ${col} ${def}`);
      console.log('Added:', col);
    } catch (e) {
      console.log('Skip/Error:', col, e.message.slice(0, 80));
    }
  }

  const check = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='wms_manager_audit' ORDER BY ordinal_position`
  );
  console.log('Current columns:', check.rows.map(r => r.column_name).join(', '));

  // Show current row count
  const count = await pool.query(`SELECT COUNT(*) as c FROM wms_manager_audit`);
  console.log('Total audit rows:', count.rows[0].c);

  await pool.end();
}

migrate().catch(console.error);
