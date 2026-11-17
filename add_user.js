const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
pool.query("INSERT INTO users (username, display_name, role_id, locale) SELECT 'ADMIN_VN_01', 'Admin 01', id, 'en-US' FROM roles WHERE code = 'admin' ON CONFLICT (username) DO NOTHING")
  .then(() => pool.query("SELECT username FROM users WHERE username = 'ADMIN_VN_01'"))
  .then(r => { console.log('user:', JSON.stringify(r.rows)); pool.end(); })
  .catch(e => console.error('err:', e.message));
