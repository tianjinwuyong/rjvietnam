// ============================================================
// 体系文件 · 评审链路（doc-review-flow）
// 职责：把 flow_definition(code='doc_controlled_issue') 的 8 个节点
//      转成前端可直接展示的「评审节点」数据：
//        1) getReviewChainPreview —— 新建页预览：提交后会走哪些节点、谁审、哪些条件成立
//        2) getReviewProgress    —— 详情页进度：真实实例的每个节点状态/审批人/意见/时间
// 说明：只读。指派人解析完全复用 flow-engine 的 resolveAssignees，
//      条件判断复用 matchCondition，保证「预览」与「真实流转」同一套规则，
//      不会出现预览说 6 个节点、实际跑 4 个节点的偏差。
// ============================================================
import { many, one } from '../db/index.js';
import { resolveAssignees, matchCondition, skipWhenApplicantIsOnlyAssignee } from './flow-engine.js';
import { resolveIssueRoute, routeLabel, routeListLabel } from '../lib/doc-issue-route.js';

const DEF_CODE = 'doc_controlled_issue';

/** 默认类别（按文件级别推断，供新建页只读级别时回落） */
const LEVEL_CATEGORY = { 1: 'l1_manual', 2: 'l2_procedure', 3: 'l3_manage', 4: 'l4_form' };

/** flow_nodes 可能是 jsonb 数组或字符串 */
function parseNodes(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

/**
 * 补齐审批路由字段。
 * 存量实例的 form_data 里没有 issue_route（该字段是 2026-11 按文件类型分流时新增的），
 * 但条件判定必须能读到它，否则老单据的「按级别分流」会全部失效 → 全部节点被当成不满足。
 * 这里按已有字段现场补算，口径与 submitIssue 完全一致（同一个 resolveIssueRoute）。
 */
function withRoute(formData) {
  const fd = formData || {};
  if (fd.issue_route) return fd;
  return {
    ...fd,
    issue_route: resolveIssueRoute({
      level: fd.doc_level,
      category: fd.category,
      productScope: fd.product_scope,
    }),
  };
}

/** 条件节点的人类可读说明（前端徽标用） */
function conditionLabel(condition) {
  if (!condition) return null;
  const { field, op, value } = condition;
  // 审批路由：一个节点覆盖多个文件类型时，必须把类型逐个列出来，
  // 否则配置页只看到「issue_route in ...」等于没说。
  if (field === 'issue_route') {
    const codes = Array.isArray(value) ? value : String(value || '').split(/[,，、;；|]/).filter(Boolean);
    const lab = routeListLabel(codes);
    if (op === 'in') return { zh: `仅 ${lab.zh}`, vi: `Chỉ ${lab.vi}`, en: `${lab.en} only` };
    if (op === 'nin') return { zh: `除 ${lab.zh} 外`, vi: `Trừ ${lab.vi}`, en: `All but ${lab.en}` };
    if (op === 'eq') return { zh: `仅 ${lab.zh}`, vi: `Chỉ ${lab.vi}`, en: `${lab.en} only` };
    if (op === 'ne') return { zh: `除 ${lab.zh} 外`, vi: `Trừ ${lab.vi}`, en: `All but ${lab.en}` };
  }
  if (field === 'is_manual' && op === 'eq' && String(value) === 'true') return { zh: '仅一级手册', vi: 'Chỉ sổ tay cấp 1', en: 'Level-1 manual only' };
  if (field === 'product_scope' && op === 'eq' && String(value) === 'true') return { zh: '仅产品范围文件', vi: 'Chỉ tài liệu phạm vi sản phẩm', en: 'Product-scope docs only' };
  if (field === 'product_scope' && op === 'ne' && String(value) === 'true') return { zh: '非产品范围文件', vi: 'Tài liệu ngoài phạm vi sản phẩm', en: 'Non product-scope docs' };
  if (field === 'doc_level' && op === 'eq') return { zh: `仅 ${value} 级文件`, vi: `Chỉ tài liệu cấp ${value}`, en: `Level ${value} only` };
  return { zh: `条件：${field} ${op} ${value}`, vi: `Điều kiện: ${field} ${op} ${value}`, en: `When ${field} ${op} ${value}` };
}

/**
 * 指派表达式 → 可读标签（与解析结果互相补充：
 * 解析出人时展示人名，解析不出人时至少让用户知道「该由谁审」）
 */
async function assignLabels(assign) {
  const list = Array.isArray(assign) ? assign : (assign ? [assign] : []);
  if (!list.length) return [];
  const out = [];
  for (const raw of list) {
    const expr = String(raw || '');
    if (!expr) continue;
    if (expr === 'gm') { out.push({ zh: '总经理', vi: 'Tổng giám đốc', en: 'General Manager' }); continue; }
    if (expr === 'vp') { out.push({ zh: '分管副总', vi: 'Phó tổng giám đốc', en: 'Vice GM' }); continue; }
    if (expr === 'dept_leader' || expr === 'manager') { out.push({ zh: '本部门负责人', vi: 'Trưởng bộ phận', en: 'Dept leader' }); continue; }
    if (expr === 'user_selected') { out.push({ zh: '发起人指定', vi: 'Người gửi chỉ định', en: 'Chosen by applicant' }); continue; }
    if (expr.startsWith('user:')) {
      const u = await one(`SELECT real_name FROM org_user WHERE id = $1`, [Number(expr.slice(5)) || 0]);
      out.push({ zh: u?.real_name ? `指定：${u.real_name}` : '指定人员', vi: u?.real_name ? `Chỉ định: ${u.real_name}` : 'Người chỉ định', en: u?.real_name ? `Assigned: ${u.real_name}` : 'Assigned user' });
      continue;
    }
    if (expr.startsWith('position_self:') || expr.startsWith('position:')) {
      const posCode = expr.split(':').pop();
      const d = await one(
        `SELECT name_zh, name_vi, name_en FROM sys_i18n_dict
          WHERE dict_type = 'position' AND code = $1 LIMIT 1`, [posCode]);
      const zh = d?.name_zh || posCode;
      out.push({
        zh: expr.startsWith('position_self:') ? `本部门 ${zh}` : zh,
        vi: expr.startsWith('position_self:') ? `Bộ phận này · ${d?.name_vi || zh}` : (d?.name_vi || zh),
        en: d?.name_en || zh,
      });
      continue;
    }
    if (expr.startsWith('role:')) {
      const parts = expr.slice(5).split(':');
      let deptName = null; let code = parts[0];
      if (parts.length >= 2) {
        const dep = await one(`SELECT name FROM org_department WHERE code = $1 OR name = $1 LIMIT 1`, [parts[0]]);
        deptName = dep?.name || parts[0];
        code = parts[1];
      }
      const role = await one(`SELECT name FROM sys_role WHERE code = $1 OR name = $1 LIMIT 1`, [code]);
      const zh = role?.name || code;
      out.push({
        zh: deptName ? `${deptName} · ${zh}` : zh,
        vi: deptName ? `${deptName} · ${zh}` : zh,
        en: deptName ? `${deptName} · ${zh}` : zh,
      });
      continue;
    }
    out.push({ zh: expr, vi: expr, en: expr });
  }
  return out;
}

/** 指派人 id 列表 → 展示信息（姓名/岗位/部门） */
async function people(ids) {
  const uniq = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!uniq.length) return [];
  const rows = await many(
    `SELECT u.id, u.real_name, u.position, u.position_code, d.name AS dept_name
       FROM org_user u LEFT JOIN org_department d ON d.id = u.department_id
      WHERE u.id = ANY($1::bigint[]) AND u.active = TRUE
      ORDER BY u.id`,
    [uniq]
  );
  return rows.map(r => ({ id: Number(r.id), name: r.real_name, position: r.position || r.position_code || null, dept: r.dept_name || null }));
}

/**
 * 新建页/详情页预览：这条文件提交评审后会经过哪些节点。
 * @param {object} p { docId, category, level, productScope, isManual, userId }
 *   docId 存在时以「该文件自身」的级别/类别/产品范围/创建人为准（预览与真实提交同源）。
 */
export async function getReviewChainPreview({ docId = null, category = null, level = null, productScope = null, isManual = null, userId = null } = {}) {
  const def = await one(
    `SELECT id, code, name, name_vi, flow_nodes FROM flow_definition WHERE code = $1 AND active = TRUE`,
    [DEF_CODE]
  );
  if (!def) throw new Error(`流程定义 ${DEF_CODE} 不存在`);
  const nodes = parseNodes(def.flow_nodes);

  // 有 docId → 以文件自身属性 + 发起人（创建人）为解析上下文
  let doc = null;
  if (docId) {
    doc = await one(
      `SELECT id, level, category, product_scope, created_by FROM doc_system WHERE id = $1`, [docId]);
  }
  const lv = Number(doc?.level || level) || 3;
  const cat = doc?.category || category || LEVEL_CATEGORY[lv] || 'l3_manage';
  const manual = isManual === null || isManual === undefined ? cat === 'l1_manual' : !!isManual;
  const inScope = productScope === null || productScope === undefined
    ? !!doc?.product_scope
    : !!productScope;
  const applicantId = Number(doc?.created_by) || Number(userId) || null;
  const formData = {
    doc_level: String(lv),
    category: cat,
    // 审批路由必须和 submitIssue 用同一套换算，否则「新建页预览 6 步、提交后实跑 4 步」
    issue_route: resolveIssueRoute({ level: lv, category: cat, productScope: inScope }),
    is_manual: manual ? 'true' : 'false',
    product_scope: inScope ? 'true' : 'false',
    security_level: 'public',
    has_zh: 'true',
    has_vi: 'true',
  };
  const pseudo = { id: 0, applicant_id: applicantId, subject_user_id: null, form_data: formData, def_code: def.code, definition_id: def.id };

  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i] || {};
    let applies = true;
    if (nd.condition) {
      try { applies = await matchCondition(nd.condition, formData); } catch { applies = true; }
    }
    let peopleIds = [];
    // 发起人本人即该节点唯一审批人 → 提交后会自动跳过（与引擎同一判定函数）
    let autoSkipSelf = null;
    if (applies) {
      try { peopleIds = (await resolveAssignees({ ...nd, temp_addable: nd.temp_addable }, pseudo)) || []; } catch { peopleIds = []; }
      if (!peopleIds.length && (nd.type || 'approval') === 'approval') {
        try { autoSkipSelf = await skipWhenApplicantIsOnlyAssignee(nd, pseudo); } catch { autoSkipSelf = null; }
      }
    }
    out.push({
      index: i,
      name: nd.name || `节点${i + 1}`,
      nameVi: nd.name_vi || null,
      type: nd.type || 'approval',
      applies,
      conditional: !!nd.condition,
      conditionLabel: conditionLabel(nd.condition),
      minApprovals: nd.min_approvals ? Number(nd.min_approvals) : null,
      // 全员会签：本节点所有待办（含审批人现场加签的人）都必须通过才流转
      requireAllApprovals: !!nd.require_all_approvals,
      // 发起人本人即唯一审批人：提交后引擎自动跳过该节点（不留待办、不挂起）
      autoSkipSelf: !!autoSkipSelf,
      autoSkipReason: autoSkipSelf?.reason || null,
      assignLabels: await assignLabels(nd.assign),
      assignees: applies ? await people(peopleIds.map(p => p.id)) : [],
    });
  }

  // 重复审批人标记：同一人若已在「更靠前的环节」审批过，后面的审批环节就重复了。
  // 体系文件第 2 步（四部门会签）与第 3 步（部门负责人审核）就是典型：
  // 前者已让 QA/SCM/PD/EN 的部门负责人会签，后者又把他们解析一遍。
  // 注意：execute（发行执行回复）/ verify（发行确认闭环）是**动作**不是重复审批——
  //       同一个人先会签、后盖印发放，是流程要求；不能因为「同一个人」就建议跳过。
  const seen = new Map(); // userId -> 首次出现的审批环节下标
  for (const n of out) {
    if (n.applies === false || (n.type || 'approval') !== 'approval') {
      n.dupIds = []; n.coveredBy = []; n.fullyDup = false;
      continue;
    }
    const ids = n.assignees.map(p => p.id);
    n.dupIds = ids.filter(id => seen.has(id));
    n.coveredBy = [...new Set(n.dupIds.map(id => seen.get(id)))].sort((a, b) => a - b);
    n.fullyDup = ids.length > 0 && n.dupIds.length === ids.length;
    for (const id of ids) if (!seen.has(id)) seen.set(id, n.index);
  }

  return {
    defCode: def.code,
    defName: def.name,
    defNameVi: def.name_vi || null,
    docId: doc ? Number(doc.id) : null,
    applicantId,
    category: cat,
    level: lv,
    isManual: manual,
    productScope: inScope,
    total: out.length,
    applicableCount: out.filter(n => n.applies).length,
    duplicateCount: out.filter(n => n.dupIds && n.dupIds.length).length,
    nodes: out,
  };
}

/**
 * 详情页进度：某文件最近一次发行/评审实例的逐节点状态。
 * @param {number} docId
 * @returns {Promise<object|null>} 无实例时返回 null（前端展示预览态）
 */
export async function getReviewProgress(docId) {
  const inst = await one(
    `SELECT i.id, i.instance_no, i.status, i.current_index, i.submitted_at, i.finished_at, i.form_data,
            i.nodes_override, fd.flow_nodes, fd.name AS def_name
       FROM flow_instance i JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE fd.code = $1 AND (i.form_data->>'doc_id') = $2
      ORDER BY i.id DESC LIMIT 1`,
    [DEF_CODE, String(docId)]
  );
  if (!inst) return null;

  const defNodes = parseNodes(inst.flow_nodes);
  const override = Array.isArray(inst.nodes_override) && inst.nodes_override.length
    ? inst.nodes_override : null;
  const nodes = override || defNodes;
  // 提交时被发起人手动去掉的环节（页面上要能看到「这些没走，是选择的结果」）
  // 注意排除「条件本来就不满足」的环节：那些不是用户跳过的，不该混进这句说明。
  const removedNodes = [];
  if (override) {
    for (let i = 0; i < defNodes.length; i++) {
      const nd = defNodes[i] || {};
      if (nodes.some(x => (x.name || '') === (nd.name || ''))) continue;
      let wouldApply = true;
      if (nd.condition) {
        try { wouldApply = await matchCondition(nd.condition, withRoute(inst.form_data)); } catch { wouldApply = true; }
      }
      if (!wouldApply) continue;
      removedNodes.push({ index: i, name: nd.name || `节点${i + 1}`, nameVi: nd.name_vi || null });
    }
  }
  const form = withRoute(inst.form_data);
  const tasks = await many(
    `SELECT t.id, t.node_index, t.assignee_id, t.status, t.comment, t.assigned_at, t.finished_at,
            u.real_name, u.position, d.name AS dept_name
       FROM flow_task t
       LEFT JOIN org_user u ON u.id = t.assignee_id
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE t.instance_id = $1
      ORDER BY t.node_index, t.id`,
    [inst.id]
  );

  const cur = inst.current_index === null || inst.current_index === undefined ? null : Number(inst.current_index);
  const finished = ['completed', 'approved'].includes(String(inst.status));

  // 引擎自动跳过的节点（发起人本人即唯一审批人）没有 flow_task，状态要按 flow_log 还原，
  // 否则详情页会一直显示「处理中/待处理」，与真实流转不符。
  const autoSkips = await many(
    `SELECT node_index, detail FROM flow_log WHERE instance_id = $1 AND action = 'auto_skip'`,
    [inst.id]
  );
  const autoSkipMap = new Map(autoSkips.map(r => [Number(r.node_index), r.detail || null]));

  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i] || {};
    let applies = true;
    if (nd.condition) {
      try { applies = await matchCondition(nd.condition, form); } catch { applies = true; }
    }
    const ts = tasks.filter(t => Number(t.node_index) === i);
    let status;
    if (!applies) status = 'skipped';
    else if (autoSkipMap.has(i)) status = 'skipped';
    else if (ts.some(t => t.status === 'rejected')) status = 'rejected';
    else if (ts.length && ts.every(t => t.status === 'approved')) status = 'approved';
    else if (finished) status = 'approved';
    else if (cur !== null && i < cur) status = 'approved';
    else if (cur !== null && i === cur) status = 'processing';
    else status = 'pending';

    out.push({
      index: i,
      name: nd.name || `节点${i + 1}`,
      nameVi: nd.name_vi || null,
      type: nd.type || 'approval',
      applies,
      conditional: !!nd.condition,
      conditionLabel: conditionLabel(nd.condition),
      minApprovals: nd.min_approvals ? Number(nd.min_approvals) : null,
      requireAllApprovals: !!nd.require_all_approvals,
      autoSkipSelf: autoSkipMap.has(i),
      autoSkipReason: autoSkipMap.get(i) || null,
      // 尚未产生任务的节点，前端展示「预计由谁审」
      assignLabels: await assignLabels(nd.assign),
      status,
      isCurrent: cur !== null && i === cur && !finished,
      approvers: ts.map(t => ({
        id: t.assignee_id ? Number(t.assignee_id) : null,
        name: t.real_name || '—',
        position: t.position || null,
        dept: t.dept_name || null,
        status: t.status,
        comment: t.comment || null,
        assignedAt: t.assigned_at,
        finishedAt: t.finished_at,
      })),
    });
  }

  return {
    instanceId: Number(inst.id),
    instanceNo: inst.instance_no,
    defName: inst.def_name,
    status: inst.status,
    currentIndex: cur,
    submittedAt: inst.submitted_at,
    finishedAt: inst.finished_at,
    customized: !!override,
    removedNodes,
    total: out.length,
    nodes: out,
  };
}

export default { getReviewChainPreview, getReviewProgress, DEF_CODE };
