import 'dotenv/config';
import { query } from '../services/api/src/db.js';

const base = 'http://127.0.0.1:8080';
const tag = `VTEST-MERGE-${Date.now()}`;
const motherboardId = `${tag}-MB`;
const sns = Array.from({ length: 12 }, (_, i) => `${tag}-S${String(i + 1).padStart(2, '0')}`);

async function send(stationCode, batchId, ngSlots) {
  const subBoards = sns.map((sn, index) => ({
    sn,
    slot: index + 1,
    result: ngSlots.has(index + 1) ? 'FAIL' : 'PASS',
    testTime: new Date().toISOString(),
  }));
  const response = await fetch(`${base}/api/pda/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: `${tag}:${stationCode}`,
      from: 'virtual_merge_audit',
      to: 'mes_server',
      type: 'STATION_TEST_RESULT',
      lineCode: 'L004',
      stationCode,
      payload: {
        batchId,
        motherboardId,
        result: ngSlots.size ? 'FAIL' : 'PASS',
        eventType: `${stationCode}_virtual_merge_test`,
        sourceType: 'controlled_test',
        subBoards,
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${stationCode} HTTP ${response.status}: ${JSON.stringify(body)}`);
}

try {
  await send('manu_ict', motherboardId, new Set([2, 5]));
  await send('manu_fct', `${tag}-FCT`, new Set([5, 9]));

  const merged = (await query(`SELECT motherboard_id,members
    FROM station_confirmed_motherboard_layouts WHERE motherboard_id=$1`, [motherboardId])).rows[0];
  if (!merged) throw new Error('Merged motherboard was not created');

  const counts = merged.members.reduce((out, board) => {
    if (board.ictNg && board.fctNg) out.ICT_FCT_NG += 1;
    else if (board.ictNg) out.ICT_ONLY_NG += 1;
    else if (board.fctNg) out.FCT_ONLY_NG += 1;
    else out.PASS += 1;
    return out;
  }, { ICT_ONLY_NG: 0, FCT_ONLY_NG: 0, ICT_FCT_NG: 0, PASS: 0 });

  const expected = { ICT_ONLY_NG: 1, FCT_ONLY_NG: 1, ICT_FCT_NG: 1, PASS: 9 };
  if (JSON.stringify(counts) !== JSON.stringify(expected)) {
    throw new Error(`Wrong exclusive counts: ${JSON.stringify(counts)}`);
  }
  const badResult = merged.members.find(board =>
    board.result !== ((board.ictNg || board.fctNg) ? 'FAIL' : 'PASS'));
  if (badResult) throw new Error(`Wrong merged result for ${badResult.sn}`);

  console.log(`PASS ${motherboardId} ${JSON.stringify(counts)} totalNG=3`);
} finally {
  await query(`DELETE FROM station_confirmed_motherboard_layouts WHERE motherboard_id=$1`, [motherboardId]);
  await query(`DELETE FROM station_fct_motherboard_staging WHERE batch_id LIKE $1`, [`${tag}%`]);
  await query(`DELETE FROM station_production_events WHERE event_id LIKE $1`, [`${tag}%`]).catch(() => {});
  await query(`DELETE FROM station_data_staging WHERE raw_payload::text LIKE $1`, [`%${tag}%`]).catch(() => {});
  console.log(`Cleanup complete: ${tag}`);
}
