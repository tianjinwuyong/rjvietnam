/**
 * bom-seed-test-scenarios.cjs
 * Seed 5 BOM test scenarios with known abnormalities.
 * Run: node bom-seed-test-scenarios.cjs
 *
 * Scenarios:
 *   1. Phantom material — BOM line references non-existent material
 *   2. Duplicate BOM line — same material twice on same BOM
 *   3. Zero qty — BOM line with qty_per = 0
 *   4. Orphan material — stock exists but no BOM reference
 *   5. Cost spike — material unit cost jumps >20% between revisions
 */

const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'smt_factory',
  user: 'postgres', password: 'postgres',
});

async function main() {
  console.log('=== BOM 5-Test-Case Seed ===\n');

  // ── Ensure material_prices table exists for scenario 5 ─────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_prices (
      id BIGSERIAL PRIMARY KEY,
      material_id BIGINT NOT NULL REFERENCES materials(id),
      product_id BIGINT NOT NULL REFERENCES products(id),
      unit_price NUMERIC(18,4) NOT NULL,
      effective_date TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(material_id, product_id, effective_date)
    )
  `);
  console.log('Table material_prices ready');

  // ── 1. Phantom material reference ───────────────────────────────────
  // Insert a bom_line with a material_id that doesn't exist in materials
  const phantProd = await pool.query(
    `INSERT INTO products (code, name_zh, name_en, name_vi, revision, status)
     VALUES ('BOM-TEST-PHANTOM', '测试-BOM幻影物料', 'Test Phantom', 'Test Phantom', 'V1', 'active')
     ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`
  );
  const phantBom = await pool.query(
    `INSERT INTO boms (product_id, revision, status)
     VALUES ($1, 'V1', 'active')
     ON CONFLICT (product_id, revision) DO NOTHING
     RETURNING id`, [phantProd.rows[0].id]
  );
  let phantBomId = phantBom.rows[0]?.id;
  if (!phantBomId) {
    const r = await pool.query('SELECT id FROM boms WHERE product_id=$1 AND revision=$2',
      [phantProd.rows[0].id, 'V1']);
    phantBomId = r.rows[0].id;
  }
  // FK constraint prevents deleting a material referenced by bom_lines.
  // Instead, we mark the material as 'inactive' — the phantom query should
  // check for non-active materials referenced by active BOM lines.
  const phantMat = await pool.query(
    `INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, status)
     VALUES ('BOM-PHANTOM-MAT', '幻影物料(非活跃)', 'Phantom Mat', 'Phantom Mat', 'PCS', 'component', 'inactive')
     ON CONFLICT (code) DO UPDATE SET status = 'inactive' RETURNING id`
  );
  let phantMatId;
  if (phantMat.rows[0]?.id) {
    phantMatId = phantMat.rows[0].id;
  } else {
    const r = await pool.query("SELECT id FROM materials WHERE code='BOM-PHANTOM-MAT'");
    phantMatId = r.rows[0].id;
  }

  await pool.query(
    `INSERT INTO bom_lines (bom_id, material_id, qty_per)
     VALUES ($1, $2, 1.0) ON CONFLICT DO NOTHING`,
    [phantBomId, phantMatId]
  );
  console.log('Case 1 [PHANTOM]: BOM line references inactive material (deemed phantom)');

  // ── 2. Duplicate BOM line ──────────────────────────────────────────
  const dupProd = await pool.query(
    `INSERT INTO products (code, name_zh, name_en, name_vi, revision, status)
     VALUES ('BOM-TEST-DUP', '测试-BOM重复物料', 'Test Duplicate', 'Test Duplicate', 'V1', 'active')
     ON CONFLICT (code) DO UPDATE SET code=EXCLUDED.code RETURNING id`
  );
  const dupBom = await pool.query(
    `INSERT INTO boms (product_id, revision, status)
     VALUES ($1, 'V1', 'active')
     ON CONFLICT (product_id, revision) DO NOTHING RETURNING id`, [dupProd.rows[0].id]
  );
  let dupBomId = dupBom.rows[0]?.id;
  if (!dupBomId) {
    const r = await pool.query('SELECT id FROM boms WHERE product_id=$1 AND revision=$2',
      [dupProd.rows[0].id, 'V1']);
    dupBomId = r.rows[0].id;
  }
  const dupMat = await pool.query(
    `INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, status)
     VALUES ('BOM-DUP-MAT', '重复物料(测试用)', 'Duplicate Mat', 'Duplicate Mat', 'PCS', 'component', 'active')
     ON CONFLICT (code) DO NOTHING RETURNING id`
  );
  let dupMatId = dupMat.rows[0]?.id;
  if (!dupMatId) {
    const r = await pool.query("SELECT id FROM materials WHERE code='BOM-DUP-MAT'");
    dupMatId = r.rows[0].id;
  }
  // Insert the same material twice (allow via qty_per difference to not hit unique constraint... but there's no unique!)
  await pool.query('INSERT INTO bom_lines (bom_id, material_id, reference_designators, qty_per) VALUES ($1, $2, $3, 1.0) ON CONFLICT DO NOTHING',
    [dupBomId, dupMatId, 'R1']);
  await pool.query('INSERT INTO bom_lines (bom_id, material_id, reference_designators, qty_per) VALUES ($1, $2, $3, 2.0) ON CONFLICT DO NOTHING',
    [dupBomId, dupMatId, 'R2']);
  console.log('Case 2 [DUPLICATE]: Material inserted twice on same BOM');

  // ── 3. Zero qty line ───────────────────────────────────────────────
  const zeroProd = await pool.query(
    `INSERT INTO products (code, name_zh, name_en, name_vi, revision, status)
     VALUES ('BOM-TEST-ZERO', '测试-BOM零数量', 'Test Zero Qty', 'Test Zero Qty', 'V1', 'active')
     ON CONFLICT (code) DO UPDATE SET code=EXCLUDED.code RETURNING id`
  );
  const zeroBom = await pool.query(
    `INSERT INTO boms (product_id, revision, status)
     VALUES ($1, 'V1', 'active')
     ON CONFLICT (product_id, revision) DO NOTHING RETURNING id`, [zeroProd.rows[0].id]
  );
  let zeroBomId = zeroBom.rows[0]?.id;
  if (!zeroBomId) {
    const r = await pool.query('SELECT id FROM boms WHERE product_id=$1 AND revision=$2',
      [zeroProd.rows[0].id, 'V1']);
    zeroBomId = r.rows[0].id;
  }
  const zeroMat = await pool.query(
    `INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, status)
     VALUES ('BOM-ZERO-MAT', '零数量物料(测试用)', 'Zero Qty Mat', 'Zero Qty Mat', 'PCS', 'component', 'active')
     ON CONFLICT (code) DO NOTHING RETURNING id`
  );
  let zeroMatId = zeroMat.rows[0]?.id;
  if (!zeroMatId) {
    const r = await pool.query("SELECT id FROM materials WHERE code='BOM-ZERO-MAT'");
    zeroMatId = r.rows[0].id;
  }
  await pool.query(
    'INSERT INTO bom_lines (bom_id, material_id, qty_per) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING',
    [zeroBomId, zeroMatId]);
  console.log('Case 3 [ZERO-QTY]: BOM line with qty_per = 0 inserted');

  // ── 4. Orphan inventory (material with stock but NO BOM) ────────────
  const orpMat = await pool.query(
    `INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, status)
     VALUES ('BOM-ORPHAN-MAT', '孤儿物料(有库存无BOM)', 'Orphan Mat', 'Orphan Mat', 'PCS', 'component', 'active')
     ON CONFLICT (code) DO NOTHING RETURNING id`
  );
  let orpMatId = orpMat.rows[0]?.id;
  if (!orpMatId) {
    const r = await pool.query("SELECT id FROM materials WHERE code='BOM-ORPHAN-MAT'");
    orpMatId = r.rows[0].id;
  }
  // Create a supplier first
  const orpSup = await pool.query(
    `INSERT INTO suppliers (code, name_zh, name_en, name_vi, status)
     VALUES ('SUP-ORPHAN', '孤儿供应商', 'Orphan Supplier', 'Orphan Supplier', 'active')
     ON CONFLICT (code) DO NOTHING RETURNING id`
  );
  let orpSupId = orpSup.rows[0]?.id;
  if (!orpSupId) {
    const r = await pool.query("SELECT id FROM suppliers WHERE code='SUP-ORPHAN'");
    orpSupId = r.rows[0].id;
  }
  // Create a storage location for the material lot
  const orpLoc = await pool.query(
    `INSERT INTO storage_locations (code, area, name_zh, name_en, name_vi)
     VALUES ('ORPHAN-LOC-01', 'TEST', '孤儿库位', 'Orphan Loc', 'Orphan Loc')
     ON CONFLICT (code) DO NOTHING RETURNING id`
  );
  // Insert a material lot with released status (so it contributes to inventory)
  await pool.query(`
    INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, created_at)
    VALUES ($1, $2, 'LOT-ORPHAN-001', 100, 'released', now())
    ON CONFLICT (lot_no) DO NOTHING
  `, [orpMatId, orpSupId]);
  console.log('Case 4 [ORPHAN]: Material with 100 stock, no BOM reference');

  // ── 5. Cost spike >20% ──────────────────────────────────────────────
  // Need a product with two BOM revisions + material prices across them
  const spikeProd = await pool.query(
    `INSERT INTO products (code, name_zh, name_en, name_vi, revision, status)
     VALUES ('BOM-TEST-SPIKE', '测试-BOM成本飙升', 'Test Cost Spike', 'Test Cost Spike', 'V1', 'active')
     ON CONFLICT (code) DO UPDATE SET code=EXCLUDED.code RETURNING id`
  );
  const spikeProdId = spikeProd.rows[0].id;

  // BOM revision V1 (old, cheaper)
  const spikeBomV1 = await pool.query(
    `INSERT INTO boms (product_id, revision, status)
     VALUES ($1, 'V1', 'obsolete')
     ON CONFLICT (product_id, revision) DO NOTHING RETURNING id`, [spikeProdId]
  );
  let spikeBomV1Id = spikeBomV1.rows[0]?.id;
  if (!spikeBomV1Id) {
    const r = await pool.query('SELECT id FROM boms WHERE product_id=$1 AND revision=$2',
      [spikeProdId, 'V1']);
    spikeBomV1Id = r.rows[0].id;
  }

  // BOM revision V2 (current, expensive)
  const spikeBomV2 = await pool.query(
    `INSERT INTO boms (product_id, revision, status)
     VALUES ($1, 'V2', 'active')
     ON CONFLICT (product_id, revision) DO NOTHING RETURNING id`, [spikeProdId]
  );
  let spikeBomV2Id = spikeBomV2.rows[0]?.id;
  if (!spikeBomV2Id) {
    const r = await pool.query('SELECT id FROM boms WHERE product_id=$1 AND revision=$2',
      [spikeProdId, 'V2']);
    spikeBomV2Id = r.rows[0].id;
  }

  // Material with price spike
  const spikeMat = await pool.query(
    `INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, status)
     VALUES ('BOM-SPIKE-MAT', '飙升物料(成本测试)', 'Cost Spike Mat', 'Cost Spike Mat', 'PCS', 'component', 'active')
     ON CONFLICT (code) DO NOTHING RETURNING id`
  );
  let spikeMatId = spikeMat.rows[0]?.id;
  if (!spikeMatId) {
    const r = await pool.query("SELECT id FROM materials WHERE code='BOM-SPIKE-MAT'");
    spikeMatId = r.rows[0].id;
  }

  // Add bom_lines referencing the spike material
  await pool.query(
    'INSERT INTO bom_lines (bom_id, material_id, qty_per) VALUES ($1, $2, 1.0) ON CONFLICT DO NOTHING',
    [spikeBomV1Id, spikeMatId]);
  await pool.query(
    'INSERT INTO bom_lines (bom_id, material_id, qty_per) VALUES ($1, $2, 1.0) ON CONFLICT DO NOTHING',
    [spikeBomV2Id, spikeMatId]);

  // Insert prices: V1 = $1.00, V2 = $1.50 (>20% jump)
  await pool.query(`
    INSERT INTO material_prices (material_id, product_id, unit_price, effective_date)
    VALUES ($1, $2, 1.00, '2025-01-01') ON CONFLICT (material_id, product_id, effective_date) DO NOTHING`,
    [spikeMatId, spikeProdId]);
  await pool.query(`
    INSERT INTO material_prices (material_id, product_id, unit_price, effective_date)
    VALUES ($1, $2, 1.50, '2026-01-01') ON CONFLICT (material_id, product_id, effective_date) DO NOTHING`,
    [spikeMatId, spikeProdId]);
  console.log('Case 5 [COST-SPIKE]: Material price $1.00 → $1.50 (+50%) across BOM revisions');

  console.log('\n=== BOM 5-Test-Case Seed Complete ===');
  await pool.end();
}

main().catch(e => {
  console.error('Seed error:', e.message);
  process.exit(1);
});
