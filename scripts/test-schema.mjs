import pg from 'pg';
const { Client } = pg;

const c = new Client({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });
await c.connect();

// Check fool_proof_rules columns
const t = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'fool_proof_rules'`);
console.log('fool_proof_rules columns:', t.rows.map(r => r.column_name).join(', '));

// Check stations columns
const t2 = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'stations' LIMIT 5`);
console.log('stations columns (sample):', t2.rows.map(r => r.column_name).join(', '));

await c.end();
