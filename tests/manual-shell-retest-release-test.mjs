import 'dotenv/config';
import { query } from '../services/api/src/db.js';

const BASE = 'http://127.0.0.1:8080';
const sn = `VTEST-SHELL-RETEST-${Date.now()}`;

async function scan() {
  const response = await fetch(`${BASE}/api/pda/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'virtual_audit',
      to: 'mes_server',
      type: 'SCAN_GUARD_CHECK',
      lineCode: 'L004',
      stationCode: 'manu_shellbinding',
      payload: { sn, result: 'CLEAR', sourceType: 'controlled_test' },
    }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

try {
  await query(`INSERT INTO ng_defect_records
    (line_name,station_code,sn,result,error_code,defect_code,defect_desc,source,operator,repair_status)
    VALUES('L004','manu_depanel',$1,'fail','VIRTUAL-NG','VIRTUAL-NG',
      'virtual shell retest release boundary','system_test','CODEX','pending')`, [sn]);

  const before = await scan();
  if (before.status !== 409 || before.body?.code !== 'ACTIVE_NG_CAUGHT') {
    throw new Error(`Expected active NG block, got ${before.status} ${JSON.stringify(before.body)}`);
  }

  await query(`INSERT INTO station_retest_audit
    (station_code,sn,action,attempt_no,actor,result,detail,record_type,is_current,release_status)
    VALUES('manu_depanel',$1,'UNLIMITED_COMPLETED',1,'VIRTUAL_OPERATOR','PASS',
      '{"operatorConfirmedRetest":true,"virtualTest":true}'::jsonb,'RETEST',TRUE,'RELEASED')`, [sn]);

  const after = await scan();
  if (after.status !== 200 || after.body?.allowed !== true) {
    throw new Error(`Expected retest PASS release, got ${after.status} ${JSON.stringify(after.body)}`);
  }

  console.log(`PASS ${sn}: active NG blocked, authorized retest PASS released at shell binding`);
} finally {
  await query(`DELETE FROM station_retest_audit
    WHERE sn LIKE 'VTEST-SHELL-RETEST-%' AND detail->>'virtualTest'='true'`);
  await query(`DELETE FROM ng_defect_records
    WHERE sn LIKE 'VTEST-SHELL-RETEST-%' AND source='system_test'`);
  await query(`DELETE FROM station_interception_events
    WHERE sn LIKE 'VTEST-SHELL-RETEST-%'`).catch(() => {});
  await query(`DELETE FROM station_data_staging
    WHERE raw_payload::text LIKE '%VTEST-SHELL-RETEST-%'`).catch(() => {});
  console.log(`Cleanup complete: ${sn}`);
}
