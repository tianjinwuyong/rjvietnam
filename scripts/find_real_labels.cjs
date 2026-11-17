const http = require('http');
const { Pool } = require('pg');

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
        catch (e) { resolve({ status: r.statusCode, raw: resBody.substring(0, 200) }); }
      });
    });
    req.on('error', e => reject(e));
    if (data !== '{}') req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const client = await pool.connect();

  // Get labels from DB that are in shelf_cells
  const dbLabels = await client.query(`
    SELECT DISTINCT ml.label_id, sc.shelf_code, sc.cell_number
    FROM shelf_cells sc
    JOIN material_lots ml ON ml.id = sc.material_lot_id
    WHERE ml.label_id IS NOT NULL AND ml.label_id NOT LIKE 'S%'
    ORDER BY sc.shelf_code, sc.cell_number
    LIMIT 20
  `);
  console.log('DB shelf labels (non S-prefix):');
  dbLabels.rows.forEach(r => console.log(`  ${r.shelf_code}/${r.cell_number} → ${r.label_id}`));

  // Also check what labels exist in material_lots
  const allLabels = await client.query(`
    SELECT label_id, lot_no FROM material_lots WHERE label_id IS NOT NULL ORDER BY label_id LIMIT 20
  `);
  console.log('\nAll material_lots label_ids:');
  allLabels.rows.forEach(r => console.log(`  ${r.label_id} (${r.lot_no})`));

  await client.release();
  await pool.end();

  // Test ShelfOut with the TEST-IN-001 label that the controller mentioned
  console.log('\n=== Test ShelfOut with TEST-IN-001 ===');
  const r1 = await shelf('POST', '/api/shelf/ShelfOut', { labelIdList: ['TEST-IN-001'], color: 6 });
  console.log('Result:', JSON.stringify(r1));
  await sleep(2000);
  const r2 = await shelf('POST', '/api/shelf/ShelfOut', { labelIdList: ['TEST-IN-001'], color: 0 });
  console.log('Off:', JSON.stringify(r2));

  // Test with DB labels
  console.log('\n=== Test ShelfOut with DB labels ===');
  for (const row of dbLabels.rows.slice(0, 5)) {
    const r = await shelf('POST', '/api/shelf/ShelfOut', { labelIdList: [row.label_id], color: 6 });
    console.log(`  ${row.label_id}: ${r.status} ${typeof r.data === 'string' ? r.data : JSON.stringify(r.data)?.substring(0, 100)}`);
    await sleep(500);
  }
}

main().catch(e => console.error('Error:', e.message));
