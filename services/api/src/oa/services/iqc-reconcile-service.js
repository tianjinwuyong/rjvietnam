// ============================================================
// iqc-reconcile-service —— IQC 跨系统对账（OA ↔ WMS）
//
// 三类差异（按危险程度排序）：
//   1) 🔴 悬空库存：WMS 批次已判定，但库存还挂在 pending_qc
//        —— 说明落账没跑完（回填失败/事务回滚），货既不能领也不能判，必须人工介入
//   2) 🟠 OA 已审批但 WMS 未落账（wms_synced=false）
//        —— 通常是 WMS 不可达，重试即可
//   3) 🟡 WMS 已判定但 OA 没有对应记录
//        —— 说明这批是在 WMS 直接做的（过渡期正常），或推送丢失
//
// 读 WMS 用只读角色（oa_ro），不写 WMS 任何数据。
// ============================================================
import { many, one } from '../db/index.js';
import { wmsQuery, wmsPing } from '../db/wms.js';

/**
 * @param {{days?:number}} opts 只对账最近 N 天（默认 30，避免历史数据噪声）
 */
export async function runReconcile({ days = 30 } = {}) {
  const n = Math.min(365, Math.max(1, Number(days) || 30));
  const available = await wmsPing();
  if (!available) {
    return {
      wmsAvailable: false,
      items: [],
      summary: { red: 0, orange: 0, yellow: 0, total: 0 },
      note: 'WMS 库不可达，本次对账跳过',
    };
  }

  // --- WMS 侧事实 ---
  const wmsJudged = await wmsQuery(
    `SELECT l.lot_no, l.status, l.inspection_result, l.receipt_date::text AS receipt_date,
            m.material_code, m.material_name
       FROM iqc_lot l LEFT JOIN material m ON m.id = l.material_id
      WHERE l.status IN ('pass','fail')
        AND l.receipt_date >= current_date - $1::int
      ORDER BY l.receipt_date DESC
      LIMIT 500`,
    [n]
  );

  const pendingQcLeak = await wmsQuery(
    `SELECT l.lot_no, l.status, i.quantity::text AS qty, i.batch_no, m.material_code
       FROM iqc_lot l
       JOIN inventory i ON i.material_id = l.material_id AND i.batch_no = l.batch_no
       LEFT JOIN material m ON m.id = l.material_id
      WHERE l.status IN ('pass','fail')
        AND i.stock_status = 'pending_qc' AND i.quantity > 0
        AND l.receipt_date >= current_date - $1::int
      LIMIT 200`,
    [n]
  );

  // --- OA 侧事实 ---
  const mirrors = await many(
    `SELECT lot_no, status, material_code, material_name, created_at
       FROM iqc_lot_mirror
      WHERE created_at >= now() - ($1 || ' days')::interval`,
    [String(n)]
  );
  const mirrorMap = new Map(mirrors.map(m => [m.lot_no, m]));

  // 上线分界：OA 接管之前的历史批次本来就只在 WMS 做过（决策：历史不迁），
  // 一律标黄只会变成噪音。这里以「最早一条镜像的创建日」作为分界，
  // 只对分界之后的批次做"WMS 有判定但 OA 无记录"的判断。
  const boundary = await one(`SELECT min(created_at)::date::text AS d FROM iqc_lot_mirror`);
  const goLive = process.env.IQC_OA_GOLIVE || boundary?.d || null;

  const items = [];

  // 1) 红线：库存悬空
  for (const r of pendingQcLeak) {
    items.push({
      level: 'red',
      type: 'pending_qc_leak',
      lotNo: r.lot_no,
      materialCode: r.material_code,
      detail: `批次已判定（${r.status}），但 ${r.batch_no} 仍有 ${r.qty} 挂在待检库存`,
      hint: '检查 WMS 审批事务是否失败；必要时人工核库存并重跑落账',
    });
  }

  // 2) OA 已审批未落账
  //    · 仍在自动重试中（manual_required=false）→ 不算差异，只计数（否则每次对账都报同一批）
  //    · 已转人工（manual_required=true）→ 🟠 真正的待处理项，必须人工介入
  const notSynced = await many(
    `SELECT r.id, r.lot_no, r.report_no, r.wms_sync_error, r.manual_required,
            r.backfill_attempts, r.next_retry_at
       FROM iqc_record r
      WHERE r.approval = 'approved' AND r.wms_synced = FALSE
      LIMIT 200`
  );
  let retrying = 0;
  for (const r of notSynced) {
    if (!r.manual_required) { retrying++; continue; }
    items.push({
      level: 'orange',
      type: 'oa_backfill_dead',
      lotNo: r.lot_no,
      reportNo: r.report_no,
      detail: `OA 已审批但回填 WMS 连续 ${r.backfill_attempts} 次失败（已转人工）`
        + (r.wms_sync_error ? `：${r.wms_sync_error}` : ''),
      hint: '排查 WMS 可用性与报告状态后，手工点「审批回填」',
    });
  }

  // 3) WMS 已判定但 OA 无记录（只看上线之后，避免历史数据噪声）
  for (const j of wmsJudged) {
    if (goLive && j.receipt_date && String(j.receipt_date).slice(0, 10) < String(goLive).slice(0, 10)) continue;
    if (!mirrorMap.has(j.lot_no)) {
      items.push({
        level: 'yellow',
        type: 'wms_judged_no_oa',
        lotNo: j.lot_no,
        materialCode: j.material_code,
        detail: `WMS 已判定（${j.status}），OA 无对应记录（可能是在 WMS 直接做的）`,
        hint: '过渡期可忽略；若持续出现说明推送丢失',
      });
    }
  }

  const summary = {
    red: items.filter(i => i.level === 'red').length,
    orange: items.filter(i => i.level === 'orange').length,
    yellow: items.filter(i => i.level === 'yellow').length,
    total: items.length,
  };
  return { wmsAvailable: true, days: n, summary: { ...summary, retrying }, items };
}
