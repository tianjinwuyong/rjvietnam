import pg from 'pg';
import fs from 'fs';
const { Pool } = pg;

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'smt_factory',
});

const sql = fs.readFileSync('./database/seeds/013_hr_seed.sql', 'utf8');

async function main() {
  try {
    const before = await pool.query('SELECT COUNT(*) as total FROM employees');
    console.log('Employees before:', before.rows[0].total);

    await pool.query(sql);
    console.log('Seed applied OK');

    const after = await pool.query('SELECT COUNT(*) as total FROM employees');
    console.log('Employees after:', after.rows[0].total);

    const rj = await pool.query("SELECT COUNT(*) as rj FROM employees WHERE employee_no LIKE 'RJ%'");
    console.log('RJ employees:', rj.rows[0].rj);

    const vn = await pool.query("SELECT COUNT(*) as vn FROM employees WHERE employee_no LIKE 'VN%'");
    console.log('VN employees:', vn.rows[0].vn);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

main();
