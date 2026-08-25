import { query } from '../src/db.js';

const r = await query(`SELECT current_database(), inet_server_addr(), version()`);
console.log('DB:', JSON.stringify(r.rows[0], null, 2));
