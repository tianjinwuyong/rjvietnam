const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });

const TABLES = [
  'ict_ng',
  'fct_ng',
  'fct_results',
  'ict_results',
  'depanel_results',
  'sn_records',
  'arrival_exceptions',
  'confirmed_ng',
  'ng_records',
];

async function main() {
  await c.connect();
  for (const t of TABLES) {
    try {
      await c.query(`DELETE FROM ${t}`);
      console.log(`Deleted from ${t}`);
    } catch (e) {
      console.log(`Error on ${t}: ${e.message}`);
    }
  }
  // Reset sequences
  const seqs = ['sn_records_id_seq','arrival_exceptions_id_seq','confirmed_ng_id_seq','ng_records_id_seq'];
  for (const s of seqs) {
    await c.query(`SELECT setval('${s}', 1, false)`).catch(() => {});
  }
  console.log('Done. Sequences reset.');
  await c.end();
}

main();
