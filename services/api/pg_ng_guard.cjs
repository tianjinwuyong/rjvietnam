const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 5432, database: 'mes_db', user: 'postgres', password: 'postgres123' });
p.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'mes_confirmed_ng_guard' ORDER BY ordinal_position")
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); p.end(); })
  .catch(e => console.error(e));
