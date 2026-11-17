const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  // 1. Find available work orders with BOM
  const woR = await pool.query(
    `SELECT wo.code, wo.status, wo.planned_qty, p.code as product_code
     FROM work_orders wo
     JOIN products p ON p.id = wo.product_id
     JOIN boms b ON b.product_id = wo.product_id AND b.status = 'active'
     WHERE wo.status IN ('draft', 'released', 'running')
     LIMIT 5`
  );
  console.log('Available WOs:', woR.rows);

  // 2. Find a WO not already used in dispatch
  const dispatchWos = await pool.query(
    `SELECT DISTINCT work_order_code FROM material_dispatch_sessions`
  );
  const usedCodes = dispatchWos.rows.map(r => r.work_order_code);
  const freshWos = woR.rows.filter(r => !usedCodes.includes(r.code));
  console.log('Fresh WOs (not in dispatch):', freshWos.map(r => r.code));

  if (freshWos.length === 0) {
    console.log('No fresh WOs - will use an existing one and clear it first');
  }

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
