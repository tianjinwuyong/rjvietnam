const http = require('http');

function shelf(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      hostname: '192.168.6.118', port: 8093,
      path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(resBody) }); }
        catch (e) { resolve({ status: res.statusCode, raw: resBody.substring(0, 200) }); }
      });
    });
    req.on('error', e => reject(e));
    if (data !== '{}') req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Probe shelf controller ===\n');

  // Try different approaches to find registered labels
  const tests = [
    // ShelfIn with different formats
    ['POST', '/api/shelf/ShelfIn', { labelId: 'TSN00001', shelfCode: 'L001A' }],
    ['POST', '/api/shelf/ShelfIn', { labelIdList: ['TSN00001'], shelfCode: 'L001A' }],
    // ShelfOut with TSN format
    ['POST', '/api/shelf/ShelfOut', { labelIdList: ['TSN00001'], color: 6 }],
    ['POST', '/api/shelf/ShelfOut', { labelIdList: ['TSN00002'], color: 6 }],
    ['POST', '/api/shelf/ShelfOut', { labelIdList: ['TEST-R0304-01'], color: 6 }],
    // Light on empty location
    ['POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode: 'L001A', color: 6 }],
    ['POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode: 'L001A', color: 0 }],
  ];

  for (const [method, path, body] of tests) {
    const r = await shelf(method, path, body);
    const bodyStr = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    console.log(`${method} ${path} ${JSON.stringify(body)}`);
    console.log(`  → ${r.status} ${bodyStr.substring(0, 150)}`);
    await sleep(300);
  }

  // Check DB for existing label_ids that might be registered
  console.log('\n=== Check DB for existing labels in shelf_cells ===');
  const { Pool } = require('pg');
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const client = await pool.connect();
  try {
    // Check shelf_cells with existing label_ids (non S4/S5/S6)
    const existing = await client.query(`
      SELECT sc.shelf_code, sc.cell_number, ml.label_id, ml.lot_no
      FROM shelf_cells sc
      JOIN material_lots ml ON ml.id = sc.material_lot_id
      WHERE ml.label_id IS NOT NULL AND ml.label_id NOT LIKE 'S%'
      ORDER BY sc.shelf_code, sc.cell_number
      LIMIT 20
    `);
    console.log('Non-session shelf cells:');
    existing.rows.forEach(r => console.log(`  ${r.shelf_code}/${r.cell_number} label=${r.label_id} lot=${r.lot_no}`));

    // Also check T_ShelfAndLabelInfo via ShelfOutGY probe
    console.log('\n=== Probe T_ShelfAndLabelInfo ===');
    const gy = await shelf('POST', '/api/shelf/ShelfOutGY', { labelIdList: ['TSN00001'] });
    console.log('ShelfOutGY probe:', JSON.stringify(gy));

    // Try InventoryRemoveLable
    const rem = await shelf('POST', '/api/shelf/InventoryRemoveLable', { labelId: 'TSN00001' });
    console.log('InventoryRemoveLable probe:', JSON.stringify(rem));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error('Error:', e.message));
