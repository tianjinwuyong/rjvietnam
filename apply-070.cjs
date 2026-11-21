
const { readFileSync } = require('fs');
const path = require('path');
const { Pool } = require('pg');

const root = 'C:/Users/tianj/Desktop/越南工厂瑞晶/smt-factory-system';
const sql = readFileSync(path.join(root, 'database', 'migrations', '070_hr_daily_line_role_assignments.sql'), 'utf8');

const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'smt_factory', password: 'smt_factory', database: 'smt_factory' });

(async () => {
  try {
    await pool.query(sql);
    console.log('070 migration applied OK');
    const check = await pool.query(`SELECT to_regclass('public.hr_daily_line_role_assignments') AS tbl`);
    console.log('table exists:', check.rows[0].tbl);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
