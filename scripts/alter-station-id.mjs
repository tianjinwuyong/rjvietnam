import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: '127.0.0.1', port: 5432, database: 'smt_factory',
  user: 'postgres', password: 'postgres'
});

await client.connect();
try {
  await client.query(`ALTER TABLE station_events ALTER COLUMN station_id DROP NOT NULL`);
  console.log('Altered parent station_events');
} catch (e) {
  console.log('Parent:', e.message);
}
await client.end();
console.log('Done');
