const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  const client = await pool.connect();
  try {
    // Grant sequence permissions
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres`);
    console.log('Sequence permissions granted');

    // Check sequences
    const seqs = await client.query(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'`);
    console.log('Sequences:', seqs.rows.map(r => r.sequence_name).join(', '));
  } catch (e) {
    console.log('Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e.message));
