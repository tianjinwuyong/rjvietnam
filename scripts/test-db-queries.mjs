import pg from 'pg';
const { Client } = pg;

const c = new Client({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });
await c.connect();

try {
  const r = await c.query(
    `SELECT DISTINCT m.code AS material_code
     FROM work_orders wo
     JOIN boms b ON b.product_id = wo.product_id AND b.status = 'active'
     JOIN bom_lines bl ON bl.bom_id = b.id
     JOIN materials m ON m.id = bl.material_id
     WHERE wo.code = $1`,
    ['26061010008']
  );
  console.log('BOM lookup OK:', r.rows);
} catch(e) {
  console.log('BOM error:', e.message);
}

try {
  const r2 = await c.query(
    `SELECT fpr.feeder_slot, p.code AS product_code
     FROM fool_proof_rules fpr
     JOIN products p ON p.id = fpr.material_id
     WHERE fpr.station_id = $1 AND fpr.feeder_slot = $2 AND fpr.status = 'active'
     LIMIT 1`,
    [null, 'F01']
  );
  console.log('fool_proof lookup OK:', r2.rows);
} catch(e) {
  console.log('fool_proof error:', e.message);
}

await c.end();
