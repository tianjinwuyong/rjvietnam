const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  const client = await pool.connect();
  try {
    // Grant all permissions on the dispatch sequences
    await client.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres`);
    await client.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres`);
    await client.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO PUBLIC`);
    console.log('All permissions granted');
  } catch (e) {
    console.log('Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e.message));
