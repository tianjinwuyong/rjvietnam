import pg from 'pg';
const { Client } = pg;

const c = new Client({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });
await c.connect();

const tests = [
  ['stations by code', `SELECT id FROM stations WHERE code = $1 LIMIT 1`],
  ['production_lines by code', `SELECT id FROM production_lines WHERE code = $1 LIMIT 1`],
  ['fool_proof by station+slot', `SELECT fpr.feeder_slot, p.code AS product_code FROM fool_proof_rules fpr JOIN products p ON p.id = fpr.material_id WHERE fpr.station_id = $1 AND fpr.feeder_slot = $2 AND fpr.status = 'active' LIMIT 1`],
  ['work_orders by code', `SELECT id, product_id FROM work_orders WHERE code = $1 LIMIT 1`],
  ['boms by product_id+active', `SELECT id FROM boms WHERE product_id = $1 AND status = 'active' LIMIT 1`],
  ['bom_lines by bom_id', `SELECT id FROM bom_lines WHERE bom_id = $1 LIMIT 1`],
  ['materials by id', `SELECT code FROM materials WHERE id = $1 LIMIT 1`],
  ['full BOM query', `SELECT DISTINCT m.code AS material_code FROM work_orders wo JOIN boms b ON b.product_id = wo.product_id AND b.status = 'active' JOIN bom_lines bl ON bl.bom_id = b.id JOIN materials m ON m.id = bl.material_id WHERE wo.code = $1`],
];

const params = ['26061010008', null, 'F01'];
for (const [name, sql] of tests) {
  try {
    // substitute params manually for testing
    let testSql = sql;
    if (name === 'fool_proof by station+slot') testSql = sql.replace('$1', 'NULL').replace('$2', "'F01'");
    else if (name === 'stations by code') testSql = sql.replace('$1', "'ST-L001-01'");
    else if (name === 'production_lines by code') testSql = sql.replace('$1', "'L001'");
    else testSql = sql.replace('$1', "'26061010008'");
    const r = await c.query(testSql);
    console.log(`[OK] ${name}: ${r.rows.length} rows`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
  }
}

await c.end();
