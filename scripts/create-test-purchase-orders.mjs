import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});

const testOrders = [
  { poNo: "TEST-PO-20260830-01", code: "TEST-SMT-R-10K-0603", name: "TEST Chip Resistor 10KΩ 0603", qty: 5000, price: 0.012, lot: "TEST-LOT-20260830-R01" },
  { poNo: "TEST-PO-20260830-02", code: "TEST-SMT-C-100N-0402", name: "TEST MLCC Capacitor 100nF 0402", qty: 12000, price: 0.018, lot: "TEST-LOT-20260830-C01" },
  { poNo: "TEST-PO-20260830-03", code: "TEST-SMT-LED-GRN-0805", name: "TEST Green LED 0805", qty: 3000, price: 0.025, lot: "TEST-LOT-20260830-L01" },
];

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const supplier = (await client.query("SELECT id, code FROM suppliers WHERE status='active' ORDER BY id LIMIT 1")).rows[0];
  const user = (await client.query("SELECT id, display_name FROM users WHERE status='active' ORDER BY id LIMIT 1")).rows[0];
  if (!supplier) throw new Error("No active supplier exists");
  if (!user) throw new Error("No active user exists");

  const result = [];
  for (const item of testOrders) {
    const material = (await client.query(`
      INSERT INTO materials(code,name_zh,name_en,name_vi,uom,material_type,msd_level,status,domain_code,iqc_required)
      VALUES($1,$2,$2,$2,'PCS','COMPONENT','MSD-3','active','RAW_MATERIAL',true)
      ON CONFLICT(code) DO UPDATE SET name_zh=EXCLUDED.name_zh, iqc_required=true
      RETURNING id,code`, [item.code, item.name])).rows[0];
    const total = Number((item.qty * item.price).toFixed(4));

    let po = (await client.query("SELECT id FROM purchase_order_headers WHERE po_no=$1", [item.poNo])).rows[0];
    if (po) {
      await client.query(`UPDATE purchase_order_headers SET supplier_id=$1,order_date=CURRENT_DATE,promised_date=CURRENT_DATE,
        currency_code='USD',status='partially_received',subtotal=$2,total_amount=$2,notes=$3,updated_at=NOW() WHERE id=$4`,
        [supplier.id, total, "TEST DATA · 采购部创建 · 已到货待 WMS/PDA 收料 · 待 IQC", po.id]);
    } else {
      po = (await client.query(`INSERT INTO purchase_order_headers
        (po_no,supplier_id,order_date,promised_date,currency_code,status,subtotal,total_amount,notes,created_by)
        VALUES($1,$2,CURRENT_DATE,CURRENT_DATE,'USD','partially_received',$3,$3,$4,$5) RETURNING id`,
        [item.poNo, supplier.id, total, "TEST DATA · 采购部创建 · 已到货待 WMS/PDA 收料 · 待 IQC", user.id])).rows[0];
    }
    await client.query("DELETE FROM purchase_order_lines WHERE po_header_id=$1", [po.id]);
    await client.query(`INSERT INTO purchase_order_lines
      (po_header_id,line_no,material_id,material_code,description,qty_ordered,qty_received,unit_price,unit,line_total,promised_date,status)
      VALUES($1,1,$2,$3,$4,$5,$5,$6,'PCS',$7,CURRENT_DATE,'partial')`,
      [po.id, material.id, item.code, item.name, item.qty, item.price, total]);

    let receiving = (await client.query("SELECT id FROM receiving_orders WHERE document_no=$1 ORDER BY id DESC LIMIT 1", [item.poNo])).rows[0];
    if (receiving) {
      await client.query("UPDATE receiving_orders SET supplier_id=$1,status='received',received_at=NOW(),operator_id=$2,updated_at=NOW() WHERE id=$3", [supplier.id, user.id, receiving.id]);
    } else {
      receiving = (await client.query(`INSERT INTO receiving_orders(receipt_no,supplier_id,document_no,status,received_at,operator_id)
        VALUES($1,$2,$3,'received',NOW(),$4) RETURNING id`, [`TEST-RCV-${item.poNo.slice(-2)}`, supplier.id, item.poNo, user.id])).rows[0];
    }

    let lot = (await client.query("SELECT id FROM material_lots WHERE lot_no=$1 ORDER BY id DESC LIMIT 1", [item.lot])).rows[0];
    if (lot) {
      await client.query(`UPDATE material_lots SET material_id=$1,supplier_id=$2,received_qty=$3,received_at=NOW(),received_by=$4,receiver_id=$4,
        po_no=$5,iqc_status='pending',lot_status='open',updated_at=NOW(),notes=$6 WHERE id=$7`,
        [material.id, supplier.id, item.qty, user.id, item.poNo, "TEST PO 已到货；等待 WMS/PDA 收料并进入 IQC", lot.id]);
    } else {
      lot = (await client.query(`INSERT INTO material_lots(material_id,supplier_id,lot_no,received_qty,received_at,received_by,receiver_id,po_no,iqc_status,lot_status,notes)
        VALUES($1,$2,$3,$4,NOW(),$5,$5,$6,'pending','open',$7) RETURNING id`,
        [material.id, supplier.id, item.lot, item.qty, user.id, item.poNo, "TEST PO 已到货；等待 WMS/PDA 收料并进入 IQC"])).rows[0];
    }
    await client.query("DELETE FROM receiving_order_lines WHERE receiving_order_id=$1", [receiving.id]);
    await client.query(`INSERT INTO receiving_order_lines(receiving_order_id,line_no,material_id,material_lot_id,lot_no,received_qty,status)
      VALUES($1,1,$2,$3,$4,$5,'pending')`, [receiving.id, material.id, lot.id, item.lot, item.qty]);
    result.push({ poNo: item.poNo, materialCode: item.code, lotNo: item.lot, quantity: item.qty, status: "ARRIVED / IQC_PENDING" });
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ supplier: supplier.code, createdBy: user.display_name, orders: result }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
