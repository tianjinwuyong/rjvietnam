// ============================================================
// 体系文件受控发行对接（doc-issue）
// 职责：把「体系文件受控发行」流程与 doc_system / sys_doc_version / doc_version_lang /
//       doc_issue_record 等业务表对接。
// 说明：本文件【导出】 submitIssue / onIssueApproved / getIssueStatus / onNodeAction
//       供 T03 在 flow-engine 的 advance() 终态分支挂载（T02 不改 flow-engine.js）。
// 流程定义 code：doc_controlled_issue（T01 已落库，8 节点）。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { notify } from './notify.js';
import { createInstance, submitInstance, resolveAssignees } from './flow-engine.js';
import { createIssueFeed, notifyIssueFeed, resolveDeptIdsByCodes } from './doc-issue-feed.js';
import { resolveIssueRoute } from '../lib/doc-issue-route.js';

const DEF_CODE = 'doc_controlled_issue';

/** 取流程定义 id */
async function definitionId() {
  const def = await one(`SELECT id FROM flow_definition WHERE code = $1 AND active = TRUE`, [DEF_CODE]);
  if (!def) throw new Error(`流程定义 ${DEF_CODE} 不存在`);
  return def.id;
}

/** 取流程定义当前生效的节点（与 createInstance 绑定版本的取法保持一致） */
async function currentDefNodes(defId) {
  const def = await one(`SELECT flow_nodes, active_version_id FROM flow_definition WHERE id = $1`, [defId]);
  let nodes = def?.flow_nodes;
  if (def?.active_version_id) {
    const v = await one(
      `SELECT flow_nodes FROM flow_definition_version WHERE id = $1`, [def.active_version_id]);
    if (v?.flow_nodes) nodes = v.flow_nodes;
  }
  if (typeof nodes === 'string') { try { nodes = JSON.parse(nodes); } catch { nodes = []; } }
  return Array.isArray(nodes) ? nodes : [];
}

function idList(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter(v => Number.isInteger(v) && v > 0))];
}

/**
 * 依据发起人的选择，生成「本次实例专用」的节点快照。
 *
 * 入参 reviewNodes 结构（前端 oa-doc-review-panel.js 提交）：
 *   {
 *     selected: [0,1,4,5,6,7],           // 走哪几个环节（定义里的下标，升序执行）
 *     removed:  { "2": [12, 15] },       // 某环节去掉哪些审批人（id）
 *     added:    { "1": [9] }             // 某环节增加哪些审批人（id，必须是在职账号）
 *   }
 *
 * 为什么在服务端重新解析而不是直接用前端传来的名单：
 *   · 防篡改：前端可能传任意 userId，服务端只接受「在职账号」且在解析结果基础上的增删；
 *   · 语义一致：解析规则（role:/position_self:/dept_leader…）只在这里跑一次，
 *     与真实流转同源，避免「预览 6 人、实跑 3 人」。
 *
 * 返回 null 表示「未自定义」→ 实例按定义版本原样跑（零回归）。
 *
 * @returns {Promise<null|{nodes:object[], dropped:object[], warnings:object[]}>}
 */
async function buildNodesOverride({ nodes, reviewNodes, pseudo }) {
  if (!reviewNodes || !Array.isArray(reviewNodes.selected)) return null;
  const sel = [...new Set(
    (reviewNodes.selected || [])
      .map(Number)
      .filter(v => Number.isInteger(v) && v >= 0 && v < nodes.length)
  )].sort((a, b) => a - b);
  if (!sel.length) throw Object.assign(new Error('请至少选择一个评审环节'), { statusCode: 400 });

  const removedMap = reviewNodes.removed || {};
  const addedMap = reviewNodes.added || {};

  // 一次性校验「新增审批人」：在职 + 不是发起人本人（避免自审）
  const allAdded = idList(Object.values(addedMap).flat());
  let validAdded = new Set();
  if (allAdded.length) {
    const rows = await many(
      `SELECT id FROM org_user WHERE id = ANY($1::bigint[]) AND active = TRUE AND id <> $2`,
      [allAdded, pseudo.applicant_id || 0]
    );
    validAdded = new Set(rows.map(r => Number(r.id)));
  }

  const out = [];
  const dropped = [];
  const warnings = [];

  for (const i of sel) {
    const nd = nodes[i] || {};
    const rm = idList(removedMap[i] ?? removedMap[String(i)]);
    const ad = idList(addedMap[i] ?? addedMap[String(i)]).filter(id => validAdded.has(id));

    // 未增删 → 原样保留（保留 role:/position_self: 表达式，人员变动仍可自适应）
    if (!rm.length && !ad.length) {
      out.push(nd);
      continue;
    }

    let base = [];
    try { base = (await resolveAssignees(nd, pseudo)) || []; } catch { base = []; }
    const ids = [];
    for (const p of base) {
      const id = Number(p.id);
      if (Number.isInteger(id) && id > 0 && rm.indexOf(id) === -1 && ids.indexOf(id) === -1) ids.push(id);
    }
    for (const id of ad) if (ids.indexOf(id) === -1) ids.push(id);

    if (!ids.length) {
      dropped.push({ index: i, name: nd.name || `节点${i + 1}`, reason: 'no_assignee' });
      continue;
    }
    const copy = { ...nd, assign: ids.map(id => `user:${id}`) };
    if (copy.min_approvals) copy.min_approvals = Math.min(Number(copy.min_approvals), ids.length);
    out.push(copy);
  }

  if (!out.length) throw Object.assign(new Error('所选环节都没有可用审批人，请至少保留一个'), { statusCode: 400 });

  // 预检：选中的环节若一个审批人也解析不出，提交后必卡住（引擎会挂起并通知管理员），
  // 这里提前告知，让发起人先改选择，而不是提交后再找人接管。
  for (const nd of out) {
    try {
      const r = await resolveAssignees(nd, pseudo);
      if (!r || !r.length) warnings.push({ name: nd.name, reason: 'no_assignee' });
    } catch { /* 解析异常交给引擎兜底 */ }
  }

  return { nodes: out, dropped, warnings };
}

/**
 * 提交受控发行：发起 doc_controlled_issue 流程实例并提交。
 * @param {object} p { docId, userId, version, issueDepts, reviewNodes }
 * @returns {Promise<{instanceId:number, instanceNo:string, title:string, customized:boolean, skippedNodes:object[]}>}
 */
export async function submitIssue({ docId, userId, version, issueDepts = [], reviewNodes = null }) {
  const doc = await one(`SELECT * FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');
  const ver = version || doc.current_version;

  // 双语齐备标记
  const langs = await many(
    `SELECT lang, change_summary FROM doc_version_lang WHERE doc_id = $1 AND version = $2`,
    [docId, ver]
  );
  const hasZh = langs.some(l => l.lang === 'zh');
  const hasVi = langs.some(l => l.lang === 'vi');
  // 修订摘要：优先取该版本已填写的摘要；1.0 初版兜底「初版发行」（2026-11-07）
  const verSummary = langs.map(l => String(l.change_summary || '').trim()).find(Boolean) || '';
  const changeSummary = verSummary || (String(ver) === '1.0' ? '初版发行' : '');

  const isManual = doc.category === 'l1_manual';
  const defId = await definitionId();
  const title = `体系文件发行: ${doc.code} V${ver}`;
  // 审批路由：一/二/三级（体系类、产品类）与四级记录表单各走不同节点链。
  // 计算规则集中在 lib/doc-issue-route.js，预览接口共用，避免「预览一套、实跑一套」。
  const issueRoute = resolveIssueRoute({
    level: doc.level,
    category: doc.category,
    productScope: doc.product_scope,
  });
  // 首批发放部门：一/二/三级文件默认发放到「所有一级部门」（2026-11-07）。
  // 发起时未勾选部门 → 自动带出全部在职一级部门名称（顿号分隔），详情页直接可见；
  // 只取 parent_id IS NULL：制造部涵盖其子部门 SMT/Assy，不重复列（子部门继承发放）。
  // 四级表单发放范围不做默认（保持空）。
  let issueDeptsStr = Array.isArray(issueDepts) ? issueDepts.join(',') : (issueDepts || '');
  if (!String(issueDeptsStr).trim() && Number(doc.level) <= 3) {
    const allDepts = await many(
      `SELECT name FROM org_department WHERE active = TRUE AND parent_id IS NULL ORDER BY sort_order, id`
    );
    issueDeptsStr = allDepts.map(d => d.name).join('、');
  }

  const formData = {
    doc_id: doc.id,
    version: ver,
    doc_level: String(doc.level || 1),
    category: doc.category || '',
    issue_route: issueRoute,
    security_level: doc.security_level || 'public',
    product_scope: doc.product_scope ? 'true' : 'false',
    is_manual: isManual ? 'true' : 'false',
    has_zh: hasZh ? 'true' : 'false',
    has_vi: hasVi ? 'true' : 'false',
    change_summary: changeSummary,
    issue_depts: issueDeptsStr,
  };

  // 发起人自由选择评审环节（迁移 104）：先把选择换算成节点快照，
  // 解析上下文与真实实例一致（申请人 = 提交人，subject 为空）。
  const defNodes = await currentDefNodes(defId);
  const pseudo = {
    id: 0, applicant_id: userId, subject_user_id: null,
    form_data: formData, def_code: DEF_CODE, definition_id: defId,
  };
  const plan = await buildNodesOverride({ nodes: defNodes, reviewNodes, pseudo });

  const inst = await createInstance({ definitionId: defId, userId, title, formData });

  if (plan) {
    await query(
      `UPDATE flow_instance SET nodes_override = $2, updated_at = now() WHERE id = $1`,
      [inst.id, JSON.stringify(plan.nodes)]
    );
    await query(
      `INSERT INTO flow_log (instance_id, actor_id, action, detail) VALUES ($1,$2,'nodes_override',$3)`,
      [inst.id, userId, `发起自定义评审环节：共 ${defNodes.length} 个，选用 ${plan.nodes.length} 个`
        + `（${plan.nodes.map(n => n.name).join(' → ')}）`
        + (plan.dropped.length ? `；因无审批人放弃：${plan.dropped.map(d => d.name).join('、')}` : '')]
    );
  }

  const s = await submitInstance({ instanceId: inst.id, userId });

  // 回写文档状态为评审中（发起发行后进入内部核格式节点）
  await query(`UPDATE doc_system SET status = 'reviewing', updated_at = now() WHERE id = $1`, [docId]);

  return {
    instanceId: inst.id,
    instanceNo: inst.instance_no,
    title,
    currentIndex: s?.current_index ?? inst.current_index,
    customized: !!plan,
    skippedNodes: plan ? plan.dropped : [],
    warnings: plan ? plan.warnings : [],
  };
}

/**
 * 发行进度查询（供 13 号接口）。
 * @returns {instanceId, status, currentIndex, currentNode, defCode} 或 null
 */
export async function getIssueStatus(docId) {
  const inst = await one(
    `SELECT i.id, i.instance_no, i.status, i.current_index, i.submitted_at, i.finished_at, i.nodes_override,
            fd.flow_nodes, fd.code AS def_code
       FROM flow_instance i JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE fd.code = $1 AND (i.form_data->>'doc_id') = $2
      ORDER BY i.id DESC LIMIT 1`,
    [DEF_CODE, String(docId)]
  );
  if (!inst) return null;
  // 有实例级自定义节点时以它为准（否则下标会与定义对不上）
  const src = (Array.isArray(inst.nodes_override) && inst.nodes_override.length)
    ? inst.nodes_override
    : inst.flow_nodes;
  const nodes = Array.isArray(src) ? src
    : (typeof src === 'string' ? JSON.parse(src) : []);
  const idx = inst.current_index === null ? null : Number(inst.current_index);
  const node = idx !== null && nodes[idx] ? nodes[idx] : null;
  return {
    instanceId: inst.id,
    instanceNo: inst.instance_no,
    status: inst.status,
    currentIndex: idx,
    currentNode: node ? { name: node.name, nameVi: node.name_vi, type: node.type } : null,
    submittedAt: inst.submitted_at,
    finishedAt: inst.finished_at,
    defCode: inst.def_code,
  };
}

/**
 * 发行审批完成回调（T03 在 advance() 终态分支挂载）。
 * 步骤（§4.3）：
 *   1. 读 form_data.doc_id/version
 *   2. sys_doc_version.status='published' + published_at
 *   3. 生成叠章正文标记（受控/秘密/试用章）→ doc_version_lang.sealed_file_id 留待前端/PDF 服务回填
 *   4. doc_system.status='published'，issue_date=now()，next_review_date=+review_cycle_months
 *   5. 自动关联培训任务（training + training_record 派发相关部门）
 *   6. doc_issue_record 生成首批 issue 发放记录（按表单选定部门）
 *   7. 关联文件修订提示（doc_relation → notify 负责人）
 * 幂等：重复调用按 doc_id+version 收敛（已发行不重复派发）。
 * @returns {Promise<object>} 处理摘要
 */
export async function onIssueApproved(instanceId) {
  const inst = await one(
    `SELECT i.id, i.form_data FROM flow_instance i
       JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE i.id = $1 AND fd.code = $2`,
    [instanceId, DEF_CODE]
  );
  if (!inst) return { skipped: true, reason: '非受控发行实例' };
  const form = inst.form_data || {};
  const docId = Number(form.doc_id);
  const version = form.version;
  if (!docId || !version) return { skipped: true, reason: '缺少 doc_id/version' };

  const doc = await one(`SELECT * FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) return { skipped: true, reason: '文档不存在' };

  // 幂等：若版本已 published，直接返回
  const already = await one(
    `SELECT id FROM sys_doc_version WHERE doc_id = $1 AND version = $2 AND status = 'published'`,
    [docId, version]
  );
  if (already) return { skipped: true, reason: '该版本已发行（幂等跳过）', docId, version };

  const result = await transaction(async client => {
    const cycle = Number(doc.review_cycle_months) || 24;
    // 1+2+4. 版本与文档状态
    await client.query(
      `UPDATE sys_doc_version SET status='published', published_at=now()
        WHERE doc_id=$1 AND version=$2`,
      [docId, version]
    );
    await client.query(
      `UPDATE doc_system
          SET status='published',
              issue_date = CURRENT_DATE,
              next_review_date = (CURRENT_DATE + ($2 || ' months')::interval)::date,
              updated_at = now()
        WHERE id = $1`,
      [docId, cycle]
    );
    // 旧版本置 obsolete
    await client.query(
      `UPDATE sys_doc_version SET status='obsolete'
        WHERE doc_id=$1 AND version <> $2 AND status='published'`,
      [docId, version]
    );
    return {};
  });

  // 5. 培训任务（按表单选取部门派发；无部门则跳过）
  const deptCodes = String(form.issue_depts || '').split(',').map(s => s.trim()).filter(Boolean);
  let trainingId = null;
  if (deptCodes.length) {
    const tr = await one(
      `INSERT INTO training (name, category, description, plan_date, owner_id, need_exam)
       VALUES ($1, '体系文件', $2, CURRENT_DATE, $3, FALSE) RETURNING id`,
      [`体系文件发行培训：${doc.code} V${version}`, `新发行文件 ${doc.title} V${version} 需宣贯`, null]
    );
    trainingId = tr.id;
    const users = await many(
      `SELECT u.id FROM org_user u JOIN org_department d ON d.id = u.department_id
        WHERE d.code = ANY($1) AND u.active = TRUE`,
      [deptCodes]
    );
    for (const u of users) {
      await query(
        `INSERT INTO training_record (training_id, user_id, status) VALUES ($1, $2, 'pending')`,
        [trainingId, u.id]
      );
      await notify(u.id, {
        title: `【培训】体系文件 ${doc.code} V${version}`,
        content: `${doc.title} 已发行，请参加宣贯培训。`,
        link: `/training`,
        category: 'todo',
      });
    }
  }

  // 6. 首批发放记录（按选定部门）
  let issueCount = 0;
  for (const dc of deptCodes) {
    const dept = await one(`SELECT id FROM org_department WHERE code = $1`, [dc]);
    if (!dept) continue;
    await query(
      `INSERT INTO doc_issue_record (doc_id, version, record_type, dept_id, copies, operator_id, operate_date)
       VALUES ($1,$2,'issue',$3,1,$4,CURRENT_DATE)`,
      [docId, version, dept.id, doc.created_by || null]
    );
    issueCount++;
  }

  // 7. 关联文件修订提示
  const rels = await many(
    `SELECT r.related_doc_id, d.code, d.title, d.created_by
       FROM doc_relation r JOIN doc_system d ON d.id = r.related_doc_id
      WHERE r.doc_id = $1`,
    [docId]
  );
  for (const r of rels) {
    if (!r.created_by) continue;
    await notify(r.created_by, {
      title: `【关联文件变更】${doc.code}`,
      content: `关联文件 ${doc.code} V${version} 已发行，请检查 ${r.code} 是否需要同步修订。`,
      link: `/docs/${r.related_doc_id}`,
      category: 'reminder',
    });
  }

  // 8. 首页「体系文件发行动态」+ 目标人群推送（全员/部门）
  //    需求 2：发行后推送到所有账号的首页；有目标部门时按部门范围（可见性隔离）。
  //    幂等：createIssueFeed 按 doc_id+version 收敛；onIssueApproved 自身已幂等，重复触发不会重复推送。
  let feedId = null;
  let feedNotified = 0;
  try {
    const feedDeptIds = await resolveDeptIdsByCodes(deptCodes);
    const { feed, created } = await createIssueFeed({
      docId,
      version,
      userId: doc.created_by || null,
      scope: feedDeptIds.length ? 'dept' : 'all',
      deptIds: feedDeptIds,
    });
    feedId = feed?.id || null;
    if (created) feedNotified = await notifyIssueFeed(feed);
  } catch (err) {
    console.warn('[doc-issue] 发行动态创建/推送失败（不影响主流程）:', err.message);
  }

  return { docId, version, trainingId, issueCount, relatedNotified: rels.length, feedId, feedNotified };
}

/**
 * 节点动作回调（可选，供 T03 在各节点审批时触发内部动作；当前预留）。
 * 体系助理核格式节点通过（14 号接口 review-action）由路由直接调用。
 */
export async function onNodeAction(instanceId, nodeIndex, userId, action) {
  return { instanceId, nodeIndex, userId, action, handled: false };
}

export default { submitIssue, getIssueStatus, onIssueApproved, onNodeAction, DEF_CODE };
