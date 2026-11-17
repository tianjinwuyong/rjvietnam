import pg from "pg";
const p = new pg.Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "smt_factory" });
const MAT = "2.00.00.55.0006", SUP = "RUIJING";
try {
  const mat = (await p.query(`SELECT id FROM materials WHERE code=$1`, [MAT])).rows[0];
  const sup = (await p.query(`SELECT id FROM suppliers WHERE code=$1`, [SUP])).rows[0];
  console.log("mat", mat.id, "sup", sup.id);
  const lots = [
    { lot: "FG-EPS18-260727-A", mfg: "2026-07-27", qty: 1728, boxes: 18 },
    { lot: "FG-EPS18-260820-B", mfg: "2026-08-20", qty: 1728, boxes: 18 },
    { lot: "FG-EPS18-260910-C", mfg: "2026-09-10", qty: 1544, boxes: 17 },
  ];
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    let seq = 1;
    for (const L of lots) {
      const lr = await c.query(`INSERT INTO material_lots(material_id,supplier_id,lot_no,received_qty,iqc_status,lot_status,manufacturing_date,received_at,is_test) VALUES($1,$2,$3,$4,'released','open',$5::date,$5::timestamptz,true) RETURNING id`,
        [mat.id, sup.id, L.lot, L.qty, L.mfg]);
      const lotId = lr.rows[0].id;
      await c.query(`INSERT INTO inventory_transactions(tx_no,action,material_lot_id,qty,operator_id,tx_status,reference_type,reference_no) VALUES($1,'RECEIVE',$2,$3,3,'posted','FINISHED_PRODUCTION',$4)`,
        [`RCV-FG-${Date.now()}-${lotId}`, lotId, L.qty, L.lot]);
      for (let b = 0; b < L.boxes; b++) {
        const isLast = (L.lot === "FG-EPS18-260910-C" && b === L.boxes - 1);
        const q = isLast ? 8 : 96;
        const rno = "R" + String(seq).padStart(3, "0");
        const qr = `${SUP}*${MAT}*${L.mfg}*${q}*${L.lot}*${rno}`;
        await c.query(`INSERT INTO wms_receiving_pallet_box_bindings(pallet_qr,box_qr,lot_no,supplier,location_qr,bound_by,declared_qty,material_code) VALUES($1,$2,$3,'瑞晶自制','RECV-01','box-setup',$6,$7)`,
          [`PALLET-FG-${L.lot}`, qr, L.lot, q, MAT]);
        seq++;
      }
      console.log("lot", L.lot, "id", lotId, "qty", L.qty, "boxes", L.boxes);
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; }
  c.release();
  const chk = await p.query(`SELECT count(*)::int c, COALESCE(SUM(declared_qty),0)::int q FROM wms_receiving_pallet_box_bindings WHERE lot_no LIKE 'FG-EPS18-%'`);
  console.log("bindings:", JSON.stringify(chk.rows[0]));
} catch (e) { console.log("ERR", e.message.slice(0, 200)); }
await p.end();
