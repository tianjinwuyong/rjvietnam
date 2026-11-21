const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, database: 'smt_factory', user: 'postgres', password: 'postgres' });

const areas = [
  { code: 'AREA-R1-C1',     area: 'AREA',          cn: '新仓储区域',     capacity: 30 },
  { code: '新仓储区域-后R1-C1', area: 'AREA-BACK', cn: '新仓储区域-后',  capacity: 30 },
  { code: '前台-R1-C1',     area: '前台',          cn: '前台',           capacity: 15 },
  { code: '后台-R1-C1',     area: '后台',          cn: '后台',           capacity: 20 },
  { code: 'FL-FG-01',       area: 'FINISHED_GOODS', cn: '成品暂存区',    capacity: 20 },
  { code: 'FL-IQC-01',      area: 'IQC_HOLD',      cn: 'IQC检验区',      capacity: 20 },
  { code: 'FL-IQC-NG',      area: 'IQC_NG',        cn: 'IQC不合格区',    capacity: 12 },
  { code: 'FL-IQC-PASS',    area: 'IQC_PASS',      cn: 'IQC合格区',      capacity: 16 },
  { code: 'FL-LINE-01',     area: 'LINE_SIDE',     cn: '线边配送暂存区', capacity: 10 },
  { code: 'FL-LINE-04',     area: 'LINE_SIDE_04',  cn: 'L004线边配送暂存区', capacity: 16 },
  { code: 'FL-NG-01',       area: 'QUARANTINE',    cn: '不良品暂放区',   capacity: 12 },
  { code: 'FL-PALLET-01',   area: 'FLOOR_PALLET',  cn: '地面托盘区',     capacity: 16 },
  { code: 'FL-RECV-01',     area: 'RECEIVING',     cn: '来料待检区',     capacity: 24 },
  { code: 'FL-TOOL-01',     area: 'TOOL_STORAGE',  cn: '工具存储区',     capacity: 20 },
];

const positions = [];
for (const a of areas) {
  for (let i = 1; i <= a.capacity; i++) {
    const loc = `P${String(i).padStart(2,'0')}-01`;
    positions.push({
      area: a.area,
      areaCode: a.code,
      code: `${a.area}-${loc}`,
      qr_code: `${a.code}-${loc}`,
      name_zh: `${a.cn} ${loc}`,
      name_en: `${a.code} ${loc}`,
      name_vi: `${a.code} ${loc}`
    });
  }
}

(async () => {
  await c.connect();
  console.log(`Will insert ${positions.length} storage locations across ${areas.length} areas`);

  let inserted = 0, skipped = 0;
  for (const p of positions) {
    const r = await c.query(
      `INSERT INTO storage_locations (area, code, qr_code, name_zh, name_en, name_vi, status, allow_receiving, allow_transfer, allow_putaway, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', true, true, true, NOW())
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [p.area, p.code, p.qr_code, p.name_zh, p.name_en, p.name_vi]
    );
    if (r.rows.length > 0) inserted++; else skipped++;
  }
  console.log(`Inserted ${inserted}, skipped (existing) ${skipped}`);

  const all = await c.query(`SELECT area, COUNT(*) AS n FROM storage_locations WHERE status='active' AND allow_receiving=true GROUP BY area ORDER BY area`);
  console.log('\nActive receiving areas:');
  console.log(JSON.stringify(all.rows, null, 2));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });