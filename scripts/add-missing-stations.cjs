const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });

// station_type_id mapping:
// 14  = ate_1     → ASSY-ATE-01
// 249 = AGING     → AGING-01
// 251 = SHELL-BIND → CARTON-BIND-01
// production_lines.internal_code = 'L004' = 手动线 id=3

const STATIONS = [
  { code: 'ASSY-ATE-01',    type_id: 14,  ip: '192.168.6.95',   name_zh: '组装ATE测试',  name_en: 'Assembly ATE',    name_vi: 'KT ATE lap rap' },
  { code: 'AGING-01',        type_id: 249, ip: '192.168.6.97',   name_zh: '老化测试',      name_en: 'Aging Test',       name_vi: 'KT gia hoa' },
  { code: 'CARTON-BIND-01', type_id: 251, ip: '192.168.6.100', name_zh: '外箱绑码',      name_en: 'Carton Binding',   name_vi: 'Gan ma hop ngoai' },
];

async function main() {
  const lineR = await p.query(`SELECT id FROM production_lines WHERE internal_code = 'L004' LIMIT 1`);
  const lineId = lineR.rows[0]?.id;
  console.log('Manual line id:', lineId);

  for (const s of STATIONS) {
    const existing = await p.query(`SELECT id FROM stations WHERE code = $1`, [s.code]);
    if (existing.rows.length > 0) {
      await p.query(`
        UPDATE stations SET station_type_id = $1, equipment_code = $2, line_id = $3, updated_at = NOW()
        WHERE code = $4`,
        [s.type_id, s.ip, lineId, s.code]);
      console.log('Updated:', s.code);
    } else {
      await p.query(`
        INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status, created_at, updated_at, required_scan)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW(), true)`,
        [lineId, s.code, s.type_id, s.name_zh, s.name_en, s.name_vi, s.ip]);
      console.log('Inserted:', s.code);
    }
  }

  await p.end();
}
main().catch(e => { console.error(e); p.end(); });
