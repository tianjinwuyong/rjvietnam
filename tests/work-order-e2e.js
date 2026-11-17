import pg from "pg";
const pool = new pg.Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "smt_factory" });

const BASE = "http://127.0.0.1:8080";

// ── Login ─────────────────────────────────────────────────────────
const loginRes = await fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "VN_OP_001", password: "Factory@123" })
});
const loginData = await loginRes.json();
const token = loginData.data.item.token;
console.log("[1] Login OK, role:", loginData.data.item.user.roleKey);

const hdrs = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

// ── [2] Products (direct DB — /products endpoint not yet implemented) ──
const { rows: products } = await pool.query("SELECT id, code, name_zh, revision FROM products ORDER BY id LIMIT 10");
console.log(`[2] Products (${products.length}):`, products.slice(0, 3).map(p => p.code));

// ── [3] BOMs (direct DB — /boms route not mounted) ──
const { rows: boms } = await pool.query(`
  SELECT b.id, p.code AS "productCode", b.revision, b.status
  FROM boms b JOIN products p ON p.id = b.product_id
  WHERE b.status = 'active' ORDER BY b.id LIMIT 5
`);
console.log(`[3] Active BOMs (${boms.length}):`, boms.map(b => `${b.productCode} rev${b.revision}`));

// ── [4] Create work order via API ──
const serialNo = Math.floor(Math.random() * 9000) + 1000;
const now = new Date();
const yy = String(now.getFullYear()).slice(-2);
const mm = String(now.getMonth() + 1).padStart(2, "0");
const woCode = `${yy}${mm}1${"01"}${serialNo}`;  // type=1, line=01

const woRes = await fetch(`${BASE}/pmc/work-orders`, {
  method: "POST",
  headers: hdrs,
  body: JSON.stringify({
    payload: { workOrder: { productCode: products[0].code, lineCode: "L001", plannedQty: 1000, woType: 1 } }
  })
});
const woText = await woRes.text();
console.log(`[4] Create WO: ${woRes.status}`, woText.slice(0, 200));
const woResult = JSON.parse(woText);
const createdCode = woResult.data?.item?.code ?? woCode;
console.log("    WO code:", createdCode);

// ── [5] BOM check for product ──
const { rows: matchingBoms } = await pool.query(`
  SELECT b.id, b.revision, b.status FROM boms b
  JOIN products p ON p.id = b.product_id
  WHERE p.code = $1 AND b.status = 'active'
`, [products[0].code]);
console.log(`[5] BOM check for ${products[0].code}: ${matchingBoms.length} active BOM(s)`);
for (const b of matchingBoms) {
  console.log(`    BOM id=${b.id} revision=${b.revision} status=${b.status}`);
}

// ── [6] Material requirements from bom_lines ──
let bomLines = [];
if (matchingBoms.length > 0) {
  const { rows } = await pool.query(`
    SELECT bl.qty_per AS "qtyPer", bl.loss_rate AS "lossRate",
           m.code AS "materialCode", m.name_zh AS "materialNameZh"
    FROM bom_lines bl JOIN materials m ON m.id = bl.material_id
    WHERE bl.bom_id = $1
  `, [matchingBoms[0].id]);
  bomLines = rows;
  console.log(`[6] BOM lines (${bomLines.length}):`);
  for (const l of bomLines.slice(0, 5)) {
    const reqQty = (l.qtyPer * 1000 * (1 + (l.lossRate ?? 0))).toFixed(2);
    console.log(`    ${l.materialCode} qtyPer=${l.qtyPer} loss=${l.lossRate} → required for 1000 units: ${reqQty}`);
  }
}

// ── [7] Stock check via API ──
for (const line of bomLines.slice(0, 3)) {
  const stockRes = await fetch(`${BASE}/wms/stock?materialCode=${encodeURIComponent(line.materialCode)}`, { headers: hdrs });
  const stockData = await stockRes.json();
  const items = stockData.data?.items ?? [];
  console.log(`[7] Stock for ${line.materialCode}:`, items.length ? items.map(s => `${s.qty} @ ${s.locationCode}`).join(", ") : "NONE");
}

// ── [8] SMT rack search (smart shelf) ──
const { rows: racks } = await pool.query(`
  SELECT sl.code AS "locationCode", sl.area, sl.name_zh
  FROM storage_locations sl
  WHERE sl.area IN ('SMT', 'SMT-SIDE', 'SMT-FEEDER') AND sl.status = 'active'
  LIMIT 5
`);
console.log(`[8] SMT rack locations (${racks.length}):`, racks.map(r => r.locationCode).join(", "));

// Check smart shelf API
const shelfRes = await fetch(`${BASE}/api/wms/shelf/status`, { headers: hdrs });
const shelfStatus = shelfRes.status === 200 ? await shelfRes.json() : null;
console.log("    Smart shelf API:", shelfRes.status, shelfStatus ? `(${shelfStatus.data?.totalShelves ?? 0} shelves)` : "");

// ── [9] List work orders ──
const listRes = await fetch(`${BASE}/pmc/work-orders`, { headers: hdrs });
const listData = await listRes.json();
const woList = listData.data?.items ?? [];
console.log(`[9] Work orders (${woList.length}):`, woList.slice(0, 5).map(w => `${w.code} ${w.status}`));

// ── [10] Release work order ──
if (createdCode) {
  const patchRes = await fetch(`${BASE}/pmc/work-orders/${createdCode}`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ payload: { status: "released" } })
  });
  const patchText = await patchRes.text();
  console.log(`[10] Release WO ${createdCode}: ${patchRes.status}`, patchText.slice(0, 100));
}

await pool.end();
console.log("\n=== DONE ===");