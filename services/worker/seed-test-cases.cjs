/**
 * seed-test-cases.js
 * Insert 5 realistic WMS test scenarios into the live database.
 * Run: node seed-test-cases.js
 */
const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'smt_factory',
  user: 'postgres', password: 'postgres',
});

async function main() {
  console.log('=== WMS 5-Test-Case Seed ===\n');

  // ── Case 1: Pending IQC lot with first-time supplier ──────────────────────
  // Ornith should recommend HOLD (first-time supplier, cannot auto-release)
  const supNew = await pool.query("SELECT id FROM suppliers WHERE code='SUP-NEW-01' LIMIT 1");
  const matIC = await pool.query("SELECT id FROM materials WHERE code='MAT-IC-001' LIMIT 1");

  let newSupId, newMatId;
  if (supNew.rows.length === 0) {
    const r = await pool.query(`
      INSERT INTO suppliers (code, name_zh, name_en, name_vi, status)
      VALUES ('SUP-NEW-01', '新越电子 (First-Time)', 'New Viet Electronics', 'New Viet Electronics', 'active')
      RETURNING id`);
    newSupId = r.rows[0].id;
  } else {
    newSupId = supNew.rows[0].id;
  }
  if (matIC.rows.length === 0) {
    const r = await pool.query(`
      INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, msd_level, shelf_life_days, status)
      VALUES ('MAT-IC-001', '集成电路 IC', 'Integrated Circuit', 'IC', 'pcs', 'SMD', 'MSD-3', 365, 'active')
      RETURNING id`);
    newMatId = r.rows[0].id;
  } else {
    newMatId = matIC.rows[0].id;
  }

  const case1Lot = `VN-IQC-${Date.now()}-01`;
  const r1 = await pool.query(`
    INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, created_at)
    VALUES ($1, $2, $3, 500, 'pending', now() - interval '2 hours')
    RETURNING id`, [newMatId, newSupId, case1Lot]);
  console.log(`Case 1 [PENDING-IQC]: lot=${case1Lot} supplier=first-time (should HOLD)`);

  // ── Case 2: Released lot now past shelf-life expiry ──────────────────────
  // Ornith should recommend SCRAP or RETURN
  const supGood = await pool.query("SELECT id FROM suppliers WHERE code='SUP-GOOD-01' LIMIT 1");
  let goodSupId;
  if (supGood.rows.length === 0) {
    const r = await pool.query(`
      INSERT INTO suppliers (code, name_zh, name_en, name_vi, status)
      VALUES ('SUP-GOOD-01', '优质电子', 'Quality Electronics', 'Quality Electronics', 'active')
      RETURNING id`);
    goodSupId = r.rows[0].id;
  } else {
    goodSupId = supGood.rows[0].id;
  }

  const matSolder = await pool.query("SELECT id FROM materials WHERE code='MAT-SOLDER-01' LIMIT 1");
  let solderMatId;
  if (matSolder.rows.length === 0) {
    const r = await pool.query(`
      INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, shelf_life_days, status)
      VALUES ('MAT-SOLDER-01', '焊锡丝', 'Solder Wire', 'Solder', 'roll', 'CONSUMABLE', 180, 'active')
      RETURNING id`);
    solderMatId = r.rows[0].id;
  } else {
    solderMatId = matSolder.rows[0].id;
  }

  const case2Lot = `VN-EXP-${Date.now()}-02`;
  await pool.query(`
    INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, created_at)
    VALUES ($1, $2, $3, 200, 'released', now() - interval '200 days')`,
    [solderMatId, goodSupId, case2Lot]);
  console.log(`Case 2 [EXPIRED-STOCK]: lot=${case2Lot} shelf-life expired (should SCRAP/RETURN)`);

  // ── Case 3: Low stock — material issued to line but reserves exhausted ───
  // Need a released WO + a released lot + issue transaction
  const prodLine = await pool.query("SELECT id FROM production_lines WHERE internal_code='L01' LIMIT 1");
  let lineId = prodLine.rows[0]?.id;
  if (!lineId) {
    const existingNum = await pool.query("SELECT id FROM production_lines WHERE numeric_line_code='01' LIMIT 1");
    if (!existingNum.rows.length) {
      const r = await pool.query(`
        INSERT INTO production_lines (internal_code, numeric_line_code, name_zh, name_en, name_vi, status)
        VALUES ('L01', '01', 'SMT产线1', 'SMT Line 1', 'SMT Line 1', 'idle')
        RETURNING id`);
      lineId = r.rows[0].id;
    } else {
      lineId = existingNum.rows[0].id;
    }
  }

  // Find or create a customer PO + product
  let custId = (await pool.query("SELECT id FROM customers LIMIT 1")).rows[0]?.id;
  if (!custId) {
    custId = (await pool.query(`
      INSERT INTO customers (code, name_zh, name_en, name_vi)
      VALUES ('CUST-001', '测试客户', 'Test Customer', 'Test Customer') RETURNING id`)).rows[0].id;
  }
  let prodId = (await pool.query("SELECT id FROM products LIMIT 1")).rows[0]?.id;
  if (!prodId) {
    prodId = (await pool.query(`
      INSERT INTO products (code, name_zh, name_en, name_vi, revision)
      VALUES ('PROD-001', '测试产品', 'Test Product', 'Test Product', 'A') RETURNING id`)).rows[0].id;
  }
  let poId = (await pool.query("SELECT id FROM customer_pos LIMIT 1")).rows[0]?.id;
  if (!poId) {
    poId = (await pool.query(`
      INSERT INTO customer_pos (po_number, customer_id, product_id, order_qty, due_date)
      VALUES ('PO-TEST-001', $1, $2, 1000, CURRENT_DATE + interval '30 days') RETURNING id`, [custId, prodId])).rows[0].id;
  }

  const woCode = `26061000001`; // 26-06, type=1, line=01, serial=0001
  let woId;
  const existingWo = await pool.query("SELECT id FROM work_orders WHERE code=$1 LIMIT 1", [woCode]);
  if (existingWo.rows.length === 0) {
    const r = await pool.query(`
      INSERT INTO work_orders (code, customer_po_id, product_id, line_id, work_order_type, planned_qty, status, released_at)
      VALUES ($1, $2, $3, $4, 1, 1000, 'released', now() - interval '1 day') RETURNING id`, [woCode, poId, prodId, lineId]);
    woId = r.rows[0].id;
  } else {
    woId = existingWo.rows[0].id;
  }

  const matResistor = await pool.query("SELECT id FROM materials WHERE code='MAT-RES-001' LIMIT 1");
  let resMatId;
  if (matResistor.rows.length === 0) {
    resMatId = (await pool.query(`
      INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, status)
      VALUES ('MAT-RES-001', '贴片电阻 10K', 'Resistor 10K', 'Resistor', 'pcs', 'SMD', 'active')
      RETURNING id`)).rows[0].id;
  } else {
    resMatId = matResistor.rows[0].id;
  }

  const case3Lot = `VN-STOCK-${Date.now()}-03`;
  const locResistor = await pool.query("SELECT id FROM storage_locations WHERE code='SMT-STORE-01' LIMIT 1");
  let locId = locResistor.rows[0]?.id;
  if (!locId) {
    locId = (await pool.query(`
      INSERT INTO storage_locations (code, area, name_zh, name_en, name_vi)
      VALUES ('SMT-STORE-01', 'SMT', 'SMT仓库区', 'SMT Store', 'SMT Store')
      RETURNING id`)).rows[0].id;
  }

  const r3Lot = await pool.query(`
    INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, created_at)
    VALUES ($1, $2, $3, 50, 'released', now() - interval '5 days') RETURNING id`,
    [resMatId, goodSupId, case3Lot]);
  const case3LotId = Number(r3Lot.rows[0].id);

  // Get or create a system user for operator_id
  let opId = (await pool.query("SELECT id FROM users WHERE username='system' LIMIT 1")).rows[0]?.id;
  if (!opId) {
    const roleId = (await pool.query("SELECT id FROM roles LIMIT 1")).rows[0]?.id;
    opId = (await pool.query(`
      INSERT INTO users (username, display_name, role_id)
      VALUES ('system', 'System', $1) RETURNING id`, [roleId || 1])).rows[0].id;
  }

  await pool.query(`
    INSERT INTO inventory_transactions (tx_no, material_lot_id, action, qty, from_location_id, to_location_id, work_order_id, operator_id, occurred_at)
    VALUES ('TX-' || $1 || '-' || $2, $2::bigint, 'ISSUE_TO_LINE', 50, $3::bigint, NULL, $4::bigint, $5::bigint, now() - interval '1 hour')`,
    [case3Lot, case3LotId, locId, woId, opId]);
  console.log(`Case 3 [LOW-STOCK]: WO=${woCode} issued all 50pcs, reserved=50, should flag shortage`);

  // ── Case 4: MSD exposure exceeded limit ─────────────────────────────────
  // Lot with msd_exposure_start set, now exceeded MSL floor life
  const matMSD = await pool.query("SELECT id FROM materials WHERE code='MAT-MSD-001' LIMIT 1");
  let msdMatId;
  if (matMSD.rows.length === 0) {
    msdMatId = (await pool.query(`
      INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, msd_level, shelf_life_days, status)
      VALUES ('MAT-MSD-001', 'BGA芯片', 'BGA Chip', 'BGA', 'pcs', 'SMD', 'MSD-3', 365, 'active')
      RETURNING id`)).rows[0].id;
  } else {
    msdMatId = matMSD.rows[0].id;
  }

  const case4Lot = `VN-MSD-${Date.now()}-04`;
  await pool.query(`
    INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status,
      msd_sealed_at, msd_exposure_start, baking_required, created_at)
    VALUES ($1, $2, $3, 300, 'released',
      now() - interval '10 days', now() - interval '100 hours', true, now() - interval '10 days')`,
    [msdMatId, goodSupId, case4Lot]);
  console.log(`Case 4 [MSD-EXCEEDED]: lot=${case4Lot} exposed 100hrs > 72hr MSD-3 limit (should BLOCK+BAKE)`);

  // ── Case 5: Supplier with poor quality history — incoming lot should HOLD ─
  // Create supplier with <70% pass rate history
  const supBad = await pool.query("SELECT id FROM suppliers WHERE code='SUP-BAD-01' LIMIT 1");
  let badSupId;
  if (supBad.rows.length === 0) {
    badSupId = (await pool.query(`
      INSERT INTO suppliers (code, name_zh, name_en, name_vi, status)
      VALUES ('SUP-BAD-01', '劣质电子', 'Bad Quality Electronics', 'Bad Quality', 'active')
      RETURNING id`)).rows[0].id;
  } else {
    badSupId = supBad.rows[0].id;
  }

  // Add some bad lots for this supplier to establish history
  const badLots = [`VN-BAD-${Date.now()}-05A`, `VN-BAD-${Date.now()}-05B`];
  for (const lotNo of badLots) {
    await pool.query(`
      INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, created_at)
      VALUES ($1, $2, $3, 100, 'rejected', now() - interval '20 days')`,
      [newMatId, badSupId, lotNo]);
  }
  // One good lot
  const goodLot = `VN-BAD-${Date.now()}-05C`;
  await pool.query(`
    INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, created_at)
    VALUES ($1, $2, $3, 100, 'released', now() - interval '20 days')`,
    [newMatId, badSupId, goodLot]);

  const case5Lot = `VN-BAD-${Date.now()}-05D`;
  await pool.query(`
    INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, created_at)
    VALUES ($1, $2, $3, 500, 'pending', now())`,
    [newMatId, badSupId, case5Lot]);
  console.log(`Case 5 [BAD-SUPPLIER]: lot=${case5Lot} supplier=BadQuality (3 rejected / 1 ok = 25% pass, should REJECT+LINE)`);

  console.log('\n=== Seed complete ===');
  console.log('Now run: node wms-manager.js patrol');
  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); process.exit(1); });
