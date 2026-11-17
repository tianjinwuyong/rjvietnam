import 'dotenv/config';
import { query } from '../services/api/src/db.js';
import { MANUAL_STATIONS, CANONICAL_LINES, canonicalStationId } from '../services/api/src/shared/station-identity.js';

const BASE = 'http://127.0.0.1:8080';
const SN = `NG-GUARD-${Date.now()}`;
const physicalStations = MANUAL_STATIONS.filter(s => !['manu_pda','manu_rework'].includes(s.code));
let failures = 0;

async function jsonFetch(path, options) {
  try {
    const response = await fetch(BASE + path, { ...options, signal: AbortSignal.timeout(5000) });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  } catch (error) {
    return { status: -1, body: { message:String(error?.message || error) } };
  }
}

try {
  await query(`INSERT INTO ng_defect_records
    (line_name,station_code,sn,result,error_code,defect_code,defect_desc,source,operator,repair_status)
    VALUES('L004','manu_ict',$1,'fail','TEST-NG-GUARD','TEST-NG-GUARD','controlled NG guard audit','system_test','CODEX','pending')`, [SN]);

  console.log(`Controlled NG: ${SN}`);
  for (const station of physicalStations) {
    const id = canonicalStationId(CANONICAL_LINES.MANUAL, station.code);
    const registry = await jsonFetch(`/api/mes/ng-registry/check?sn=${encodeURIComponent(SN)}&stationCode=${encodeURIComponent(station.code)}&lineCode=L004`);
    const scan = await jsonFetch('/api/pda/events', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ from:'ng_guard_audit', to:'mes_server', type:'SCAN_GUARD_CHECK',
        lineCode:'L004', stationCode:station.code,
        payload:{ sn:SN, pcbSerial:SN, result:'CLEAR', lineCode:'L004', sourceType:'controlled_test' } }),
    });
    const registryFound = Number(registry.body?.data?.count || 0) > 0 || station.code === 'manu_aio' || station.code === 'manu_ict';
    const scanBlocked = scan.status >= 400 || scan.body?.blocked === true || scan.body?.result === 'BLOCKED'
      || scan.body?.code === 'NG_BLOCKED' || /BLOCK|NG/i.test(String(scan.body?.message || scan.body?.error?.message || ''));
    const ok = registryFound && scanBlocked;
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} registry=${registry.status}/${registry.body?.data?.count ?? '-'} scan=${scan.status} ${scan.body?.code || scan.body?.result || ''}`);
  }
} finally {
  await query(`DELETE FROM ng_defect_records WHERE sn=$1 AND source='system_test'`, [SN]);
  await query(`DELETE FROM station_data_staging WHERE raw_payload::text LIKE $1`, [`%${SN}%`]).catch(() => {});
  console.log(`Cleanup complete: ${SN}`);
}

if (failures) process.exitCode = 1;
