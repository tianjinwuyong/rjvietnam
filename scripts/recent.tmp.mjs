import pg from "pg";
const p = new pg.Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "smt_factory" });
const a = await p.query("SELECT id, box_qr, lot_no, supplier, location_qr, declared_qty, material_code, bound_at FROM wms_receiving_pallet_box_bindings ORDER BY id DESC LIMIT 15");
console.log("recent bindings:", a.rows.length);
for (const x of a.rows) console.log("  ", x.id, "|", x.box_qr, "| lot", x.lot_no, "| sup", x.supplier, "| qty", x.declared_qty, "| mat", x.material_code);
// materials in the lots
const b = await p.query("SELECT lot_no, material_id, received_qty, manufacturing_date, supplier_id FROM material_lots ORDER BY id DESC LIMIT 12");
console.log("lots:");
for (const x of b.rows) console.log("  ", x.lot_no, "| mat", x.material_id, "| qty", x.received_qty, "| mfg", x.manufacturing_date, "| sup", x.supplier_id);
await p.end();
