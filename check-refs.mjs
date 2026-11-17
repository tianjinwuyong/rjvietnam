import pg from "pg";
const {Pool} = pg;
const pool = new Pool({host:"127.0.0.1",port:5432,user:"postgres",password:"postgres",database:"smt_factory"});

const checks = [
  ["materials", "code", "MAT-01001"],
  ["suppliers", "code", "SUPPLIER_001"],
  ["users", "username", "PMC_CN_01"],
  ["users", "username", "BUYER_001"],
  ["roles", "code", "pmc"],
  ["purchase_requisitions", "requisition_no", "PR-2026-0001"],
];

for (const [tbl, col, val] of checks) {
  const r = await pool.query(`SELECT id, ${col} FROM ${tbl} WHERE ${col} = '${val}'`);
  console.log(`${tbl}.${col}='${val}': ${r.rows.length > 0 ? 'EXISTS id=' + r.rows[0].id : 'MISSING'}`);
}

await pool.end();
