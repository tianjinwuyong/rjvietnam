const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

async function main() {
  // Insert missing station types
  const typeInserts = [
    ["AGING", "老化", "Aging", "Gia hoa", "production", true, false],
    ["PACK-ATE", "包装ATE", "Packaging ATE", "Dong goi ATE", "production", true, true],
    ["SHELL-BIND", "外箱绑码", "Shell Binding", "Gan ma hop ngoai", "production", true, true],
    ["PALLET-BIND", "栈板绑码", "Pallet Binding", "Gan ma khay", "production", true, true],
    ["ASM-ATE", "组装ATE", "Assembly ATE", "ATE Lap rap", "production", true, true],
    ["MAT-LOAD", "投料", "Material Loading", "Nap lieu", "production", false, true],
  ];

  const typeIds = {};
  for (const t of typeInserts) {
    const r = await p.query(
      `INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,
      t
    );
    const id = r.rows[0].id;
    typeIds[t[0]] = id;
    console.log(`Station type ${t[0]}: id=${id}`);
  }

  // L001 = line_id 5 (auto), L002 = line_id 1 (manual)
  const stationInserts = [
    // [line_id, code, type_code, name_zh, name_en, name_vi]
    [5, "AGING-CAB-01", "AGING", "老化柜", "Aging Cabinet", "Tu gia hoa"],
    [5, "MAT-LOAD-01", "MAT-LOAD", "投料", "Material Loading", "Nap lieu"],
    [1, "PACK-ATE-01", "PACK-ATE", "包装ATE", "Packaging ATE", "Dong goi ATE"],
    [1, "ASM-ATE1-01", "ASM-ATE", "组装ATE", "Assembly ATE", "ATE Lap rap"],
    [1, "SHELL-BIND-01", "SHELL-BIND", "外箱绑码", "Shell Binding", "Gan ma hop ngoai"],
    [1, "PALLET-BIND-01", "PALLET-BIND", "栈板绑码", "Pallet Binding", "Gan ma khay"],
  ];

  for (const s of stationInserts) {
    const [lineId, code, typeCode, nameZh, nameEn, nameVi] = s;
    const typeId = typeIds[typeCode];
    const r = await p.query(
      `INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
       VALUES ($1,$2,$3,$4,$5,$6,'idle')
       ON CONFLICT (line_id, code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,
      [lineId, code, typeId, nameZh, nameEn, nameVi]
    );
    console.log(`Station ${code} (line=${lineId}, type=${typeCode}): id=${r.rows[0].id}`);
  }

  console.log("Done.");
  await p.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
