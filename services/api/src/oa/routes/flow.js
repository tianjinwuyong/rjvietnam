import { authenticate, ok, wrap, requirePermission, resolveErrorResponse } from '../middleware/index.js';
import { many, one, query, transaction } from '../db/index.js';
import { toId, toInt } from '../utils/params.js';
import {
  createInstance, submitInstance, approveTask, addTempApprover,
  returnToApplicant, transferTask, urgeInstance, terminateInstance,
  archiveInstance, addCc, invalidateThresholdCache,
  collectNoAssigneeWarnings, assignNodeToCurrent, withdrawInstance,
} from '../services/flow-engine.js';
import { query as ledgerQuery } from '../services/flow-ledger.js';
import { unreadCount as announcementUnreadCount } from '../services/announcement-service.js';
import { listEvents as listCalendarEvents } from '../services/calendar-service.js';
import {
  listVersions, saveDraftVersion, releaseVersion, rollbackVersion,
} from '../services/flow-version-service.js';
import {
  collectHandoverItems, saveHandover, getHandoverByInstance,
  listHandovers, getHandoverDetail, checkDisableBlockers,
} from '../services/handover-service.js';
import { assertStagedRel } from '../services/drive-service.js';
import { finalizeStagedFile } from '../services/doc-service.js';
import { mimeOf } from '../utils/mime.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { levelOf, flowModuleCode } from '../services/module-permission.js';
import {
  getReadStatus, recordRead, recordWaiver, listReads,
} from '../services/doc-review-read.js';

/**
 * 代提授权校验（第33轮「签卡支持替别人签卡」）。
 *
 * 判定顺序（任一满足即放行）：
 *   1) 提交人 = 业务当事人 → 非代提，直接放行（本函数不应被调用）。
 *   2) sys_config.miss_card_delegate_need_grant = 'true' 时，必须有 flow_delegate_grant 显式授权。
 *   3) 提交人具备 `attend:remedy` 权限（人事/文员岗位）。
 *   4) 提交人是管理员。
 *
 * 说明：默认 miss_card_delegate_need_grant='false'，即"具备 attend:remedy 权限即可代提"，
 * 符合"文员统一为产线员工提签卡"的实际作业方式。
 *
 * @param {object} user req.user（含 id / isAdmin / permissions）
 * @param {number} subjectUserId 被签卡人 id
 * @param {number} definitionId 流程定义 id
 */
async function assertDelegateAllowed(user, subjectUserId, definitionId) {
  const err403 = (msg) => { const e = new Error(msg); e.statusCode = 403; return e; };

  if (!subjectUserId) return;
  if (user.isAdmin) return;

  const needGrant = String(
    (await one(`SELECT value FROM sys_config WHERE key = 'miss_card_delegate_need_grant'`))?.value || 'false'
  ).toLowerCase() === 'true';

  const subject = await one(
    `SELECT id, real_name, department_id FROM org_user WHERE id = $1 AND active = TRUE`,
    [subjectUserId]
  );
  if (!subject) throw err403('被签卡人不存在或已停用');

  // 显式授权：按部门或按人授权均可
  const deptCode = subject.department_id
    ? (await one(`SELECT code FROM org_department WHERE id = $1`, [subject.department_id]))?.code || null
    : null;
  const grant = await one(
    `SELECT 1 FROM flow_delegate_grant
      WHERE delegate_id = $1 AND active = TRUE AND scope = 'miss_card'
        AND (delegator_id = $2 OR (dept_code IS NOT NULL AND dept_code = $3))
      LIMIT 1`,
    [user.id, subjectUserId, deptCode]
  );
  if (grant) return;

  // 权限兜底：具备卡点补卡办理权限即可代提（默认路径）
  const perms = user.permissions || [];
  if (!needGrant && perms.includes('attend:remedy')) return;

  throw err403(
    needGrant
      ? `无权代「${subject.real_name}」提签卡申请（需显式授权）`
      : `无权代「${subject.real_name}」提签卡申请（需「卡点补卡办理」权限）`
  );
}

// 状态归一化 SQL 片段：老数据 approved→completed、canceled→withdrawn
const STATUS_SQL = `CASE WHEN i.status IN ('approved') THEN 'completed'
                          WHEN i.status IN ('canceled') THEN 'withdrawn'
                          ELSE i.status END`;

// 七态筛选归一化（入参）
function normStatus(s) {
  return s === 'approved' ? 'completed' : s === 'canceled' ? 'withdrawn' : s;
}

/**
 * 业务异常包装：与 wrap 共用统一错误出口（脱敏）。
 * 业务错误（普通 Error / 4xx / isBiz）→ 透传消息；DB/系统异常 → 通用文案，绝不回显原文。
 */
function wrapBiz(fn) {
  return async (req, reply) => {
    try {
      const result = await fn(req, reply);
      if (result !== undefined && !reply.sent) return reply.send(result);
    } catch (err) {
      req.log.error({ err }, '接口业务异常');
      if (!reply.sent) {
        const { status, msg } = resolveErrorResponse(err);
        reply.code(status);
        return reply.send({ code: 1, msg });
      }
    }
  };
}

/** 分页参数上界：防止超大 LIMIT/OFFSET 造成资源消耗（越界按非法处理） */
const PAGE_MAX = 100000;
const PAGE_SIZE_MAX = 200;

/**
 * 解析分页参数：缺省取默认值；**显式传入非法值（0/负数/非数字/超界）→ 返回 null**，
 * 由调用方返回 400，避免把 NaN / 负数拼进 SQL 触发数据库原始报错。
 * @returns {{ page:number, size:number }|null}
 */
function parsePaging(rawPage, rawSize) {
  const page = (rawPage === undefined || rawPage === null || rawPage === '')
    ? 1 : toInt(rawPage, { def: null, min: 1, max: PAGE_MAX });
  const size = (rawSize === undefined || rawSize === null || rawSize === '')
    ? 20 : toInt(rawSize, { def: null, min: 1, max: PAGE_SIZE_MAX });
  if (page === null || size === null) return null;
  return { page, size };
}

export default async function flowRoutes(app) {
  app.addHook('preHandler', authenticate);

  // ---- 电子流类型（发起页面用）----
  // 默认仅启用（发起/筛选口径不变）；设计器传 includeInactive=1 以列出并管理已停用流程。
  app.get('/api/flows', wrap(async (req, reply) => {
    const includeInactive = req.query?.includeInactive === '1' || req.query?.includeInactive === 'true';
    // 「新建电子流」列表口径：hide_in_apply 的流程由业务页面 / 系统发起，不能手工创建
    // （排班计划、月度绩效、工作交接、设备盘点、WMS 对接流程等）。
    // 其它调用方（绩效考核页按 code 找定义、流程设计器）不带该参数，行为不变。
    const forApply = req.query?.forApply === '1' || req.query?.forApply === 'true';
    const conds = [];
    if (!includeInactive) conds.push('active = TRUE');
    if (forApply) conds.push('hide_in_apply = FALSE');
    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const list = await many(
      `SELECT id, code, name, name_vi, category, icon, description, closure_required, active,
              hide_in_apply
         FROM flow_definition ${whereSql} ORDER BY category, id`
    );
    // 模块级权限：发起列表只保留「可发起(operate)」的单据类型，
    // 浏览/无权限的类型不出现（否则点了才提示不能提交）。
    // 历史单据不受影响：列表/详情走 /api/instances，仍按「本人/参与人」可见。
    const includeView = req.query?.includeView === '1';
    const visible = req.user.isAdmin || req.user.isApi
      ? list
      : list.filter(d => {
        const lv = levelOf(req.user, flowModuleCode(d.code));
        return lv === 'operate' || (includeView && lv === 'view');
      });
    return ok(reply, visible);
  }));

  // 单个类型的表单结构与节点（前端渲染动态表单）
  app.get('/api/flows/:id', wrap(async (req, reply) => {
    const defId = toId(req.params.id);
    if (defId === null) return reply.code(404).send({ code: 1, msg: '流程类型不存在' });
    const includeInactive = req.query?.includeInactive === '1' || req.query?.includeInactive === 'true';
    const def = await one(
      `SELECT id, code, name, name_vi, category, description, form_schema, flow_nodes,
              closure_required, ledger_columns, active
         FROM flow_definition WHERE id = $1 ${includeInactive ? '' : 'AND active = TRUE'}`,
      [defId]
    );
    if (!def) return reply.code(404).send({ code: 1, msg: '流程类型不存在' });
    if (levelOf(req.user, flowModuleCode(def.code)) === 'none') {
      return reply.code(403).send({ code: 1, msg: `没有「${def.name}」的访问权限，请联系管理员开通` });
    }
    return ok(reply, def);
  }));

  // ---- 单据列表 ----
  // tab: todo 待我审批 / mine 我发起的 / cc 抄送我的 / done 已办
  app.get('/api/instances', wrap(async (req, reply) => {
    const { tab = 'todo', status, definitionId, keyword, page, size } = req.query || {};
    // 分页归一化：非法/越界（0、负数、abc、超界）→ 400，绝不把 NaN/负数拼进 SQL
    const paging = parsePaging(page, size);
    if (!paging) return reply.code(400).send({ code: 1, msg: '请求参数格式不正确' });
    const { page: p, size: s } = paging;
    const offset = (p - 1) * s;
    const params = [];
    let where = '';
    let joinPart = '';

    if (tab === 'todo') {
      joinPart = 'JOIN flow_task t ON t.instance_id = i.id';
      // t.node_index = i.current_index：过滤流转后残留的"幽灵待办"
      where = `t.status = 'assigned' AND t.assignee_id = $${params.push(req.user.id)} AND i.status = 'running' AND t.node_index = i.current_index`;
    } else if (tab === 'mine') {
      params.push(req.user.id);
      where = `i.applicant_id = $${params.length}`;
      if (status) where += ` AND ${STATUS_SQL} = $${params.push(normStatus(status))}`;
    } else if (tab === 'cc') {
      joinPart = 'JOIN flow_cc c ON c.instance_id = i.id';
      where = `c.user_id = $${params.push(req.user.id)}`;
    } else if (tab === 'done') {
      joinPart = 'JOIN flow_task t ON t.instance_id = i.id';
      where = `t.assignee_id = $${params.push(req.user.id)} AND t.status IN ('approved','rejected')`;
    } else if (tab === 'flow') {
      // 「某流程的全部单据」钻取：管理员全量；非管理员沿用下方"本人/参与人"隔离
      where = '1=1';
    } else {
      // 未知 tab 兜底：管理员全量；非管理员不放开（仅按下方"本人/参与人"隔离）
      // 修复：原 `(applicant_id = me OR status='running')` 会让任何登录用户看到所有 running 单据，
      // 与新可见性政策（仅本人/参与人/管理员）冲突。
      where = '1=1';
    }

    if (definitionId) where += ` AND i.definition_id = $${params.push(definitionId)}`;
    if (keyword) {
      params.push(`%${keyword}%`);
      where += ` AND (i.title ILIKE $${params.length} OR i.instance_no ILIKE $${params.length})`;
    }

    // 可见性口径（与单据详情一致）：非管理员仅见 本人发起 / 本人经手（任一历史或当前任务 assignee）/ 本人抄送。
    // 管理员全量。覆盖转办、临时加人产生的 assignee（均写入 flow_task.assignee_id）。
    if (!req.user.isAdmin) {
      params.push(req.user.id);
      const mp = params.length;
      where += ` AND (i.applicant_id = $${mp}
                       OR EXISTS (SELECT 1 FROM flow_task t3 WHERE t3.instance_id = i.id AND t3.assignee_id = $${mp})
                       OR EXISTS (SELECT 1 FROM flow_cc c3 WHERE c3.instance_id = i.id AND c3.user_id = $${mp}))`;
    }

    const from = `FROM flow_instance i
       JOIN flow_definition fd ON fd.id = i.definition_id
       LEFT JOIN org_user u ON u.id = i.applicant_id
       LEFT JOIN org_department d ON d.id = u.department_id
       ${joinPart}
       WHERE ${where}`;

    const rows = await many(
      `SELECT i.id, i.instance_no, i.title, ${STATUS_SQL} AS status, i.applicant_id, i.organization,
              i.created_at, i.submitted_at, i.finished_at, i.current_index, i.closed_loop,
              u.real_name AS applicant_name, d.name AS dept_name, d.name_en AS dept_name_en,
              fd.name AS def_name, fd.code AS def_code, fd.icon, fd.category
       ${from}
       ORDER BY i.created_at DESC, i.id DESC
       LIMIT ${s} OFFSET ${offset}`,
      params
    );
    const cnt = await one(`SELECT COUNT(*)::int AS n ${from}`, params);
    return ok(reply, { list: rows, total: cnt?.n || 0, page: p, size: s });
  }));

  // ---- 单据详情 ----
  app.get('/api/instances/:id', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (id === null) return reply.code(404).send({ code: 1, msg: '单据不存在' });
    const inst = await one(
      `SELECT i.*, fd.name AS def_name, fd.code AS def_code, fd.form_schema, fd.flow_nodes,
              fd.name_vi AS def_name_vi, fd.closure_required, fd.ledger_columns,
              u.real_name AS applicant_name, u.position AS applicant_position, u.organization AS applicant_org,
              d.name AS dept_name, d.name_en AS dept_name_en
         FROM flow_instance i
         JOIN flow_definition fd ON fd.id = i.definition_id
         LEFT JOIN org_user u ON u.id = i.applicant_id
         LEFT JOIN org_department d ON d.id = u.department_id
        WHERE i.id = $1`,
      [id]
    );
    if (!inst) return reply.code(404).send({ code: 1, msg: '单据不存在' });

    // 可见性（用户决策）：仅本人 / 参与人 / 管理员可见。
    // 参与人 = 发起人 ∪ 任一（历史或当前）flow_task.assignee_id ∪ flow_cc.user_id。
    // 覆盖转办与临时加人产生的 assignee（均写入 flow_task.assignee_id）。
    if (!req.user.isAdmin && !req.user.isApi) {
      const me = req.user.id;
      const isApplicant = Number(inst.applicant_id) === Number(me);
      const isAssignee = !isApplicant && !!(await one(
        `SELECT 1 AS ok FROM flow_task WHERE instance_id=$1 AND assignee_id=$2 LIMIT 1`, [id, me]));
      const isCc = !isApplicant && !isAssignee && !!(await one(
        `SELECT 1 AS ok FROM flow_cc WHERE instance_id=$1 AND user_id=$2 LIMIT 1`, [id, me]));
      if (!isApplicant && !isAssignee && !isCc) {
        return reply.code(403).send({ code: 1, msg: '无权查看该单据' });
      }
    }

    inst.status = normStatus(inst.status);

    const tasks = await many(
      `SELECT t.*, u.real_name AS assignee_name, u.position AS assignee_position, u.organization AS assignee_org
         FROM flow_task t LEFT JOIN org_user u ON u.id = t.assignee_id
        WHERE t.instance_id = $1 ORDER BY t.node_index, t.assigned_at`,
      [id]
    );
    const ccs = await many(
      `SELECT c.*, u.real_name FROM flow_cc c
         LEFT JOIN org_user u ON u.id = c.user_id WHERE c.instance_id = $1`,
      [id]
    );
    const logs = await many(
      `SELECT l.*, u.real_name FROM flow_log l
         LEFT JOIN org_user u ON u.id = l.actor_id
        WHERE l.instance_id = $1 ORDER BY l.created_at`,
      [id]
    );
    const attachments = await many(
      `SELECT id, file_name, file_size, mime_type FROM attachment
        WHERE instance_id = $1 ORDER BY created_at`,
      [id]
    );
    // 闭环执行记录
    const executions = await many(
      `SELECT e.*, ru.real_name AS reply_by_name, vu.real_name AS verified_by_name
         FROM flow_execution e
         LEFT JOIN org_user ru ON ru.id = e.reply_by
         LEFT JOIN org_user vu ON vu.id = e.verified_by
        WHERE e.instance_id = $1 ORDER BY e.id`,
      [id]
    );

    const myTask = tasks.find(t => t.assignee_id === req.user.id && t.status === 'assigned');

    // 运行期节点：实例有「发起人自定义环节」快照时以它为准（迁移 104）。
    // 否则 current_index 会与定义表下标错位，详情页会显示错的当前节点。
    const nodes = (Array.isArray(inst.nodes_override) && inst.nodes_override.length)
      ? inst.nodes_override
      : (inst.flow_nodes || []);
    // 对外仍以 flow_nodes 字段名暴露（前端/单据详情历史用法），值换成运行期节点
    inst.flow_nodes = nodes;
    const curNode = (inst.current_index !== null && inst.current_index >= 0) ? nodes[inst.current_index] : null;

    const isApplicant = inst.applicant_id === req.user.id;
    const canWithdraw = isApplicant && inst.status === 'running';
    const canReturn = inst.status === 'running' && (!!myTask || req.user.isAdmin);
    const canUrge = inst.status === 'running' && (isApplicant || !!myTask || req.user.isAdmin);
    const canTerminate = ['draft', 'running', 'rejected'].includes(inst.status) && (isApplicant || req.user.isAdmin);
    const canArchive = !inst.archive_locked && ['completed', 'approved'].includes(inst.status) && (isApplicant || req.user.isAdmin);

    // 挂起告警：当前节点无可用审批人（P1 缺陷修复）——前端据此提示并给出管理员指派入口
    const warnings = await collectNoAssigneeWarnings(id);
    const canAssignNode = inst.status === 'running' && warnings.length > 0 && req.user.isAdmin;

    return ok(reply, {
      ...inst,
      tasks, ccs, logs, attachments, executions,
      myTask: myTask || null,
      currentNode: curNode,
      canApprove: !!myTask && !inst.archive_locked,
      canWithdraw,
      canReturn,
      canUrge,
      canTerminate,
      canArchive,
      warnings,
      canAssignNode,
    });
  }));

  // =========================================================================
  // 受控文件评审：让「经过流程节点的人」读到被评审的文件本身
  // -------------------------------------------------------------------------
  // 背景（ISO 9001 7.5.2 / 8.3）：文件发布前必须经过评审，而评审的前提是
  // 评审人能看到待评审内容。体系文件走 doc_controlled_issue 流程审批时，
  // /flow/detail/:id 只渲染 form_schema 里的元数据字段（版本号、级别、密级…），
  // 正文和附件完全不可见 —— 审批人是在"没看到文件"的情况下点通过的。
  //
  // 这里补两个只读接口，把「实例 → 该实例要评审的那一版文件」暴露给实例参与人：
  //   GET /api/instances/:id/doc-review          元数据 + 语言正文索引 + 附件 + 评审进度入口
  //   GET /api/instances/:id/doc-content?lang=zh  正文 HTML（按需懒加载，避免详情页拖 1MB）
  //
  // 可见性口径与 /api/instances/:id 完全一致：发起人 ∪ 任一（历史或当前）办理人
  // ∪ 抄送 ∪ 管理员。**不额外要求 doc 模块权限**——评审人可能只被临时加签，
  // 若按模块权限拦，恰好是"被指定会签却打不开文件"，与 ISO 要求相反。
  // =========================================================================

  /** 解析实例 → 被评审文件，并做可见性校验；返回 {code,msg} 表示失败 */
  async function loadInstanceDocCtx(req) {
    const id = toId(req.params.id);
    if (id === null) return { code: 404, msg: '单据不存在' };
    const inst = await one(
      `SELECT i.id, i.applicant_id, i.status, i.current_index, i.form_data,
              fd.code AS def_code
         FROM flow_instance i
         JOIN flow_definition fd ON fd.id = i.definition_id
        WHERE i.id = $1`,
      [id]
    );
    if (!inst) return { code: 404, msg: '单据不存在' };

    const form = inst.form_data || {};
    const docId = Number(form.doc_id || 0);
    if (!docId) return { code: 400, msg: '该单据未关联体系文件' };

    if (!req.user.isAdmin && !req.user.isApi) {
      const me = req.user.id;
      const isApplicant = Number(inst.applicant_id) === Number(me);
      const isAssignee = !isApplicant && !!(await one(
        `SELECT 1 AS ok FROM flow_task WHERE instance_id=$1 AND assignee_id=$2 LIMIT 1`, [id, me]));
      const isCc = !isApplicant && !isAssignee && !!(await one(
        `SELECT 1 AS ok FROM flow_cc WHERE instance_id=$1 AND user_id=$2 LIMIT 1`, [id, me]));
      if (!isApplicant && !isAssignee && !isCc) {
        return { code: 403, msg: '无权查看该单据' };
      }
    }
    // 评审的是「提交时固化的版本」，而非文档当前版本（提交后可能又起新版）
    let version = String(form.version || '');
    if (!version) {
      // 老单据 form_data 里没写版本：退回文件当前版本，避免"版本为空 → 找不到正文"的静默空白
      const d = await one(`SELECT current_version FROM doc_system WHERE id = $1`, [docId]);
      version = String(d?.current_version || '');
      if (inst.form_data && typeof inst.form_data === 'object') inst.form_data.version = version;
    }
    return { inst, docId, version };
  }

  app.get('/api/instances/:id/doc-review', wrap(async (req, reply) => {
    const ctx = await loadInstanceDocCtx(req);
    if (ctx.code) return reply.code(ctx.code).send({ code: 1, msg: ctx.msg });
    const { inst, docId } = ctx;

    const doc = await one(
      `SELECT d.id, d.code, d.title, d.title_vi, d.level, d.category, d.status,
              d.current_version, d.security_level, d.issue_date, d.product_scope,
              d.created_by, u.real_name AS created_by_name, dep.name AS owner_dept
         FROM doc_system d
         LEFT JOIN org_user u ON u.id = d.created_by
         LEFT JOIN org_department dep ON dep.id = d.owner_dept_id
        WHERE d.id = $1`,
      [docId]
    );
    if (!doc) return reply.code(404).send({ code: 1, msg: '文件不存在（可能已被删除）' });

    const version = ctx.version || String(doc.current_version || '');
    const langs = await many(
      `SELECT l.lang,
              COALESCE(length(l.content), 0) AS content_len,
              l.change_summary, l.file_id, l.sealed_file_id,
              a.file_name, a.file_path, a.file_size, a.mime_type
         FROM doc_version_lang l
         LEFT JOIN attachment a ON a.id = l.file_id
        WHERE l.doc_id = $1 AND l.version = $2
        ORDER BY l.lang`,
      [docId, version]
    );
    const attachments = await many(
      `SELECT a.id, a.file_name, a.file_size, a.mime_type, a.created_at,
              u.real_name AS uploader_name
         FROM attachment a
         LEFT JOIN org_user u ON u.id = a.uploaded_by
        WHERE a.biz_type = 'doc' AND a.biz_id = $1
        ORDER BY a.created_at DESC`,
      [docId]
    );

    return ok(reply, {
      instanceId: inst.id,
      instanceStatus: inst.status,
      currentIndex: inst.current_index,
      version,
      doc,
      langs,
      attachments,
      // 供前端标注「评审的是哪一版、是否与文件当前版本一致」
      isCurrentVersion: String(doc.current_version) === String(version),
      // 「没读不能批」：当前用户对本单的阅读状态（required/satisfied/read/waived）
      readStatus: await getReadStatus({
        instanceId: inst.id, userId: req.user.id, formData: inst.form_data,
      }),
    });
  }));

  app.get('/api/instances/:id/doc-content', wrap(async (req, reply) => {
    const ctx = await loadInstanceDocCtx(req);
    if (ctx.code) return reply.code(ctx.code).send({ code: 1, msg: ctx.msg });
    const lang = req.query?.lang === 'vi' ? 'vi' : 'zh';
    const version = ctx.version || '';

    const row = await one(
      `SELECT lang, content, change_summary FROM doc_version_lang
        WHERE doc_id = $1 AND version = $2 AND lang = $3`,
      [ctx.docId, version, lang]
    );
    if (!row) {
      // 该语言没录正文：明确告诉前端"换语言/看附件"，不要静默空白页
      return reply.code(404).send({ code: 1, msg: lang === 'vi' ? '该版本没有越文正文' : '该版本没有中文正文' });
    }
    return ok(reply, {
      lang: row.lang,
      version,
      content: row.content || '',
      length: (row.content || '').length,
      changeSummary: row.change_summary || '',
    });
  }));

  // ---- 阅读痕迹：ISO 9001 7.5.2「评审人必须先读到文件」的技术兜底 ----
  // 三个接口都走 loadInstanceDocCtx 的可见性口径（发起人 ∪ 办理人 ∪ 抄送 ∪ admin），
  // 不额外要求 doc 模块权限 —— 被临时加签的人正是"要审批但没模块权限"的那批人。

  /** 当前用户对本单的阅读状态（前端点「通过」前同步校验，避免弹错） */
  app.get('/api/instances/:id/read-status', wrap(async (req, reply) => {
    const ctx = await loadInstanceDocCtx(req);
    if (ctx.code) {
      // 非文件单据不该弹"未阅读"提示：明确告诉前端"不需要校验"，而不是报错
      if (ctx.code === 400) return ok(reply, { required: false, reason: 'no_doc' });
      return reply.code(ctx.code).send({ code: 1, msg: ctx.msg });
    }
    const st = await getReadStatus({
      instanceId: ctx.inst.id, userId: req.user.id, formData: ctx.inst.form_data,
    });
    return ok(reply, { ...st, instanceId: ctx.inst.id });
  }));

  /** 落一条阅读痕迹（前端把正文渲染出来后调用；字符数由服务端实测） */
  app.post('/api/instances/:id/doc-read', wrap(async (req, reply) => {
    const ctx = await loadInstanceDocCtx(req);
    if (ctx.code) return reply.code(ctx.code).send({ code: 1, msg: ctx.msg });
    const row = await recordRead({
      instanceId: ctx.inst.id,
      docId: ctx.docId,
      version: ctx.version,
      userId: req.user.id,
      lang: req.body?.lang,
      dwellMs: req.body?.dwellMs,
      ip: req.ip || null,
      ua: String(req.headers['user-agent'] || '').slice(0, 400),
    });
    return ok(reply, row, '已记录阅读');
  }));

  /**
   * 「确认未阅读仍要通过」：正文读不了（纸质/扫描件/该版本无正文）时的显式例外。
   * 必须填原因 —— 这是给外审看的，不是点掉了事的开关。
   */
  app.post('/api/instances/:id/doc-read-waiver', wrapBiz(async (req, reply) => {
    const ctx = await loadInstanceDocCtx(req);
    if (ctx.code) {
      const err = new Error(ctx.msg);
      err.statusCode = ctx.code;
      throw err;
    }
    const row = await recordWaiver({
      instanceId: ctx.inst.id,
      docId: ctx.docId,
      version: ctx.version,
      userId: req.user.id,
      reason: req.body?.reason,
      ip: req.ip || null,
      ua: String(req.headers['user-agent'] || '').slice(0, 400),
    });
    return ok(reply, row, '已记录未阅读说明');
  }));

  /** 审计视角：本单谁读过、谁豁免未读（管理员） */
  app.get('/api/instances/:id/doc-reads', wrap(async (req, reply) => {
    const ctx = await loadInstanceDocCtx(req);
    if (ctx.code) return reply.code(ctx.code).send({ code: 1, msg: ctx.msg });
    if (!req.user.isAdmin && Number(ctx.inst.applicant_id) !== Number(req.user.id)) {
      return reply.code(403).send({ code: 1, msg: '仅管理员或发起人可查看阅读痕迹' });
    }
    const res = await listReads(ctx.inst.id);
    return ok(reply, res.rows);
  }));

  // ---- 上传附件到流程实例（发起单据后关联附件）----
  // 说明：附件先经 POST /api/upload 落盘拿到 filePath，再此关联；
  //       与 doc.js 的 /api/docs/:id/attachments 使用同一张 attachment 表。
  //       instance_id 与 biz_id 均填实例 id，biz_type='flow'（读取端 GET /api/instances/:id 按 instance_id 查）。
  app.post('/api/instances/:id/attachments', wrapBiz(async (req, reply) => {
    const id = toId(req.params.id);
    const { fileName, filePath, fileSize, mimeType } = req.body || {};
    if (!filePath) throw new Error('缺少文件信息');
    // B1：流程附件同样只接受暂存目录路径，杜绝借关联附件搬走 uploads 内他人文件
    assertStagedRel(filePath);

    const inst = await one(`SELECT id, applicant_id, archive_locked FROM flow_instance WHERE id = $1`, [id]);
    if (!inst) throw new Error('单据不存在');
    if (inst.archive_locked) throw new Error('单据已归档锁定，不可新增附件');

    // 可见性/权限（与单据详情一致）：仅 发起人 / 参与人（assignee 或 cc）/ 管理员可操作附件
    const me = req.user.id;
    let allowed = !!req.user.isAdmin || !!req.user.isApi || Number(inst.applicant_id) === Number(me);
    if (!allowed) {
      const involved = await one(
        `SELECT 1 AS ok
           WHERE EXISTS (SELECT 1 FROM flow_task WHERE instance_id=$1 AND assignee_id=$2)
              OR EXISTS (SELECT 1 FROM flow_cc WHERE instance_id=$1 AND user_id=$2)`,
        [id, me]
      );
      allowed = !!involved;
    }
    if (!allowed) {
      const err = new Error('无权为该单据添加附件');
      err.statusCode = 403;
      throw err;
    }

    // 暂存 → 稳定目录：必须先定名落位再落库，否则文件永远滞留在 .staging-tmp/（易被清理）
    const finalRel = finalizeStagedFile({ filePath, subDir: `flows/${id}`, fileName });

    // 明细表「每行附件」的调用方只传路径，不带大小/类型 → 以磁盘为准补齐，避免附件列表显示 0 B
    let size = Number(fileSize) || 0;
    let mime = mimeType || null;
    if (!size || !mime) {
      try {
        const abs = path.join(config.upload.dir, finalRel);
        size = size || fs.statSync(abs).size;
        if (!mime) mime = mimeOf(abs);
      } catch { /* 取不到就按调用方给的值 */ }
    }

    // 幂等：同一实例 + 同一 filePath 已存在则直接返回，不重复插行
    const dup = await one(
      `SELECT * FROM attachment WHERE instance_id = $1 AND file_path = $2 LIMIT 1`,
      [id, finalRel]
    );
    if (dup) return ok(reply, dup, '附件已关联');

    const r = await one(
      `INSERT INTO attachment (instance_id, biz_type, biz_id, file_name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1, 'flow', $1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, fileName || filePath, finalRel, size, mime, req.user.id]
    );

    // 明细表「每行附件」存的是 form_data 里的暂存路径，定名后必须改写，
    // 否则详情页拿到的链接指向已被搬走的临时文件（404）。
    // 用单条 SQL 做全量字符串替换：一次原子更新，避免与并发上传互相覆盖。
    // 安全性：暂存路径形如 .staging-tmp/<ts>-<hex><ext>，只含安全字符，不会污染 JSON 文本。
    await query(
      `UPDATE flow_instance
          SET form_data = replace(form_data::text, $2, $3)::jsonb, updated_at = now()
        WHERE id = $1 AND position($2 in form_data::text) > 0`,
      [id, String(filePath), finalRel]
    );

    return ok(reply, r, '附件已关联');
  }));

  /** 业务系统回写表单字段（如实际发料数量）；仅 API Key / 管理员，归档单据拒绝 */
  app.patch('/api/instances/:id/form-data', wrapBiz(async (req, reply) => {
    if (!req.user.isApi && !req.user.isAdmin) {
      return reply.code(403).send({ code: 1, msg: '无权修改单据表单' });
    }
    const id = toId(req.params.id);
    const { patch } = req.body || {};
    if (!patch || typeof patch !== 'object') {
      return reply.code(400).send({ code: 1, msg: '缺少 patch' });
    }
    const inst = await one(`SELECT id, archive_locked FROM flow_instance WHERE id=$1`, [id]);
    if (!inst) return reply.code(404).send({ code: 1, msg: '单据不存在' });
    if (inst.archive_locked) return reply.code(400).send({ code: 1, msg: '单据已归档锁定' });
    const r = await one(
      `UPDATE flow_instance SET form_data = form_data || $2::jsonb, updated_at = now()
        WHERE id = $1 RETURNING id, form_data`,
      [id, JSON.stringify(patch)]
    );
    return ok(reply, r, '已更新');
  }));

  // ---- 发起单据 ----
  app.post('/api/instances', { preHandler: requirePermission('flow:submit') }, wrap(async (req, reply) => {
    const { definitionId, title, formData, submitNow, subjectUserId, onBehalfOf,
            bizSystem, bizType, bizKey, applicantUserId } = req.body || {};
    if (!definitionId || !title) return reply.code(400).send({ code: 1, msg: '请填写标题' });

    // 模块级权限：发起某类单据需要该单据类型的「操作」权限（admin / API Key 不受限）
    if (!req.user.isApi) {
      const def = await one(
        `SELECT code, name, block_manual FROM flow_definition WHERE id = $1`, [Number(definitionId)]
      );
      if (!def) return reply.code(400).send({ code: 1, msg: '流程类型不存在' });
      // 系统/业务页面发起的流程（排班计划、工作交接、设备盘点、WMS 对接…）不允许从通用发起页创建：
      // 它们的表单渲染不出来，或者数据必须由业务页面/服务层写入，手工创建只会产出空单。
      if (def.block_manual) {
        return reply.code(403).send({
          code: 1,
          msg: `「${def.name}」不提供手工发起入口，请在对应业务页面办理`,
          bizCode: 'FLOW_MANUAL_ENTRY_DISABLED',
        });
      }
      if (levelOf(req.user, flowModuleCode(def.code)) !== 'operate') {
        return reply.code(403).send({ code: 1, msg: `没有「${def.name}」的发起权限，请联系管理员开通` });
      }
    }

    // 被签卡人（代提）：优先顶层 subjectUserId，其次表单里的 on_behalf_of（前端字段）
    const subject = subjectUserId ?? onBehalfOf ?? formData?.on_behalf_of ?? null;

    // 外部系统（API Key）代业务系统提交：申请人由 applicantUserId 指定
    const applicantId = req.user.isApi ? Number(applicantUserId || 0) : Number(req.user.id);
    if (!applicantId) {
      return reply.code(400).send({ code: 1, msg: '申请人未映射到 OA 用户', bizCode: 'USER_NOT_MAPPED' });
    }

    // 代提授权校验：仅当确实"替他人提交"时才校验（外部系统调用跳过）
    if (!req.user.isApi && subject && Number(subject) !== Number(req.user.id)) {
      await assertDelegateAllowed(req.user, Number(subject), definitionId);
    }

    const inst = await createInstance({
      definitionId, userId: applicantId, title, formData,
      subjectUserId: subject, bizSystem, bizType, bizKey,
    });

    if (submitNow) {
      const r = await submitInstance({ instanceId: inst.id, userId: applicantId });
      return ok(reply, { ...inst, advance: r }, '已提交');
    }
    return ok(reply, inst, '草稿已保存');
  }));

  app.post('/api/instances/:id/submit', wrap(async (req, reply) => {
    // 模块级权限：提交草稿同样需要该类单据的「操作」权限
    if (!req.user.isApi) {
      const def = await one(
        `SELECT fd.code, fd.name FROM flow_instance i
           JOIN flow_definition fd ON fd.id = i.definition_id WHERE i.id = $1`,
        [toId(req.params.id)]
      );
      if (def && levelOf(req.user, flowModuleCode(def.code)) !== 'operate') {
        return reply.code(403).send({ code: 1, msg: `没有「${def.name}」的发起权限` });
      }
    }
    const r = await submitInstance({
      instanceId: toId(req.params.id), userId: req.user.id,
      comment: req.body?.comment,
    });
    return ok(reply, r, '已提交');
  }));

  // ============================================================
  // 工作交接（Handover）
  // ------------------------------------------------------------
  // 需求：离职/调岗/长假人员与接手人（新入职或老员工）的工作交接。
  // D4：停用前阻断校验；D3：审批通过自动批量转交；D2b：后续流程按新老员工替换。
  // ============================================================

  // 清单预览：拉取某人名下待交接事项（不发流程，供前端勾选）
  // 权限：本人 / 具备 hr:handover / 管理员
  app.get('/api/handover/items', wrap(async (req, reply) => {
    const uid = toId(req.query?.userId) || req.user.id;
    const canOther = req.user.isAdmin || req.user.permissions?.includes('hr:handover');
    if (Number(uid) !== Number(req.user.id) && !canOther) {
      return reply.code(403).send({ code: 1, msg: '无权查看他人交接清单' });
    }
    const items = await collectHandoverItems(uid);
    return ok(reply, items);
  }));

  // 交接单列表
  app.get('/api/handover', wrap(async (req, reply) => {
    const { tab = 'all', fromUserId, page, size } = req.query || {};
    const paging = parsePaging(page, size);
    if (!paging) return reply.code(400).send({ code: 1, msg: '请求参数格式不正确' });
    const rows = await listHandovers({
      user: req.user, tab, fromUserId: toId(fromUserId),
      page: paging.page, size: paging.size,
    });
    return ok(reply, rows);
  }));

  // 交接单详情
  app.get('/api/handover/:id', wrap(async (req, reply) => {
    const h = await getHandoverDetail(req.params.id);
    if (!h) return reply.code(404).send({ code: 1, msg: '交接单不存在' });
    const canOther = req.user.isAdmin || req.user.permissions?.includes('hr:handover');
    const mine = Number(h.from_user_id) === Number(req.user.id) || Number(h.to_user_id) === Number(req.user.id);
    if (!mine && !canOther) return reply.code(403).send({ code: 1, msg: '无权查看该交接单' });
    return ok(reply, h);
  }));

  // 发起工作交接单（一条龙：建实例 + 落交接单与明细 + 提交）
  // 权限：本人（交方=自己）无需 hr:handover；代他人发起需 hr:handover
  app.post('/api/handover', wrapBiz(async (req, reply) => {
    const {
      definitionId, fromUserId, toUserId, handoverType, effectiveDate,
      migrateTodo, replaceRouting, remark, items, submitNow = true,
    } = req.body || {};

    const fromId = toId(fromUserId) || req.user.id;
    const canOther = req.user.isAdmin || req.user.permissions?.includes('hr:handover');
    if (Number(fromId) !== Number(req.user.id) && !canOther) {
      const err = new Error('无权代他人发起工作交接');
      err.statusCode = 403;
      throw err;
    }
    const toUser = toId(toUserId);
    if (!toUser) return reply.code(400).send({ code: 1, msg: '请选择接方（接手人）' });
    if (Number(toUser) === Number(fromId)) {
      return reply.code(400).send({ code: 1, msg: '交方与接方不能是同一人' });
    }

    // 解析流程定义（handover）
    let defId = toId(definitionId);
    if (!defId) {
      const def = await one(`SELECT id FROM flow_definition WHERE code = 'handover' AND active = TRUE LIMIT 1`);
      defId = def?.id || null;
    }
    if (!defId) return reply.code(400).send({ code: 1, msg: '工作交接流程未配置' });

    const fromUser = await one(`SELECT id, real_name, department_id FROM org_user WHERE id = $1`, [fromId]);
    if (!fromUser) return reply.code(400).send({ code: 1, msg: '交方不存在' });

    const typeLabel = { resign: '离职交接', transfer: '调岗交接', long_leave: '长假交接', other: '工作交接' }[handoverType] || '工作交接';
    const title = `${typeLabel}｜${fromUser.real_name}`;

    // 清单：未传则自动汇总
    const list = Array.isArray(items) && items.length ? items : await collectHandoverItems(fromId);

    const inst = await createInstance({
      definitionId: defId, userId: req.user.id, title,
      formData: {
        handover_type: handoverType || 'resign',
        from_user_id: fromId,
        to_user_id: toUser,
        effective_date: effectiveDate || null,
        migrate_todo: migrateTodo !== false,
        replace_routing: replaceRouting !== false,
        handover_items: list,
        remark: remark || '',
      },
      // 审批链以交方为业务当事人上溯（直属上级=交方的上级）
      subjectUserId: fromId,
    });

    await saveHandover({
      instanceId: inst.id,
      handoverType: handoverType || 'resign',
      fromUserId: fromId,
      toUserId: toUser,
      deptId: fromUser.department_id,
      effectiveDate: effectiveDate || null,
      migrateTodo: migrateTodo !== false,
      replaceRouting: replaceRouting !== false,
      remark: remark || null,
      createdBy: req.user.id,
      items: list.map(it => ({
        item_type: it.item_type, ref_table: it.ref_table, ref_id: it.ref_id,
        title: it.title, detail: it.detail, transfer: it.transfer,
      })),
    });

    if (submitNow) {
      const r = await submitInstance({ instanceId: inst.id, userId: req.user.id });
      return ok(reply, { ...inst, handoverId: (await getHandoverByInstance(inst.id))?.id, advance: r }, '交接单已提交');
    }
    return ok(reply, inst, '交接单已保存');
  }));

  // 停用前阻断校验：返回在途交接事项统计（前端停用确认前调用）
  app.get('/api/handover/blockers/:userId', wrap(async (req, reply) => {
    const uid = toId(req.params.userId);
    if (!uid) return reply.code(400).send({ code: 1, msg: '参数错误' });
    const canOther = req.user.isAdmin || req.user.permissions?.includes('hr:handover')
      || req.user.permissions?.includes('system:manage');
    if (Number(uid) !== Number(req.user.id) && !canOther) {
      return reply.code(403).send({ code: 1, msg: '无权限' });
    }
    const blockers = await checkDisableBlockers(uid);
    return ok(reply, blockers);
  }));

  // ---- 审批 / 执行回复 / 验证闭环 ----
  app.post('/api/tasks/:id/approve', { preHandler: requirePermission('flow:approve') }, wrapBiz(async (req, reply) => {
    const { action = 'approve', comment, extraFields, reply: replyData } = req.body || {};
    const r = await approveTask({
      taskId: toId(req.params.id), userId: req.user.id,
      action, comment, extraFields, reply: replyData,
    });
    const msg = action === 'reject' ? '已驳回'
      : r.status === 'completed' ? '单据已全部通过'
      : r.waiting ? `已通过（会签还需 ${r.required - r.approved} 人）`
      : '已通过，流转至下一节点';
    return ok(reply, r, msg);
  }));

  /** 批量审批：逐条独立事务，部分失败不影响其他 */
  app.post('/api/tasks/batch-approve', { preHandler: requirePermission('flow:approve') }, wrapBiz(async (req, reply) => {
    const { taskIds = [], action = 'approve', comment } = req.body || {};
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return reply.code(400).send({ code: 1, msg: '请选择要审批的任务' });
    }
    const success = [];
    const failed = [];
    for (const id of taskIds) {
      try {
        await approveTask({
          taskId: toId(id), userId: req.user.id, action, comment,
        });
        success.push(toId(id));
      } catch (e) {
        failed.push({ id: toId(id), reason: e?.message || String(e) });
      }
    }
    return ok(reply, { success, failed }, `成功 ${success.length} 条，失败 ${failed.length} 条`);
  }));

  // ---- 退回发起人重填 ----
  app.post('/api/instances/:id/return', wrapBiz(async (req, reply) => {
    const r = await returnToApplicant({
      instanceId: toId(req.params.id), userId: req.user.id,
      comment: req.body?.comment,
    });
    return ok(reply, r, '已退回发起人');
  }));

  // ---- 转交他人 ----
  app.post('/api/tasks/:id/transfer', wrapBiz(async (req, reply) => {
    const { toUserId, comment } = req.body || {};
    if (!toUserId) return reply.code(400).send({ code: 1, msg: '请选择转交对象' });
    const r = await transferTask({
      taskId: toId(req.params.id), userId: req.user.id,
      toUserId: Number(toUserId), comment,
    });
    return ok(reply, r, `已转交给 ${r.name}`);
  }));

  // ---- 管理员指派审批人（挂起节点接管）----
  app.post('/api/instances/:id/assign-node', wrapBiz(async (req, reply) => {
    const { targetUserId, reason } = req.body || {};
    const r = await assignNodeToCurrent({
      instanceId: toId(req.params.id), userId: req.user.id,
      targetUserId: Number(targetUserId), reason,
    });
    const msg = r.alreadyAssigned ? '当前节点已有待办人，未重复指派'
      : `已指派「${r.nodeName || '节点'}」审批人`;
    return ok(reply, r, msg);
  }));

  // ---- 催办提醒 ----
  app.post('/api/instances/:id/urge', wrapBiz(async (req, reply) => {
    const r = await urgeInstance({ instanceId: toId(req.params.id), userId: req.user.id });
    return ok(reply, r, `已催办 ${r.count} 位待办人`);
  }));

  // ---- 流程终止 ----
  app.post('/api/instances/:id/terminate', wrapBiz(async (req, reply) => {
    const r = await terminateInstance({
      instanceId: toId(req.params.id), userId: req.user.id,
      reason: req.body?.reason,
    });
    return ok(reply, r, '流程已终止');
  }));

  // ---- 办结自定义抄送 ----
  app.post('/api/instances/:id/cc', wrapBiz(async (req, reply) => {
    const { userIds = [], deptCodes = [] } = req.body || {};
    const r = await addCc({
      instanceId: toId(req.params.id), userId: req.user.id, userIds, deptCodes,
    });
    return ok(reply, r, `已抄送 ${r.count} 人`);
  }));

  // ---- 归档（含闭环校验 + 锁定）----
  app.post('/api/instances/:id/archive', wrapBiz(async (req, reply) => {
    const { userIds = [], deptCodes = [] } = req.body || {};
    const r = await archiveInstance({
      instanceId: toId(req.params.id), userId: req.user.id, userIds, deptCodes,
    });
    return ok(reply, r, '已归档');
  }));

  // ---- 临时拉人确认 ----
  app.post('/api/instances/:id/temp-add', wrap(async (req, reply) => {
    const { userId, reason } = req.body || {};
    if (!userId) return reply.code(400).send({ code: 1, msg: '请选择人员' });
    const r = await addTempApprover({
      instanceId: toId(req.params.id), userId: req.user.id,
      targetUserId: Number(userId), reason,
    });
    return ok(reply, r, `已添加 ${r.name} 进行确认`);
  }));

  // ---- 撤销（七态：withdrawn，保留 canceled 兼容读取）----
  app.post('/api/instances/:id/withdraw', wrap(async (req, reply) => {
    // 撤回语义单一实现（引擎导出），与盘点服务共用
    await withdrawInstance({ instanceId: toId(req.params.id), userId: req.user.id });
    return ok(reply, null, '已撤销');
  }));

  // ---- 可选人员（临时加签选人用）----
  app.get('/api/flows/:id/candidates', wrap(async (req, reply) => {
    const list = await many(
      `SELECT u.id, u.real_name, u.position, u.organization, d.name AS dept_name, d.name_en AS dept_name_en
         FROM org_user u LEFT JOIN org_department d ON d.id = u.department_id
        WHERE u.active = TRUE AND COALESCE(u.is_system, FALSE) = FALSE
        ORDER BY d.name, u.real_name LIMIT 200`
    );
    return ok(reply, list);
  }));

  // ---- 台账 ----
  app.get('/api/ledger/:code', wrap(async (req, reply) => {
    const { from, to, dept, status, keyword, page, size } = req.query || {};
    const data = await ledgerQuery(
      req.params.code,
      { from, to, dept, status, keyword, page, size },
      req.user
    );
    return ok(reply, data);
  }));

  // ---- 统计看板 ----
  app.get('/api/stats/overview', wrap(async (req, reply) => {
    const [byStatus, byDef, todo, recent, annUnread, calendarEvents] = await Promise.all([
      many(`SELECT ${STATUS_SQL} AS status, COUNT(*)::int AS n
              FROM flow_instance i JOIN flow_definition fd ON fd.id=i.definition_id
             GROUP BY ${STATUS_SQL}`),
      many(`SELECT fd.id, fd.code, fd.name, fd.name_vi, fd.category, COUNT(i.id)::int AS n
              FROM flow_definition fd LEFT JOIN flow_instance i ON i.definition_id = fd.id
             WHERE fd.active = TRUE GROUP BY fd.id ORDER BY n DESC`),
      one(`SELECT COUNT(*)::int AS n FROM flow_task WHERE assignee_id=$1 AND status='assigned'`, [req.user.id]),
      many(`SELECT i.id, i.instance_no, i.title, ${STATUS_SQL} AS status, i.created_at, fd.name AS def_name, u.real_name AS applicant_name
              FROM flow_instance i JOIN flow_definition fd ON fd.id=i.definition_id
              LEFT JOIN org_user u ON u.id=i.applicant_id
             ORDER BY i.created_at DESC LIMIT 8`),
      // S7：通告未读数（首页红点）
      announcementUnreadCount(req.user.id),
      // S7：近 7 天日程事件（个人日程 + 待办 + 完成聚合），供首页日历
      listCalendarEvents({
        userId: req.user.id,
        from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
        to: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      }),
    ]);

    // 现有字段保持不变；新增字段仅追加
    // statusCounts：归一化后的状态字典（修正前端 cnt('approved') 恒 0 的 bug：
    //   后端 STATUS_SQL 已将 approved 归一为 completed，前端应改用 statusCounts.completed）
    const statusCounts = {};
    for (const r of byStatus) statusCounts[r.status] = r.n;

    const calendarTodoCount = calendarEvents.filter(e => e.source === 'task').length;

    return ok(reply, {
      byStatus, byDef, todo: todo?.n || 0, recent,
      // ---- S7 新增 ----
      statusCounts,
      announcementUnread: annUnread,
      calendarTodoCount,
    });
  }));

  // ---- S7：首页日历事件（区间聚合：个人日程 + 待办 + 完成）----
  app.get('/api/stats/calendar', wrap(async (req, reply) => {
    const { from, to } = req.query || {};
    const events = await listCalendarEvents({ userId: req.user.id, from, to });
    return ok(reply, events);
  }));

  // ---- 流程配置器（管理员）----
  // 保存流程定义（节点 + 表单 + 双语名 + 闭环 + 台账列）
  app.put('/api/flows/:id/config', { preHandler: requirePermission('flow:config') }, wrap(async (req, reply) => {
    const defId = toId(req.params.id);
    if (defId === null) return reply.code(404).send({ code: 1, msg: '流程类型不存在' });
    const { flowNodes, formSchema, name, nameVi, description, category, closureRequired, ledgerColumns: lc, active } = req.body || {};

    // M-01：本表更新 + 「保存即产出版本快照」必须在同一事务内完成，避免半更新。
    //  背景：实例创建时按 flow_definition.active_version_id 落 definition_version，
    //        运行期 resolveNodes 在 definition_version != null 时**只读版本快照的 flow_nodes**
    //        ⇒ 若只改本表，20/21 条（active_version_id 非空）的编辑会被静默忽略。
    //  语义保持：① 新发起 → 用新配置（指针指向新版本）；② 在途 → 按其发起时绑定的旧版本推进。
    const result = await transaction(async (client) => {
      const upd = await client.query(
        `UPDATE flow_definition SET
           flow_nodes = COALESCE($2::jsonb, flow_nodes),
           form_schema = COALESCE($3::jsonb, form_schema),
           name = COALESCE($4, name),
           name_vi = COALESCE($5, name_vi),
           description = COALESCE($6, description),
           category = COALESCE($7, category),
           closure_required = COALESCE($8, closure_required),
           ledger_columns = COALESCE($9::jsonb, ledger_columns),
           active = COALESCE($10, active),
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [defId, flowNodes ? JSON.stringify(flowNodes) : null,
         formSchema ? JSON.stringify(formSchema) : null, name, nameVi || null, description, category,
         (closureRequired === undefined ? null : !!closureRequired),
         lc ? JSON.stringify(lc) : null,
         (active === undefined ? null : !!active)]
      );
      if (!upd.rowCount) throw Object.assign(new Error('流程类型不存在'), { statusCode: 404 });
      const def = upd.rows[0];

      // 无激活版本（如 doc_obsolete / 新建流程）→ 实例直接读本表，仅更新本表即可，不建版本
      if (!def.active_version_id) {
        return { versionCreated: false, reason: 'no-active-version' };
      }

      // 与「当前激活版本」比对（jsonb 语义比较，含 NULL 区分）
      const cmp = await client.query(
        `SELECT (fd.flow_nodes      IS NOT DISTINCT FROM v.flow_nodes)      AS eq_nodes,
                (fd.form_schema     IS NOT DISTINCT FROM v.form_schema)     AS eq_form,
                (fd.ledger_columns  IS NOT DISTINCT FROM v.ledger_columns)  AS eq_ledger,
                (fd.name            IS NOT DISTINCT FROM v.name)            AS eq_name,
                (fd.name_vi         IS NOT DISTINCT FROM v.name_vi)         AS eq_name_vi,
                v.id AS active_version_id, v.version AS active_version
           FROM flow_definition fd
           JOIN flow_definition_version v ON v.id = fd.active_version_id
          WHERE fd.id = $1`,
        [defId]
      );
      const c = cmp.rows[0];
      const same = !!c && c.eq_nodes && c.eq_form && c.eq_ledger && c.eq_name && c.eq_name_vi;
      if (same) {
        // 无实质差异 → 不建版本（避免版本膨胀）
        return { versionCreated: false, reason: 'no-change', activeVersion: c ? c.active_version : null };
      }

      // 有实质差异 → 产出新版本（version = max+1），旧 released 归档，指针指向新版本
      const mx = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS mx FROM flow_definition_version WHERE definition_id = $1`,
        [defId]
      );
      const nextVersion = Number(mx.rows[0].mx) + 1;
      await client.query(
        `UPDATE flow_definition_version SET status = 'archived'
          WHERE definition_id = $1 AND status = 'released'`,
        [defId]
      );
      // 新版本须覆盖「实例运行会读到的列」——运行期只读 flow_nodes（resolveNodes）；
      // 另按版本表 NOT NULL 与版本管理页展示需要，一并写入 name/name_vi/form_schema/ledger_columns。
      const ins = await client.query(
        `INSERT INTO flow_definition_version
           (definition_id, version, name, name_vi, form_schema, flow_nodes, ledger_columns, status, released_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'released', now(), $8)
         RETURNING id, version`,
        [defId, nextVersion, def.name, def.name_vi,
         JSON.stringify(def.form_schema || []), JSON.stringify(def.flow_nodes || []),
         def.ledger_columns ? JSON.stringify(def.ledger_columns) : null, req.user.id]
      );
      await client.query(
        `UPDATE flow_definition SET active_version_id = $2, updated_at = now() WHERE id = $1`,
        [defId, ins.rows[0].id]
      );
      return { versionCreated: true, version: ins.rows[0].version, versionId: ins.rows[0].id };
    });

    invalidateThresholdCache();
    return ok(reply, result, '流程配置已保存');
  }));

  // 新建流程类型（低代码化：支持 icon / closureRequired / ledgerColumns；code 冲突友好报错）
  app.post('/api/flows', { preHandler: requirePermission('flow:config') }, wrap(async (req, reply) => {
    const { code, name, nameVi, category, description, icon, flowNodes, formSchema, closureRequired, ledgerColumns } = req.body || {};
    if (!code || !name) return reply.code(400).send({ code: 1, msg: '请填写编码和名称' });
    const c = String(code).trim();
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(c)) {
      return reply.code(400).send({ code: 1, msg: '编码格式不合法：需以小写字母开头，仅含小写字母/数字/下划线，长度 2–50' });
    }
    const dup = await one(`SELECT id FROM flow_definition WHERE code = $1`, [c]);
    if (dup) return reply.code(409).send({ code: 1, msg: `编码「${c}」已存在，请更换` });
    try {
      const r = await one(
        `INSERT INTO flow_definition
           (code, name, name_vi, category, description, icon, flow_nodes, form_schema, closure_required, ledger_columns, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [c, name, nameVi || null, category || '其他', description || null, icon || null,
         JSON.stringify(flowNodes || []), JSON.stringify(formSchema || []),
         closureRequired === undefined ? false : !!closureRequired,
         ledgerColumns ? JSON.stringify(ledgerColumns) : null, req.user.id]
      );
      return ok(reply, r, '流程类型已创建');
    } catch (e) {
      if (e && (e.code === '23505' || /duplicate key/i.test(e.message || ''))) {
        return reply.code(409).send({ code: 1, msg: `编码「${c}」已存在，请更换` });
      }
      throw e;
    }
  }));

  // ============================================================
  // S6：电子流版本管理（flow:config 权限）
  // ============================================================

  // 版本列表
  app.get('/api/flows/:id/versions', wrap(async (req, reply) => {
    const defId = toId(req.params.id);
    if (defId === null) return reply.code(404).send({ code: 1, msg: '流程类型不存在' });
    const def = await one(`SELECT id, code, name, active_version_id FROM flow_definition WHERE id = $1`, [defId]);
    if (!def) return reply.code(404).send({ code: 1, msg: '流程类型不存在' });
    const versions = await listVersions(defId);
    return ok(reply, { definition: def, versions });
  }));

  // 保存草稿版本
  app.post('/api/flows/:id/versions', { preHandler: requirePermission('flow:config') }, wrapBiz(async (req, reply) => {
    const { name, nameVi, formSchema, flowNodes, ledgerColumns } = req.body || {};
    const v = await saveDraftVersion(toId(req.params.id),
      { name, nameVi, formSchema, flowNodes, ledgerColumns }, req.user.id);
    return ok(reply, v, `已保存草稿版本 v${v.version}`);
  }));

  // 发布版本（设为正式版本，旧版归档）
  app.post('/api/flows/:id/versions/:vid/release', { preHandler: requirePermission('flow:config') }, wrapBiz(async (req, reply) => {
    const r = await releaseVersion(toId(req.params.id), toId(req.params.vid));
    return ok(reply, r, `已发布版本 v${r.version}`);
  }));

  // 回滚到历史版本
  app.post('/api/flows/:id/versions/:vid/rollback', { preHandler: requirePermission('flow:config') }, wrapBiz(async (req, reply) => {
    const r = await rollbackVersion(toId(req.params.id), toId(req.params.vid));
    return ok(reply, r, `已回滚至版本 v${r.version}`);
  }));
}
