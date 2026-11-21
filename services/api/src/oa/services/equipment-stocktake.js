// ============================================================
// 设备盘点领域服务（设备管理卡 V1.0 · R3）
// ------------------------------------------------------------
// 职责：范围解析/预计数、创建（草稿/提交发布审批）、扫码核对（幂等）、
//       进度 DB 现算、三类差异、报告数据、两段审批状态回写钩子。
// 两段审批＝**单定义 · 双实例**（form_data.stage 区分 publish/finish），
//   由 flow-engine 终态/驳回钩子调用本模块 onStocktakeApproved / onStocktakeRejected。
// 关键口径：
//   · 应盘数 = 发布审批通过时**冻结**的 scope_snapshot 数（此后不随台账漂移）
//   · 已盘数 = DB `COUNT(*) FILTER (diff_type='hit')` **现算**（前端禁止本地自增）
//   · 幂等根基 = uk_eqstock_check + ON CONFLICT（重复扫仅更新 last_checked_at/check_count）
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { createInstance, submitInstance } from './flow-engine.js';

const DEF_CODE = 'equipment_stocktake';
const SCOPE_TYPES = new Set(['all', 'dept', 'location']);
// 状态异常（不计已盘）：停用 / 已报废
const ABNORMAL_STATUSES = new Set(['suspended', 'scrapped']);

const biz = (msg) => Object.assign(new Error(msg), { isBiz: true });
const numOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/** 取流程定义 id（发布/结束实例共用同一定义） */
async function definitionId() {
  const d = await one(`SELECT id FROM flow_definition WHERE code = $1 AND active = TRUE`, [DEF_CODE]);
  if (!d) throw new Error('流程定义 equipment_stocktake 不存在');
  return d.id;
}

/** 归一化范围明细：数组或逗号串 → 去空字符串数组 */
function normalizeValues(v) {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return arr.map((x) => String(x).trim()).filter(Boolean);
}

/** 从任务行取范围明细数组 */
function scopeValuesOf(st) {
  if (st.scope_type === 'dept') return (st.scope_value?.deptIds || []).map(Number);
  if (st.scope_type === 'location') return st.scope_value?.locations || [];
  return [];
}

/** 范围 → 设备行（含使用部门名）；发布快照与预计数共用同一解析 */
async function scopeRows(scopeType, scopeValues) {
  const base = `SELECT e.id, e.code, e.name, e.status, d.name AS dept_name, d.name_en AS dept_name_en
                  FROM equipment e LEFT JOIN org_department d ON d.id = e.department_id`;
  if (scopeType === 'dept') {
    const ids = normalizeValues(scopeValues).map(Number).filter(Number.isFinite);
    if (!ids.length) return [];
    return many(`${base} WHERE e.department_id = ANY($1::bigint[]) ORDER BY e.id`, [ids]);
  }
  if (scopeType === 'location') {
    const locs = normalizeValues(scopeValues);
    if (!locs.length) return [];
    return many(`${base} WHERE e.location = ANY($1::text[]) ORDER BY e.id`, [locs]);
  }
  return many(`${base} ORDER BY e.id`);
}

function toSnapshot(rows) {
  return rows.map((r) => ({
    id: Number(r.id), code: r.code, name: r.name,
    dept_name: r.dept_name || null, status: r.status,
  }));
}

/** 范围摘要（中文）；结构化字段（scopeType/scopeValue）另随行返回供前端本地化 */
function scopeSummary(st) {
  if (st.scope_type === 'all') return '全部设备';
  const n = scopeValuesOf(st).length;
  return st.scope_type === 'dept' ? `按部门(${n})` : `按位置(${n})`;
}

/** 进度现算：done = hit 计数；total = 发布快照应盘数 */
async function progressOf(runner, st) {
  const res = await runner.query(
    `SELECT COUNT(*) FILTER (WHERE diff_type = 'hit')::int AS done
       FROM equipment_stocktake_check WHERE stocktake_id = $1`,
    [st.id]
  );
  const done = res.rows[0]?.done || 0;
  const total = Number(st.expected_count) || 0;
  return { done, total, rate: total ? Math.round((done / total) * 100) : 0 };
}

/** 列表/移动端行视图（带进度） */
function mapListRow(st) {
  const total = Number(st.expected_count) || 0;
  const done = Number(st.done_count) || 0;
  return {
    id: Number(st.id), name: st.name, status: st.status,
    periodStart: st.period_start, periodEnd: st.period_end,
    scopeType: st.scope_type, scopeValue: st.scope_value, scopeSummary: scopeSummary(st),
    expectedCount: st.expected_count == null ? null : Number(st.expected_count),
    doneCount: done, rate: total ? Math.round((done / total) * 100) : 0,
    initiatorId: numOrNull(st.initiator_id), initiatorName: st.initiator_name || null,
    publishedAt: st.published_at, finishedAt: st.finished_at, createdAt: st.created_at,
  };
}

/** 两类实例的任务时间线（只读展示用） */
async function buildTimeline(st) {
  const fetchInst = async (iid) => {
    if (!iid) return null;
    const inst = await one(
      `SELECT id, instance_no, status, current_index, submitted_at, finished_at
         FROM flow_instance WHERE id = $1`, [iid]
    );
    if (!inst) return null;
    const tasks = await many(
      `SELECT t.id, t.node_name, t.status, t.assignee_id, u.real_name AS assignee_name, t.finished_at
         FROM flow_task t LEFT JOIN org_user u ON u.id = t.assignee_id
        WHERE t.instance_id = $1 ORDER BY t.node_index, t.id`, [iid]
    );
    return {
      instanceId: Number(inst.id), instanceNo: inst.instance_no, status: inst.status,
      submittedAt: inst.submitted_at, finishedAt: inst.finished_at,
      tasks: tasks.map((t) => ({
        taskId: Number(t.id), nodeName: t.node_name, status: t.status,
        assigneeId: numOrNull(t.assignee_id), assigneeName: t.assignee_name || null, finishedAt: t.finished_at,
      })),
    };
  };
  return { publish: await fetchInst(st.publish_instance_id), finish: await fetchInst(st.finish_instance_id) };
}

/* ---------------- API-S0 范围预览 ---------------- */
export async function scopePreview({ scopeType = 'all', scopeValues } = {}) {
  const type = SCOPE_TYPES.has(scopeType) ? scopeType : 'all';
  const rows = await scopeRows(type, scopeValues);
  return { count: rows.length, scopeType: type };
}

/* ---------------- API-S1 创建（草稿 / 直接提交审批） ---------------- */
/** 校验创建/编辑入参（name/期间/范围/明细），返回归一化后的 name */
function assertStocktakeInput({ name, periodStart, periodEnd, scopeType, scopeValues }) {
  const nm = String(name ?? '').trim();
  if (!nm) throw biz('请填写任务名称');
  if (nm.length > 60) throw biz('任务名称不超过 60 字');
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(periodStart)) || !re.test(String(periodEnd))) throw biz('请选择盘点期间');
  if (String(periodEnd) < String(periodStart)) throw biz('结束日期不能早于开始日期');
  if (!SCOPE_TYPES.has(scopeType)) throw biz('盘点范围不合法');
  if (scopeType !== 'all' && normalizeValues(scopeValues).length === 0) {
    throw biz(scopeType === 'dept' ? '请至少选择一个部门' : '请至少选择一个位置');
  }
  return nm;
}

/** 范围明细 → 落库 JSONB（all=NULL） */
function buildScopeValue(scopeType, scopeValues) {
  if (scopeType === 'all') return null;
  return scopeType === 'dept'
    ? { deptIds: normalizeValues(scopeValues).map(Number).filter(Number.isFinite) }
    : { locations: normalizeValues(scopeValues) };
}

export async function createStocktake({
  name, periodStart, periodEnd, scopeType = 'all', scopeValues, submitNow = false, remark, userId,
} = {}) {
  const nm = assertStocktakeInput({ name, periodStart, periodEnd, scopeType, scopeValues });

  const liveRows = await scopeRows(scopeType, scopeValues);
  const expectedLiveCount = liveRows.length;
  if (submitNow && expectedLiveCount === 0) throw biz('该范围下暂无设备，请调整范围');

  const scopeValue = buildScopeValue(scopeType, scopeValues);

  const st = await one(
    `INSERT INTO equipment_stocktake (name, period_start, period_end, scope_type, scope_value, status, initiator_id, remark)
     VALUES ($1,$2,$3,$4,$5::jsonb,'draft',$6,$7) RETURNING *`,
    [nm, periodStart, periodEnd, scopeType, scopeValue ? JSON.stringify(scopeValue) : null, userId, remark || null]
  );

  if (!submitNow) return { id: Number(st.id), status: 'draft', expectedLiveCount };

  const r = await submitPublish(Number(st.id), userId, expectedLiveCount);
  return { id: Number(st.id), status: r.status, expectedLiveCount, stuck: r.stuck };
}

/* ---------------- API-S11 编辑（仅 draft/rejected；保存后一律回 draft） ---------------- */
export async function updateStocktake(id, { name, periodStart, periodEnd, scopeType = 'all', scopeValues } = {}) {
  const st = await one(`SELECT id, status FROM equipment_stocktake WHERE id = $1`, [id]);
  if (!st) throw Object.assign(new Error('盘点任务不存在'), { statusCode: 404 });
  if (!['draft', 'rejected'].includes(st.status)) throw biz('仅草稿或已拒绝的盘点任务可编辑');
  const nm = assertStocktakeInput({ name, periodStart, periodEnd, scopeType, scopeValues });
  const scopeValue = buildScopeValue(scopeType, scopeValues);
  // 被拒单改后回草稿，供再次提交（状态守卫防并发）
  const upd = await one(
    `UPDATE equipment_stocktake
        SET name=$2, period_start=$3, period_end=$4, scope_type=$5, scope_value=$6::jsonb,
            status='draft', updated_at=now()
      WHERE id=$1 AND status IN ('draft','rejected') RETURNING id`,
    [id, nm, periodStart, periodEnd, scopeType, scopeValue ? JSON.stringify(scopeValue) : null]
  );
  if (!upd) throw biz('任务状态已变更，请刷新重试');
  return { id: Number(id), status: 'draft' };
}

/* ---------------- API-S12 删除（仅 draft；核对记录随表级联删除） ---------------- */
export async function deleteStocktake(id) {
  const st = await one(`SELECT id, status FROM equipment_stocktake WHERE id = $1`, [id]);
  if (!st) throw Object.assign(new Error('盘点任务不存在'), { statusCode: 404 });
  if (st.status !== 'draft') throw biz('仅草稿可删除');
  await query(`DELETE FROM equipment_stocktake WHERE id = $1 AND status = 'draft'`, [id]);
  return { id: Number(id) };
}

/* ---------------- API-S4 提交发布审批（draft/rejected → pending） ---------------- */
export async function submitPublish(id, userId, liveCount) {
  const st = await one(`SELECT * FROM equipment_stocktake WHERE id = $1`, [id]);
  if (!st) throw new Error('盘点任务不存在');
  if (!['draft', 'rejected'].includes(st.status)) throw new Error('当前状态不可提交发布审批');

  const count = liveCount != null ? liveCount : (await scopeRows(st.scope_type, scopeValuesOf(st))).length;
  if (count === 0) throw biz('该范围下暂无设备，请调整范围');

  const applicantId = Number(st.initiator_id) || Number(userId);
  const did = await definitionId();
  const inst = await createInstance({
    definitionId: did, userId: applicantId,
    title: `设备盘点发布审批：${st.name}`,
    formData: { stage: 'publish', stocktake_id: Number(st.id) },
  });
  const s = await submitInstance({ instanceId: inst.id, userId: applicantId });
  const upd = await one(
    `UPDATE equipment_stocktake SET status = 'pending', publish_instance_id = $2, updated_at = now()
      WHERE id = $1 AND status IN ('draft','rejected') RETURNING id`,
    [st.id, inst.id]
  );
  if (!upd) throw new Error('任务状态已变更，请刷新重试');
  return { status: 'pending', instanceId: Number(inst.id), stuck: !!s?.stuck };
}

/* ---------------- API-S5 撤回发布申请（pending → draft） ---------------- */
export async function withdrawPublish(id, userId) {
  const st = await one(`SELECT * FROM equipment_stocktake WHERE id = $1`, [id]);
  if (!st) throw new Error('盘点任务不存在');
  if (st.status !== 'pending') throw new Error('当前状态不可撤回');
  const applicantId = Number(st.initiator_id) || Number(userId);
  if (st.publish_instance_id) {
    const { withdrawInstance } = await import('./flow-engine.js');
    if (typeof withdrawInstance !== 'function') throw new Error('撤回能力尚未就绪，请联系管理员');
    await withdrawInstance({ instanceId: Number(st.publish_instance_id), userId: applicantId });
  }
  await query(
    `UPDATE equipment_stocktake SET status = 'draft', publish_instance_id = NULL, updated_at = now()
      WHERE id = $1 AND status = 'pending'`, [st.id]
  );
  return { status: 'draft' };
}

/* ---------------- API-S6 提交结束审批（ongoing → closing） ---------------- */
export async function submitFinish(id, userId) {
  const st = await one(`SELECT * FROM equipment_stocktake WHERE id = $1`, [id]);
  if (!st) throw new Error('盘点任务不存在');
  if (st.status !== 'ongoing') throw new Error('仅进行中的任务可提交结束审批');
  const applicantId = Number(st.initiator_id) || Number(userId);
  const did = await definitionId();
  const inst = await createInstance({
    definitionId: did, userId: applicantId,
    title: `设备盘点结束审批：${st.name}`,
    formData: { stage: 'finish', stocktake_id: Number(st.id) },
  });
  const s = await submitInstance({ instanceId: inst.id, userId: applicantId });
  const upd = await one(
    `UPDATE equipment_stocktake SET status = 'closing', finish_instance_id = $2,
            finish_submitted_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'ongoing' RETURNING id`, [st.id, inst.id]
  );
  if (!upd) throw new Error('任务状态已变更，请刷新重试');
  return { status: 'closing', instanceId: Number(inst.id), stuck: !!s?.stuck };
}

/* ---------------- API-S7 撤回结束申请（closing → ongoing） ---------------- */
export async function withdrawFinish(id, userId) {
  const st = await one(`SELECT * FROM equipment_stocktake WHERE id = $1`, [id]);
  if (!st) throw new Error('盘点任务不存在');
  if (st.status !== 'closing') throw new Error('当前状态不可撤回结束申请');
  const applicantId = Number(st.initiator_id) || Number(userId);
  if (st.finish_instance_id) {
    const { withdrawInstance } = await import('./flow-engine.js');
    if (typeof withdrawInstance !== 'function') throw new Error('撤回能力尚未就绪，请联系管理员');
    await withdrawInstance({ instanceId: Number(st.finish_instance_id), userId: applicantId });
  }
  await query(
    `UPDATE equipment_stocktake SET status = 'ongoing', finish_instance_id = NULL,
            finish_submitted_at = NULL, updated_at = now()
      WHERE id = $1 AND status = 'closing'`, [st.id]
  );
  return { status: 'ongoing' };
}

/* ---------------- API-S8 扫码核对（幂等核心 R3-3） ---------------- */
export async function checkEquipment({ stocktakeId, code, userId }) {
  const raw = String(code ?? '').trim();
  if (!raw) throw biz('请提供资产编号');
  const st = await one(`SELECT * FROM equipment_stocktake WHERE id = $1`, [stocktakeId]);
  if (!st) throw new Error('盘点任务不存在');
  if (!['ongoing', 'closing'].includes(st.status)) throw new Error('盘点任务不在核对中');

  return transaction(async (client) => {
    const eq = (await client.query(
      `SELECT e.id, e.code, e.name, e.status, d.name AS dept_name, d.name_en AS dept_name_en
         FROM equipment e LEFT JOIN org_department d ON d.id = e.department_id
        WHERE lower(e.code) = lower($1) LIMIT 1`, [raw]
    )).rows[0];

    // 1) 未命中 → 不落库，回带 code 供人工核对
    if (!eq) {
      return { result: 'device_missing', code: raw, progress: await progressOf(client, st) };
    }

    const inScope = (st.scope_snapshot || []).some((x) => Number(x.id) === Number(eq.id));
    let diffType, result;
    if (!inScope) { diffType = 'outside'; result = 'out_of_scope'; }
    else if (ABNORMAL_STATUSES.has(eq.status)) { diffType = 'abnormal'; result = 'status_abnormal'; }
    else { diffType = 'hit'; result = 'hit'; }

    // 既有行 diff_type 首定不改（范围发布即冻结）→ 重扫结果与之对齐，
    // 否则会出现「回 hit 但进度不动」的响应/落库不一致（如 abnormal 行 + 设备已恢复正常时）
    const existing = (await client.query(
      `SELECT diff_type FROM equipment_stocktake_check WHERE stocktake_id = $1 AND equipment_id = $2`,
      [st.id, eq.id]
    )).rows[0];
    const RESULT_BY_DIFF = { hit: 'repeat', abnormal: 'status_abnormal', outside: 'out_of_scope' };
    const finalResult = existing ? (RESULT_BY_DIFF[existing.diff_type] || result) : result;

    // UPSERT：diff_type 首次定后不改（范围发布即冻结）；重复扫仅更新最近核对时间与计数
    await client.query(
      `INSERT INTO equipment_stocktake_check AS c
         (stocktake_id, equipment_id, equipment_code, equipment_name, dept_name, equipment_status, diff_type, checker_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (stocktake_id, equipment_id) DO UPDATE SET
         last_checked_at   = now(),
         check_count       = c.check_count + 1,
         checker_id        = EXCLUDED.checker_id,
         equipment_status  = EXCLUDED.equipment_status`,
      [st.id, eq.id, eq.code, eq.name, eq.dept_name || null, eq.status, diffType, userId]
    );

    return {
      result: finalResult,
      equipment: { code: eq.code, name: eq.name, deptName: eq.dept_name || null, status: eq.status },
      progress: await progressOf(client, st),
    };
  });
}

/* ---------------- API-S2 列表（分页） ---------------- */
export async function listStocktakes({ keyword, status, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (keyword) { params.push(`%${keyword}%`); where += ` AND s.name ILIKE $${params.length}`; }
  if (status) { params.push(status); where += ` AND s.status = $${params.length}`; }

  const selectSql =
    `SELECT s.*, u.real_name AS initiator_name,
            (SELECT COUNT(*) FILTER (WHERE diff_type = 'hit')::int
               FROM equipment_stocktake_check c WHERE c.stocktake_id = s.id) AS done_count
       FROM equipment_stocktake s LEFT JOIN org_user u ON u.id = s.initiator_id
      WHERE ${where} ORDER BY s.id DESC`;

  if (page === undefined || page === null || page === '') {
    return (await many(selectSql, params)).map(mapListRow);
  }
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM equipment_stocktake s WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list: list.map(mapListRow), total: cnt?.n || 0, page: p, pageSize: size };
}

/* ---------------- API-S9 移动端任务列表（仅 ongoing/closing） ---------------- */
export async function listMobileTasks() {
  const rows = await many(
    `SELECT s.*, u.real_name AS initiator_name,
            (SELECT COUNT(*) FILTER (WHERE diff_type = 'hit')::int
               FROM equipment_stocktake_check c WHERE c.stocktake_id = s.id) AS done_count
       FROM equipment_stocktake s LEFT JOIN org_user u ON u.id = s.initiator_id
      WHERE s.status IN ('ongoing','closing') ORDER BY s.id DESC`
  );
  return rows.map(mapListRow);
}

/* ---------------- API-S3 详情（进度 + 三类差异 + 核对明细 + 审批时间线） ---------------- */
export async function getStocktakeDetail(id) {
  const st = await one(
    `SELECT s.*, u.real_name AS initiator_name,
            pu.real_name AS publish_approver_name, fu.real_name AS finish_approver_name
       FROM equipment_stocktake s
       LEFT JOIN org_user u  ON u.id  = s.initiator_id
       LEFT JOIN org_user pu ON pu.id = s.publish_approver_id
       LEFT JOIN org_user fu ON fu.id = s.finish_approver_id
      WHERE s.id = $1`, [id]
  );
  if (!st) return null;

  const progress = await progressOf({ query }, st);
  const checks = await many(
    `SELECT c.*, u.real_name AS checker_name
       FROM equipment_stocktake_check c LEFT JOIN org_user u ON u.id = c.checker_id
      WHERE c.stocktake_id = $1 ORDER BY c.checked_at DESC`, [id]
  );
  const checkRows = checks.map((c) => ({
    equipmentId: Number(c.equipment_id), code: c.equipment_code, name: c.equipment_name,
    deptName: c.dept_name, status: c.equipment_status, diffType: c.diff_type,
    checkedAt: c.checked_at, lastCheckedAt: c.last_checked_at,
    checkCount: Number(c.check_count), checkerName: c.checker_name || null,
  }));
  // 应盘未扫 = 范围内「无任何核对记录」者（已扫命中/状态异常者均不计入盘亏候选，见 S10 同口径）
  const checkedIds = new Set(checks.map((c) => Number(c.equipment_id)));
  const missing = (st.scope_snapshot || [])
    .filter((x) => !checkedIds.has(Number(x.id)))
    .map((x) => ({
      equipmentId: Number(x.id), code: x.code, name: x.name, deptName: x.dept_name,
      status: x.status, diffType: 'missing', checkedAt: null, lastCheckedAt: null,
      checkCount: 0, checkerName: null,
    }));

  return {
    stocktake: {
      ...mapListRow({ ...st, done_count: progress.done }),
      // 发布/结束两段审批信息（approverName 供 P-303 显示审批人姓名）
      publish: {
        instanceId: numOrNull(st.publish_instance_id), approverId: numOrNull(st.publish_approver_id),
        approverName: st.publish_approver_name || null,
        approvedAt: st.publish_approved_at, publishedAt: st.published_at,
      },
      finish: {
        instanceId: numOrNull(st.finish_instance_id), approverId: numOrNull(st.finish_approver_id),
        approverName: st.finish_approver_name || null,
        submittedAt: st.finish_submitted_at, approvedAt: st.finish_approved_at,
      },
      remark: st.remark, updatedAt: st.updated_at,
    },
    progress,
    diffs: {
      missing,
      outside: checkRows.filter((r) => r.diffType === 'outside'),
      abnormal: checkRows.filter((r) => r.diffType === 'abnormal'),
    },
    checks: checkRows,
    timeline: await buildTimeline(st),
  };
}

/* ---------------- API-S10 报告数据（供前端 xlsx 导出） ---------------- */
export async function getStocktakeReport(id) {
  const st = await one(`SELECT * FROM equipment_stocktake WHERE id = $1`, [id]);
  if (!st) return null;
  const checks = await many(
    `SELECT c.*, u.real_name AS checker_name
       FROM equipment_stocktake_check c LEFT JOIN org_user u ON u.id = c.checker_id
      WHERE c.stocktake_id = $1 ORDER BY c.checked_at`, [id]
  );
  // 应盘未扫 = 范围内「无任何核对记录」者（与 S3 同口径）：已扫异常设备归「状态异常」，不再计入盘亏候选
  const checkedIds = new Set(checks.map((c) => Number(c.equipment_id)));
  const missing = (st.scope_snapshot || []).filter((x) => !checkedIds.has(Number(x.id)));

  const rows = [
    ...checks.map((c) => ({
      code: c.equipment_code, name: c.equipment_name, deptName: c.dept_name, status: c.equipment_status,
      checkedAt: c.checked_at, checkerName: c.checker_name || null, diffType: c.diff_type,
    })),
    // 应盘未扫（scope_snapshot 中无 hit 记录者）
    ...missing.map((x) => ({
      code: x.code, name: x.name, deptName: x.dept_name, status: x.status,
      checkedAt: null, checkerName: null, diffType: 'missing',
    })),
  ];

  const done = checks.filter((c) => c.diff_type === 'hit').length;
  const total = Number(st.expected_count) || 0;
  return {
    stocktake: {
      id: Number(st.id), name: st.name, status: st.status,
      periodStart: st.period_start, periodEnd: st.period_end,
      scopeSummary: scopeSummary(st), expectedCount: total, doneCount: done,
      rate: total ? Math.round((done / total) * 100) : 0,
    },
    summary: {
      outsideCount: checks.filter((c) => c.diff_type === 'outside').length,
      abnormalCount: checks.filter((c) => c.diff_type === 'abnormal').length,
      missingCount: missing.length,
    },
    rows,
  };
}

/* ---------------- 审批钩子（由 flow-engine 终态/驳回分发调用） ---------------- */

/** 审批通过：publish → 发布（冻结快照）；finish → 已结束。幂等由 WHERE status 守卫。 */
export async function onStocktakeApproved(instanceId) {
  try {
    const inst = await one(
      `SELECT fi.id, fi.form_data, fd.code AS def_code
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`, [instanceId]
    );
    if (!inst || inst.def_code !== DEF_CODE) return { ok: false, reason: '非盘点流程' };
    const stage = inst.form_data?.stage;
    const sid = Number(inst.form_data?.stocktake_id);
    if (!sid) return { ok: false, reason: '缺少 stocktake_id' };

    const approver = await one(
      `SELECT assignee_id FROM flow_task WHERE instance_id = $1 AND status = 'approved'
        ORDER BY finished_at DESC NULLS LAST LIMIT 1`, [instanceId]
    );
    const approverId = numOrNull(approver?.assignee_id);

    if (stage === 'publish') {
      const st = await one(`SELECT * FROM equipment_stocktake WHERE id = $1`, [sid]);
      if (!st) return { ok: false, reason: '盘点任务不存在' };
      // 发布时冻结范围快照与应盘数
      const snapshot = toSnapshot(await scopeRows(st.scope_type, scopeValuesOf(st)));
      const upd = await one(
        `UPDATE equipment_stocktake
            SET status = 'ongoing', expected_count = $2, scope_snapshot = $3::jsonb,
                published_at = now(), publish_approver_id = $4, publish_approved_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'pending' RETURNING id`,
        [sid, snapshot.length, JSON.stringify(snapshot), approverId]
      );
      return { ok: !!upd, action: 'published', count: snapshot.length };
    }
    if (stage === 'finish') {
      const upd = await one(
        `UPDATE equipment_stocktake
            SET status = 'finished', finished_at = now(),
                finish_approver_id = $2, finish_approved_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'closing' RETURNING id`,
        [sid, approverId]
      );
      return { ok: !!upd, action: 'finished' };
    }
    return { ok: false, reason: `未知阶段 ${stage}` };
  } catch (err) {
    console.warn(`[equipment-stocktake] onStocktakeApproved 失败（已忽略）instance=${instanceId}:`, err?.message || err);
    return { ok: false, reason: err?.message || String(err) };
  }
}

/** 审批驳回：publish → rejected（可改回草稿重提）；finish → ongoing（可继续核对）。 */
export async function onStocktakeRejected(instanceId) {
  try {
    const inst = await one(
      `SELECT fi.id, fi.form_data, fd.code AS def_code
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`, [instanceId]
    );
    if (!inst || inst.def_code !== DEF_CODE) return { ok: false, reason: '非盘点流程' };
    const stage = inst.form_data?.stage;
    const sid = Number(inst.form_data?.stocktake_id);
    if (!sid) return { ok: false, reason: '缺少 stocktake_id' };

    if (stage === 'publish') {
      const upd = await one(
        `UPDATE equipment_stocktake SET status = 'rejected', updated_at = now()
          WHERE id = $1 AND status = 'pending' RETURNING id`, [sid]
      );
      return { ok: !!upd, action: 'rejected' };
    }
    if (stage === 'finish') {
      const upd = await one(
        `UPDATE equipment_stocktake SET status = 'ongoing', updated_at = now()
          WHERE id = $1 AND status = 'closing' RETURNING id`, [sid]
      );
      return { ok: !!upd, action: 'reopened' };
    }
    return { ok: false, reason: `未知阶段 ${stage}` };
  } catch (err) {
    console.warn(`[equipment-stocktake] onStocktakeRejected 失败（已忽略）instance=${instanceId}:`, err?.message || err);
    return { ok: false, reason: err?.message || String(err) };
  }
}
