import path from "node:path";
import process from "node:process";
import pg from "pg";
import XLSX from "xlsx";

const sourceFile = path.resolve(process.argv[2] || "apps/web/public/material_label_master.xlsx");
const workbook = XLSX.readFile(sourceFile);
const records = new Map();
const text = (value) => String(value ?? "").trim();

function add(vietnamCode, ruijingCode, specification, supplier, msdLevel, floorLifeHours, sheet) {
  const vietnam = text(vietnamCode);
  const ruijing = text(ruijingCode);
  if (!vietnam || !ruijing) return;
  records.set(vietnam.toUpperCase(), {
    vietnam,
    ruijing,
    specification: text(specification),
    supplier: text(supplier) || null,
    msdLevel: text(msdLevel).replace(/^MS[- ]?/i, "") || null,
    floorLifeHours: Number(text(floorLifeHours).replace(/[^0-9.]/g, "")) || null,
    sheet,
  });
}

const sheet1 = workbook.Sheets.Sheet1;
if (sheet1) {
  const rows = XLSX.utils.sheet_to_json(sheet1, { range: 1, defval: "" });
  for (const row of rows) {
    // WMS screen terminology: 0.xx factory code is the Vietnam code;
    // Rxxxx is the Ruijing-facing code used by this receiving workflow.
    add(row["深圳瑞晶料号"], row["越南东泰料号"], row["规格"], row["供应商"], row.MSD, null, "Sheet1");
  }
}

const ledgerName = "物料仓台账 (2)";
const ledger = workbook.Sheets[ledgerName];
if (ledger) {
  const rows = XLSX.utils.sheet_to_json(ledger, { range: 1, defval: "" });
  for (const row of rows) {
    add(row["RJ物料料号"], row["越南料号"], row["规格型号"], row["供应商"], row["湿敏等级(MSL)"], row["允许开封时长"], ledgerName);
  }
}

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "smt_factory",
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`CREATE TABLE IF NOT EXISTS wms_material_label_master (
    id BIGSERIAL PRIMARY KEY,
    vietnam_material_code VARCHAR(120) NOT NULL UNIQUE,
    ruijing_material_code VARCHAR(120) NOT NULL,
    specification TEXT NOT NULL DEFAULT '', supplier_name VARCHAR(200), msd_level VARCHAR(40), floor_life_hours NUMERIC(10,2),
    source_file VARCHAR(500) NOT NULL, source_sheet VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query("ALTER TABLE wms_material_label_master ADD COLUMN IF NOT EXISTS floor_life_hours NUMERIC(10,2)");
  for (const row of records.values()) {
    await client.query(`INSERT INTO wms_material_label_master
      (vietnam_material_code,ruijing_material_code,specification,supplier_name,msd_level,floor_life_hours,source_file,source_sheet)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(vietnam_material_code) DO UPDATE SET
        ruijing_material_code=EXCLUDED.ruijing_material_code,
        specification=EXCLUDED.specification,
        supplier_name=EXCLUDED.supplier_name,
        msd_level=EXCLUDED.msd_level,
        floor_life_hours=EXCLUDED.floor_life_hours,
        source_file=EXCLUDED.source_file,
        source_sheet=EXCLUDED.source_sheet,
        updated_at=NOW()`, [row.vietnam, row.ruijing, row.specification, row.supplier, row.msdLevel, row.floorLifeHours, path.basename(sourceFile), row.sheet]);
  }
  await client.query("COMMIT");
  const verification = await client.query(`SELECT vietnam_material_code,ruijing_material_code,specification,supplier_name,msd_level,floor_life_hours
    FROM wms_material_label_master WHERE vietnam_material_code=$1`, ["0.14.05.00.0249"]);
  console.log(JSON.stringify({ imported: records.size, verification: verification.rows }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
