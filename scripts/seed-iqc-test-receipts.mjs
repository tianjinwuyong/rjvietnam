import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  options: "-c search_path=public",
});

const materials = [
  ["TEST-IQC-R-10K-0603", "TEST Chip Resistor 10KΩ 0603", 5000, 38],
  ["TEST-IQC-C-100N-0402", "TEST MLCC Capacitor 100nF 0402", 12000, 73],
  ["TEST-IQC-LED-GRN-0805", "TEST Green LED 0805", 3000, 168],
];

const client = await pool.connect();
try {
  await client.query("BEGIN");
  if (process.argv.includes("--delete")) {
    await client.query("DELETE FROM wms_receiving_qr_registrations WHERE material_qr LIKE 'TEST-IQC-QR-%'");
    await client.query("DELETE FROM inventory_transactions WHERE tx_no LIKE 'TEST-IQC-RCV-%'");
    await client.query("DELETE FROM material_lots WHERE lot_no LIKE 'TEST-IQC-PO-%'");
    await client.query("DELETE FROM materials WHERE code LIKE 'TEST-IQC-%'");
    await client.query("COMMIT");
    console.log("Deleted IQC test receiving data.");
  } else {
    await client.query(`CREATE TABLE IF NOT EXISTS wms_receiving_qr_registrations(
      material_lot_id BIGINT PRIMARY KEY REFERENCES material_lots(id),
      material_qr VARCHAR(200) NOT NULL UNIQUE,
      pallet_qr VARCHAR(200) NOT NULL UNIQUE,
      location_code VARCHAR(120), registered_by VARCHAR(120) NOT NULL DEFAULT 'test-seed',
      registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query("ALTER TABLE wms_receiving_qr_registrations ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) DEFAULT 'PO_RECEIPT'");
    await client.query("ALTER TABLE wms_receiving_qr_registrations ADD COLUMN IF NOT EXISTS warehouse_code VARCHAR(120)");
    await client.query("ALTER TABLE wms_receiving_qr_registrations ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'IQC_PENDING'");
    await client.query("ALTER TABLE wms_receiving_qr_registrations ADD COLUMN IF NOT EXISTS quantity NUMERIC(18,3)");
    await client.query("ALTER TABLE wms_receiving_qr_registrations ADD COLUMN IF NOT EXISTS document_no VARCHAR(160)");

    const supplier = (await client.query("SELECT id FROM suppliers ORDER BY id LIMIT 1")).rows[0];
    if (!supplier) throw new Error("No supplier exists; create a supplier before seeding receiving data.");
    const operator = (await client.query("SELECT id FROM users ORDER BY id LIMIT 1")).rows[0];
    if (!operator) throw new Error("No user exists; create a user before seeding receiving data.");

    for (let i = 0; i < materials.length; i += 1) {
      const [code, name, qty, waitMinutes] = materials[i];
      const material = (await client.query(`
        INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, status, domain_code)
        VALUES ($1,$2,$2,$2,'PCS','COMPONENT','active','RAW_MATERIAL')
        ON CONFLICT (code) DO UPDATE SET name_zh=EXCLUDED.name_zh
        RETURNING id`, [code, name])).rows[0];
      const lotNo = `TEST-IQC-PO-${String(i + 1).padStart(2, "0")}`;
      const existingLot = (await client.query("SELECT id FROM material_lots WHERE lot_no=$1 ORDER BY id DESC LIMIT 1", [lotNo])).rows[0];
      const lot = existingLot
        ? (await client.query("UPDATE material_lots SET received_qty=$1,iqc_status='pending',received_at=NOW()-($2 || ' minutes')::interval WHERE id=$3 RETURNING id", [qty, waitMinutes, existingLot.id])).rows[0]
        : (await client.query("INSERT INTO material_lots (material_id,supplier_id,lot_no,received_qty,iqc_status,received_at) VALUES ($1,$2,$3,$4,'pending',NOW()-($5 || ' minutes')::interval) RETURNING id", [material.id, supplier.id, lotNo, qty, waitMinutes])).rows[0];
      await client.query("DELETE FROM inventory_transactions WHERE tx_no=$1", [`TEST-IQC-RCV-${i + 1}`]);
      await client.query(`
        INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, operator_id, tx_status, reference_type, reference_no, occurred_at)
        VALUES ($1,'RECEIVE',$2,$3,$4,'posted','TEST_PO_RECEIPT',$5,NOW() - ($6 || ' minutes')::interval)`, [`TEST-IQC-RCV-${i + 1}`, lot.id, qty, operator.id, lotNo, waitMinutes]);
      await client.query(`
        INSERT INTO wms_receiving_qr_registrations
          (material_lot_id,material_qr,pallet_qr,location_code,registered_by,source_type,warehouse_code,status,quantity,document_no,registered_at,updated_at)
        VALUES ($1,$2,$3,$4,'TEST-SEED','PO_RECEIPT','IQC_HOLD','IQC_PENDING',$5,$6,NOW() - ($7 || ' minutes')::interval,NOW() - ($7 || ' minutes')::interval)
        ON CONFLICT (material_lot_id) DO UPDATE SET status='IQC_PENDING',source_type='PO_RECEIPT',quantity=EXCLUDED.quantity,updated_at=EXCLUDED.updated_at`,
        [lot.id, `TEST-IQC-QR-${i + 1}`, `TEST-IQC-PALLET-${i + 1}`, `IQC-A01-0${i + 1}`, qty, `TEST-IQC-PO-QR-${i + 1}`, waitMinutes]);
    }
    await client.query("COMMIT");
    console.log(`Seeded ${materials.length} TEST PO receipts for IQC.`);
    console.log("Run: node scripts/seed-iqc-test-receipts.mjs --delete");
  }
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
