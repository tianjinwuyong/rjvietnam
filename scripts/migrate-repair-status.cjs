const { query } = require('../services/api/src/db.js');

async function migrate() {
  try {
    const col = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='ng_defect_records' AND column_name='repair_status'`
    );
    if (col.rows.length > 0) {
      console.log('repair_status column already exists');
    } else {
      await query(`ALTER TABLE ng_defect_records ADD COLUMN repair_status varchar(20) NOT NULL DEFAULT 'pending'`);
      console.log('repair_status column added');
    }
    await query(`CREATE INDEX IF NOT EXISTS idx_ng_repair_status ON ng_defect_records(repair_status, occurred_at DESC)`);
    console.log('index created');
  } catch (e) {
    console.error('Migration error:', e.message);
  }
  process.exit(0);
}

migrate();
