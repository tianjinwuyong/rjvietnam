import 'dotenv/config';
import { query } from '../services/api/src/db.js';

const base = 'http://127.0.0.1:8080';
const tag = `VTEST-RETEST-${Date.now()}`;
const stations = ['manu_ict', 'manu_fct'];

async function api(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

try {
  for (const stationCode of stations) {
    const sn = `${tag}-${stationCode === 'manu_ict' ? 'ICT' : 'FCT'}`;
    let response = await api('/api/station/retest/mode',
      { stationCode, enabled: true, actor: 'VIRTUAL_OPERATOR' });
    if (response.status !== 200) throw new Error(`${stationCode} mode failed`);

    response = await api('/api/station/retest/arm',
      { stationCode, sn, batchId: `${tag}-MB`, actor: 'VIRTUAL_OPERATOR' });
    if (response.status !== 200 || !response.body?.armed) throw new Error(`${stationCode} first arm failed`);

    response = await api('/api/station/retest/complete',
      { stationCode, sn, result: 'FAIL', actor: 'VIRTUAL_OPERATOR', detail: { virtualTest: true } });
    if (response.status !== 200) throw new Error(`${stationCode} FAIL completion failed`);

    response = await api('/api/station/retest/complete',
      { stationCode, sn, result: 'PASS', actor: 'VIRTUAL_OPERATOR', detail: { virtualTest: true } });
    if (response.status !== 409) throw new Error(`${stationCode} repeated test was accepted without pressing Retest`);

    response = await api('/api/station/retest/arm',
      { stationCode, sn, batchId: `${tag}-MB`, actor: 'VIRTUAL_OPERATOR' });
    if (response.status !== 200 || !response.body?.armed) throw new Error(`${stationCode} second arm failed`);

    response = await api('/api/station/retest/complete',
      { stationCode, sn, result: 'PASS', actor: 'VIRTUAL_OPERATOR', detail: { virtualTest: true } });
    if (response.status !== 200) throw new Error(`${stationCode} PASS completion failed`);

    const history = await query(`SELECT action,result,attempt_no
      FROM station_retest_audit WHERE station_code=$1 AND sn=$2
      AND action='COMPLETED' ORDER BY created_at,audit_id`, [stationCode, sn]);
    if (history.rows.length !== 2 || history.rows[0].result !== 'FAIL'
        || history.rows[1].result !== 'PASS') {
      throw new Error(`${stationCode} immutable history incorrect: ${JSON.stringify(history.rows)}`);
    }
    console.log(`PASS ${stationCode}: button required, FAIL+PASS history retained`);
  }
} finally {
  await query(`DELETE FROM station_retest_audit WHERE sn LIKE $1 OR (sn='*' AND actor='VIRTUAL_OPERATOR')`, [`${tag}%`]);
  await query(`DELETE FROM station_retest_control WHERE sn LIKE $1`, [`${tag}%`]);
  for (const stationCode of stations) {
    await query(`DELETE FROM station_retest_mode WHERE station_code=$1 AND changed_by='VIRTUAL_OPERATOR'`, [stationCode]);
  }
  console.log(`Cleanup complete: ${tag}`);
}
