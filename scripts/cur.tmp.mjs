import pg from "pg";
const p = new pg.Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "smt_factory" });
const a = await p.query("SELECT id, box_qr, lot_no, supplier, supplier_code, material_code, bound_at FROM wms_receiving_pallet_box_bindings ORDER BY id DESC LIMIT 15");
console.log("bindings:", a.rows.length);
for (const x of a.rows) console.log("  ", x.bound_at.toISOString().slice(11, 19), "|", x.box_qr, "| lot", x.lot_no, "| sup", x.supplier, "| code", x.supplier_code, "| mat", x.material_code);
const b = await p.query("SELECT lot_no, label_id, received_qty FROM material_lots ORDER BY id DESC LIMIT 10");
console.log("lots:", b.rows.length);
for (const x of b.rows) console.log("  ", x.lot_no, "| label", x.label_id, "| qty", x.received_qty);
await p.end();
