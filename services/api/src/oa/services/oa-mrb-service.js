// ============================================================
// oa-mrb-service —— OA 侧 MRB 评审（P2）
//
// 边界：WMS 持单与处置执行；OA 只做评审/审批 + 结论回填。
// 纪律：
//   1) 处置方案是 WMS 的快照，OA 只读（不在这里改数量/方式）；
//   2) 回填走 WMS 的 /api/oa/mrb/decision，由 WMS 按自身状态机推进
//      （pending_approval → 预审 → pending_final → 终审），OA 不感知两段式；
//   3) 幂等：WMS 已是终态时返回 alreadyDecided，OA 据此收敛状态。
// ============================================================
import { many, one, query } from '../db/index.js';
import { wmsCall } from './wms-client.js';
import { createInstance, submitInstance } from './flow-engine.js';

function bad(msg, statusCode = 400) {
  return Object.assign(new Error(msg), { statusCode, isBiz: true });
}

const STATUS_LABEL = {
  draft: '草稿',
  pending_review: '待制定方案',
  reviewing: '评审中',
  pending_approval: '待IQC主管审核',
  pending_final: '待质量经理审批',
  pending_execute: '待执行',
  approved: '已批准',
  closed: '已结案',
  rejected: '已否决（全批退货）',
  cancelled: '已作废',
};

const DECISION_LABEL = {
  special_admit: '让步接收',
  return: '退货',
  rework: '返工',
  scrap: '报废',
  other: '其他',
};

/* ------------------------------------------------------------
 * 一、入站：WMS 推送 MRB
 * ---------------------------------------------------------- */
export async function receiveMrb(payload = {}) {
  const m = payload.mrb || {};
  const mrbNo = String(m.mrbNo || payload.bizKey || '').trim();
  if (!mrbNo) throw bad('payload.mrb.mrbNo 必填');

  // 两类事件共用一个入口：创建（mrb.created）与处置执行完成（mrb.executed）
  const evt = payload.event === 'mrb.executed' ? 'mrb.executed' : 'mrb.created';

  const ins = await query(
    `INSERT INTO iqc_event_inbox (event, biz_key, payload, status)
     VALUES ($1, $2, $3, 'done')
     ON CONFLICT (event, biz_key) DO NOTHING
     RETURNING id`,
    [evt, mrbNo, JSON.stringify(payload)]
  );
  if (ins.rowCount === 0) {
    const cur = await one(`SELECT id, status FROM mrb_mirror WHERE mrb_no = $1`, [mrbNo]);
    return { mirrorId: cur?.id || null, status: 'duplicated', existingStatus: cur?.status || null };
  }

  // 处置执行完成：只更新状态与明细执行结果，不动审批状态
  if (evt === 'mrb.executed') {
    const cur = await one(`SELECT id FROM mrb_mirror WHERE mrb_no = $1`, [mrbNo]);
    if (!cur) return { mirrorId: null, status: 'ignored', reason: 'mirror-not-found' };
    await query(
      `UPDATE mrb_mirror
          SET status = COALESCE($2, status),
              dispositions = COALESCE($3, dispositions),
              updated_at = now()
        WHERE id = $1`,
      [cur.id, m.status || null, JSON.stringify(payload.dispositions || null)]
    );
    return { mirrorId: cur.id, status: 'executed-synced', wmsStatus: m.status || null };
  }

  const row = await one(
    `INSERT INTO mrb_mirror
       (mrb_no, lot_no, material_code, material_name, supplier_name, batch_no,
        quantity, unit, fail_reason, is_urgent, status, dispositions, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (mrb_no) DO UPDATE SET
       status = EXCLUDED.status,
       dispositions = EXCLUDED.dispositions,
       quantity = COALESCE(EXCLUDED.quantity, mrb_mirror.quantity),
       fail_reason = COALESCE(EXCLUDED.fail_reason, mrb_mirror.fail_reason),
       is_urgent = EXCLUDED.is_urgent,
       payload = EXCLUDED.payload,
       updated_at = now()
     RETURNING *`,
    [mrbNo, m.lotNo || null, m.materialCode || null, m.materialName || null, m.supplierName || null,
     m.batchNo || null, m.quantity ?? null, m.unit || null, m.failReason || null, !!m.isUrgent,
     m.status || 'pending_review', JSON.stringify(payload.dispositions || []), JSON.stringify(payload)]
  );

  // 自动发起 OA 评审（失败不阻断接收：页面仍可看到单据，可手动重试）
  let instanceId = null;
  let approvalError = null;
  try {
    const inst = await startApproval(row);
    instanceId = inst?.id || null;
  } catch (e) {
    approvalError = e instanceof Error ? e.message : String(e);
  }

  return { mirrorId: row.id, status: 'pending', instanceId, approvalError };
}

async function startApproval(mirror) {
  const def = await one(
    `SELECT id, code FROM flow_definition
      WHERE code IN ('mrb_review','wms_mrb') AND active = TRUE
      ORDER BY CASE code WHEN 'mrb_review' THEN 0 ELSE 1 END
      LIMIT 1`
  );
  if (!def) throw bad('未找到 MRB 评审流程定义（mrb_review / wms_mrb）', 500);

  const inst = await createInstance({
    definitionId: def.id,
    userId: 1,
    title: `MRB评审 ${mirror.mrb_no}`,
    formData: {
      mrb_no: mirror.mrb_no,
      lot_no: mirror.lot_no,
      material_code: mirror.material_code,
      material_name: mirror.material_name,
      supplier_name: mirror.supplier_name,
      quantity: mirror.quantity,
      unit: mirror.unit,
      fail_reason: mirror.fail_reason,
      is_urgent: mirror.is_urgent,
      dispositions: mirror.dispositions,
      oa_mrb_id: mirror.id,
    },
    bizSystem: 'OA',
    bizType: 'mrb_record',
    bizKey: String(mirror.id),
  });
  await submitInstance({ instanceId: inst.id, userId: 1, comment: 'MRB 待评审' });
  await query(
    `UPDATE mrb_mirror SET instance_id = $2, approval = 'running', updated_at = now() WHERE id = $1`,
    [mirror.id, inst.id]
  );
  return inst;
}

/* ------------------------------------------------------------
 * 二、查询
 * ---------------------------------------------------------- */
function statusWhere(status) {
  if (!status || status === 'all') return { sql: '', params: [] };
  const list = String(status).split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) return { sql: '', params: [] };
  return { sql: `AND m.status = ANY($1)`, params: [list] };
}

function decorate(r) {
  const disps = Array.isArray(r.dispositions) ? r.dispositions : [];
  return {
    ...r,
    // WMS 推来的是 camelCase；前端按 snake_case 渲染，这里统一成前端契约（两种都兼容）
    dispositions: disps.map(d => ({
      disposition_type: d.dispositionType ?? d.disposition_type,
      other_type: d.otherType ?? d.other_type,
      quantity: d.quantity,
      unit: d.unit,
      exec_status: d.execStatus ?? d.exec_status,
      remark: d.remark,
    })),
    status_label: STATUS_LABEL[r.status] || r.status,
    disposition_summary: disps
      .map(d => `${DECISION_LABEL[d.dispositionType] || d.dispositionType} ${Number(d.quantity) || 0}`)
      .join(' / '),
  };
}

export async function listMrbs({ status, keyword, page = 1, size = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(100, Math.max(1, Number(size) || 20));
  const params = [];
  const where = [];

  if (status && status !== 'all') {
    const list = String(status).split(',').map(x => x.trim()).filter(Boolean);
    if (list.length) { params.push(list); where.push(`m.status = ANY($${params.length})`); }
  }
  if (keyword) {
    params.push(`%${String(keyword).trim()}%`);
    const i = params.length;
    where.push(`(m.mrb_no ILIKE $${i} OR COALESCE(m.lot_no,'') ILIKE $${i}
                OR COALESCE(m.material_code,'') ILIKE $${i} OR COALESCE(m.material_name,'') ILIKE $${i}
                OR COALESCE(m.supplier_name,'') ILIKE $${i})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number((await one(`SELECT count(*)::int AS c FROM mrb_mirror m ${w}`, params))?.c || 0);
  params.push(s, (p - 1) * s);
  const rows = await many(
    `SELECT m.*, r.report_no
       FROM mrb_mirror m
       LEFT JOIN iqc_record r ON r.lot_no = m.lot_no
       ${w}
      ORDER BY m.is_urgent DESC, m.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { list: rows.map(decorate), total, page: p, size: s };
}

export async function getMrb(id) {
  const r = await one(`SELECT * FROM mrb_mirror WHERE id = $1`, [id]);
  if (!r) throw bad('MRB 不存在', 404);
  return decorate(r);
}

/* ------------------------------------------------------------
 * 三、审批结论回填
 * ---------------------------------------------------------- */
async function pushDecision(mirror, finalDecision, comment, user) {
  if (mirror.wms_decided) return { ok: true, alreadyDecided: true };

  // 逐人评审留痕：把 OA 各审批节点的处理人与意见一并带给 WMS（WMS 只写入 remark 审计）
  let reviews = [];
  if (mirror.instance_id) {
    try {
      reviews = await many(
        `SELECT t.node_name AS node, u.real_name AS name, t.comment, t.finished_at AS at
           FROM flow_task t LEFT JOIN org_user u ON u.id = t.assignee_id
          WHERE t.instance_id = $1 AND t.status = 'approved'
          ORDER BY t.finished_at`,
        [mirror.instance_id]
      );
    } catch { reviews = []; }
  }

  const r = await wmsCall('mrb.decision', '/api/oa/mrb/decision', {
    mrbNo: mirror.mrb_no,
    finalDecision,
    comment,
    approvedBy: { name: user?.real_name || user?.username || 'OA' },
    reviews: reviews.map(x => ({ node: x.node, name: x.name, action: '同意', comment: x.comment, at: x.at })),
  });
  await query(
    `UPDATE mrb_mirror
        SET wms_decided = TRUE, wms_decision = $2, status = $3, wms_sync_error = NULL, updated_at = now()
      WHERE id = $1`,
    [mirror.id, finalDecision, r?.status || mirror.status]
  );
  return { ok: true, wms: r };
}

/**
 * 决策前置校验（安全审计：页面按钮曾能绕过 OA 评审直接回填 WMS）。
 *
 * MRB 的"同意/否决"应当由 OA 评审流程产生，而不是由某个有 ipqc:manage 的人点按钮产生。
 * 规则：
 *   · 有评审实例 → 实例必须已到终态（completed/approved）；
 *   · 没有评审实例（历史推送）→ 仅管理员可决策，用于兜底处理存量单据。
 */
async function assertDecidable(m, user) {
  // 评审已通过（可能是流程钩子写的，也可能是重试路径）→ 允许（用于重试回填）
  if (m.approval === 'approved') return;
  if (!m.instance_id) {
    if (!user?.isAdmin) {
      throw bad('该 MRB 尚未发起 OA 评审，不能直接回填；请联系管理员或先在流程中完成评审', 403);
    }
    return;
  }
  const inst = await one(`SELECT status FROM flow_instance WHERE id = $1`, [m.instance_id]);
  if (!inst || !['completed', 'approved'].includes(inst.status)) {
    throw bad('OA 评审尚未通过，不能回填 WMS（请在评审流程中完成审批，系统会自动回填）', 403);
  }
}

export async function decide(id, { finalDecision, comment } = {}, user) {
  const m = await one(`SELECT * FROM mrb_mirror WHERE id = $1`, [id]);
  if (!m) throw bad('MRB 不存在', 404);
  if (m.wms_decided) return { ok: true, alreadyDecided: true };
  await assertDecidable(m, user);
  const dec = ['special_admit', 'return', 'rework', 'scrap', 'other'].includes(finalDecision)
    ? finalDecision
    : 'special_admit';
  try {
    const r = await pushDecision(m, dec, comment, user);
    await query(`UPDATE mrb_mirror SET approval = 'approved', updated_at = now() WHERE id = $1`, [m.id]);
    return r;
  } catch (e) {
    await query(`UPDATE mrb_mirror SET wms_sync_error = $2, updated_at = now() WHERE id = $1`,
      [m.id, String(e?.message || e).slice(0, 500)]);
    throw e;
  }
}

export async function reject(id, { comment } = {}, user) {
  const m = await one(`SELECT * FROM mrb_mirror WHERE id = $1`, [id]);
  if (!m) throw bad('MRB 不存在', 404);
  if (m.wms_decided) return { ok: true, alreadyDecided: true };
  await assertDecidable(m, user);
  if (!String(comment || '').trim()) throw bad('否决必须填写原因');
  try {
    const r = await pushDecision(m, 'reject', comment, user);
    await query(`UPDATE mrb_mirror SET approval = 'approved', updated_at = now() WHERE id = $1`, [m.id]);
    return r;
  } catch (e) {
    await query(`UPDATE mrb_mirror SET wms_sync_error = $2, updated_at = now() WHERE id = $1`,
      [m.id, String(e?.message || e).slice(0, 500)]);
    throw e;
  }
}

/**
 * 流程被退回（flow-engine.returnToApplicant 调用）。
 * MRB 与 IQC 不同：要改的是 WMS 里的处置方案，OA 改不了。
 * 所以这里只标记「已退回」，由 OA 页面「重新提交」把同一草稿实例再提一次
 * （WMS 那边方案调整好后，重新推送会刷新处置快照）。
 */
export async function onMrbReturned(instanceId, reason) {
  const m = await one(`SELECT * FROM mrb_mirror WHERE instance_id = $1`, [instanceId]);
  if (!m) return { skipped: true, reason: 'not-mrb' };
  if (m.wms_decided) return { skipped: true, reason: 'already-decided' };
  await query(
    `UPDATE mrb_mirror SET approval = 'returned', wms_sync_error = $2, updated_at = now() WHERE id = $1`,
    [m.id, reason ? String(reason).slice(0, 500) : null]
  );
  return { ok: true, mrbId: m.id };
}

/** 退回后在 OA 重新提交评审（复用同一草稿实例） */
export async function resubmitMrb(id, user) {
  const m = await one(`SELECT * FROM mrb_mirror WHERE id = $1`, [id]);
  if (!m) throw bad('MRB 不存在', 404);
  if (m.approval === 'running') throw bad('审批进行中，无需重复提交');
  if (m.wms_decided) throw bad('该单已回填 WMS，无需再评审');
  if (!m.instance_id) {
    const inst = await startApproval(m);
    return { ok: true, instanceId: inst.id };
  }
  await submitInstance({ instanceId: m.instance_id, userId: user?.id || 1, comment: 'MRB 重新提交评审' });
  await query(`UPDATE mrb_mirror SET approval = 'running', updated_at = now() WHERE id = $1`, [m.id]);
  return { ok: true, instanceId: m.instance_id };
}

/**
 * 流程终态回调：OA 评审流程走完 → 自动回填 WMS（幂等由 wms_decided 保证）。
 */
export async function onMrbApproved(instanceId) {
  const m = await one(`SELECT * FROM mrb_mirror WHERE instance_id = $1`, [instanceId]);
  if (!m) return { skipped: true, reason: 'not-mrb' };
  if (m.wms_decided) return { skipped: true, reason: 'already-decided' };
  return decide(m.id, { finalDecision: 'special_admit', comment: 'OA 评审流程通过' }, { real_name: 'OA流程' });
}
