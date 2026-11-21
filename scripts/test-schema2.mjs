import pg from 'pg';
const { Client } = pg;
const c = new Client({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });
await c.connect();
const t = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'production_lines'`);
console.log('production_lines columns:', t.rows.map(r => r.column_name).join(', '));
await c.end();
