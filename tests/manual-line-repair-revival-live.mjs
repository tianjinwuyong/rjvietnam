import 'dotenv/config';
import { query } from '../services/api/src/db.js';

const BASE = process.env.WMS_API_BASE || 'http://127.0.0.1:8080';
const stamp = Date.now();
const sn = `TEST-REPAIR-${stamp}`;
const batchId = sn;
let workOrderNo = '';
let revivalId = '';

async function call(path, method = 'GET', body) {
  const response = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data.code || data.message || JSON.stringify(data)}`);
  return data;
}

function pass(label, detail = '') { console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`); }

try {
  const motherboard = { batchId, mainSn: sn, subBoards: [{ sn, slot: 1, result: 'FAIL', defectCode: 'TEST_NG' }] };
  const created = await call('/api/station/maintenance-handovers', 'POST', {
    sourceStation: 'manu_aoi', sourceStationName: 'AOI LOCAL PREFLIGHT', ngSn: sn, batchId,
    members: motherboard.subBoards, motherboard, submittedBy: 'LOCAL_PREFLIGHT', firstDetectedAt: stamp,
    repairDeadlineAt: stamp + 2 * 60 * 60 * 1000,
  });
  workOrderNo = created.repairWorkOrderNo;
  if (!workOrderNo) throw new Error('repair work order number missing');
  pass('maintenance handover and work order created', workOrderNo);

  const received = await call('/api/station/maintenance-handovers/receive', 'POST', { sn, stationCode: 'manu_rework' });
  if (received.status !== 'REPAIR_IN_PROGRESS') throw new Error(`unexpected receive status ${received.status}`);
  pass('maintenance scanner receipt', received.status);

  const completed = await call(`/api/station/maintenance-work-orders/${encodeURIComponent(workOrderNo)}/complete`, 'POST', {
    completed: true, operator: 'LOCAL_REPAIR_OPERATOR', repairMethod: 'LOCAL_PREFLIGHT_NO_PART_REPLACEMENT',
    repairResult: 'repaired', materialsConfirmed: true, materials: [],
  });
  if (completed.status !== 'PENDING_QUALITY') throw new Error(`unexpected completion status ${completed.status}`);
  pass('repair completed with material confirmation', completed.status);

  const board = await call('/api/rework/revival-board');
  const revival = board.items?.find(item => item.sn === sn && item.batchId === batchId);
  revivalId = revival?.revivalId;
  if (!revivalId || revival.approvalStatus !== 'PENDING_QUALITY') throw new Error('quality approval item missing');
  pass('revival audit created', `id=${revivalId}`);

  const quality = await call(`/api/rework/revival-board/${revivalId}/approve`, 'POST', {
    role: 'QUALITY', approver: 'LOCAL_QC', reason: 'LOCAL_PREFLIGHT_APPROVED',
  });
  if (quality.status !== 'PENDING_LINE_LEADER') throw new Error(`unexpected quality status ${quality.status}`);
  pass('quality approval', quality.status);

  const leader = await call(`/api/rework/revival-board/${revivalId}/approve`, 'POST', {
    role: 'LINE_LEADER', approver: 'LOCAL_LINE_LEADER', reason: 'LOCAL_PREFLIGHT_APPROVED',
  });
  if (leader.status !== 'APPROVED') throw new Error(`unexpected leader status ${leader.status}`);
  pass('line leader approval', leader.status);

  const returned = await call('/api/rework/clear-ng', 'POST', {
    sn, repairResult: 'pass', operator: 'LOCAL_REPAIR_OPERATOR', batchId,
    originStation: 'manu_aoi', returnStation: 'manu_aoi', defectCode: 'TEST_NG',
  });
  const returnResult = returned.result || returned.data?.result || returned.data?.item?.result;
  if (returnResult !== 'repaired') throw new Error(`unexpected return result ${returnResult}`);
  pass('repair return transfer created', returnResult);

  const accepted = await call('/api/pda/events', 'POST', {
    from: 'local_preflight', to: 'mes_server', type: 'SCAN_GUARD_CHECK', lineCode: 'L004', stationCode: 'manu_aoi',
    payload: { sn, pcbSerial: sn, result: 'CLEAR', lineCode: 'L004', sourceType: 'controlled_test' },
  });
  const state = (await query(`SELECT approval_status FROM ng_revival_audit WHERE revival_id=$1`, [revivalId])).rows[0]?.approval_status;
  if (state !== 'REVIVED') throw new Error(`origin receipt did not revive NG; state=${state}; scan=${JSON.stringify(accepted)}`);
  pass('origin scanner receipt and NG revival', state);
  console.log(`RESULT PASS ${sn}`);
} finally {
  await query(`DELETE FROM station_ng_release_ack WHERE release_id IN (SELECT release_id FROM station_ng_release_events WHERE sn=$1)`, [sn]).catch(() => {});
  await query(`DELETE FROM station_ng_release_events WHERE sn=$1`, [sn]).catch(() => {});
  await query(`DELETE FROM station_repair_material_usage WHERE work_order_no=$1`, [workOrderNo]).catch(() => {});
  await query(`DELETE FROM ng_revival_audit WHERE sn=$1 OR batch_id=$2`, [sn, batchId]).catch(() => {});
  await query(`DELETE FROM station_repair_work_orders WHERE ng_sn=$1 OR batch_id=$2`, [sn, batchId]).catch(() => {});
  await query(`DELETE FROM station_handover_transfers WHERE batch_id=$1`, [batchId]).catch(() => {});
  await query(`DELETE FROM station_route_requests WHERE batch_id=$1`, [batchId]).catch(() => {});
  await query(`DELETE FROM sn_journey_events WHERE sn=$1 OR batch_id=$2`, [sn, batchId]).catch(() => {});
  await query(`DELETE FROM station_data_staging WHERE raw_payload::text LIKE $1`, [`%${sn}%`]).catch(() => {});
  console.log(`Cleanup complete: ${sn}`);
}
