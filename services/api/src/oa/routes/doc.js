// ============================================================
// 体系文件（S1）REST 路由 —— 38 个接口
// 统一 {code,msg,data}；权限复用 requirePermission；业务异常经 wrapBiz → HTTP 400。
// 分派：doc-service（编号/版本/双语/密级/锁）+ doc-issue（发行）+ doc-ledger（台账）+ doc-cron（扫描）。
// ============================================================
import { authenticate, ok, wrap, requirePermission, resolveErrorResponse } from '../middleware/index.js';
import { many, one, query } from '../db/index.js';
import { toId, toInt } from '../utils/params.js';
import * as docSvc from '../services/doc-service.js';
import * as docIssue from '../services/doc-issue.js';
import * as docObsolete from '../services/doc-obsolete.js';
import * as docFeed from '../services/doc-issue-feed.js';
import * as docLedger from '../services/doc-ledger.js';
import * as docCron from '../services/doc-cron.js';
import * as docDraft from '../services/doc-draft-service.js';
import * as docReviewFlow from '../services/doc-review-flow.js';
import { notify } from '../services/notify.js';

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

// 路径参数转数字：复用共享工具 toId（非正整数/超界/非数字统一归一为 null），
// 避免把 NaN / 超界值传给 pg 导致 "无效的类型 bigint 输入语法: NaN" 这类原始 SQL 报错泄漏到界面。
const n = v => toId(v);
// 非 id 的数值字段（如密级 level、排序 sortOrder，允许 0）：仅归一非法值，不做正数约束
const nNum = v => toInt(v, { def: null });

export default async function docRoutes(app) {
  app.addHook('preHandler', authenticate);

  // ---------------------------------------------------------
  // 1. 编号预览（**只读**，不消耗序号）
  //    历史缺陷：此接口原先直接 nextDocCode 真实取号，导致「进新建页/切分类」
  //    这类浏览动作也会吞掉一个编号（系统里零文件、编号却已到 004）。
  //    现在只做水位预览；真正取号发生在 POST /api/docs。
  // ---------------------------------------------------------
  app.get('/api/docs/next-code', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const { level, category, deptId } = req.query || {};
    const r = await docSvc.peekNextDocCode(category || null, nNum(level), n(deptId));
    // preview=true 供前端提示「保存时正式分配」，避免并发下预览与实际编号不一致引起误解
    return ok(reply, { ...r, preview: true });
  }));

  // ---------------------------------------------------------
  // 1.0 评审链路预览（只读）——新建页展示「提交后会走哪些评审节点」
  //     节点/指派人/条件全部取自 flow_definition(doc_controlled_issue)，
  //     与真实流转同一套解析规则（flow-engine），不会出现预览与实际不一致。
  //     静态段，必须注册在 /api/docs/:id 之前。
  // ---------------------------------------------------------
  app.get('/api/docs/review-chain', wrap(async (req, reply) => {
    const { docId, category, level, productScope, isManual } = req.query || {};
    const r = await docReviewFlow.getReviewChainPreview({
      docId: toInt(docId, { def: null }),
      category: category || null,
      level: toInt(level, { def: null }),
      // 未显式传参 → null（由文件自身 product_scope 决定），不能默认 false
      productScope: productScope === undefined ? null
        : (String(productScope) === 'true' || String(productScope) === '1'),
      isManual: isManual === undefined ? null : (String(isManual) === 'true' || String(isManual) === '1'),
      userId: req.user.id,
    });
    return ok(reply, r);
  }));

  // ---------------------------------------------------------
  // 1.1 新建页草稿（独立表 doc_draft，只有本人可见，不占编号）
  //     路径用 /api/doc-drafts 独立前缀，避免与 /api/docs/:id 动态段互相吞路由。
  // ---------------------------------------------------------
  // 最近一条草稿（新建页进入时提示「有未完成的草稿」）；静态段必须在 /:id 之前
  app.get('/api/doc-drafts/latest', wrapBiz(async (req, reply) => {
    return ok(reply, await docDraft.latestDraft(req.user.id));
  }));

  // 我的草稿列表（分页）
  app.get('/api/doc-drafts', wrapBiz(async (req, reply) => {
    const { page, size } = req.query || {};
    return ok(reply, await docDraft.listDrafts(req.user.id, { page, size }));
  }));

  // 草稿详情（含正文与原件槽位）
  app.get('/api/doc-drafts/:id', wrapBiz(async (req, reply) => {
    const id = n(req.params.id);
    if (id === null) throw Object.assign(new Error('参数不正确'), { statusCode: 400 });
    return ok(reply, await docDraft.getDraft(req.user.id, id));
  }));

  // 新建草稿（自动保存首次落库）
  app.post('/api/doc-drafts', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    return ok(reply, await docDraft.createDraft(req.user.id, req.body || {}), '草稿已保存');
  }));

  // 更新草稿（局部更新，自动保存只传变化字段）
  app.put('/api/doc-drafts/:id', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const id = n(req.params.id);
    if (id === null) throw Object.assign(new Error('参数不正确'), { statusCode: 400 });
    return ok(reply, await docDraft.updateDraft(req.user.id, id, req.body || {}), '草稿已保存');
  }));

  // 废除草稿（物理删除）
  app.delete('/api/doc-drafts/:id', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const id = n(req.params.id);
    if (id === null) throw Object.assign(new Error('参数不正确'), { statusCode: 400 });
    return ok(reply, await docDraft.deleteDraft(req.user.id, id), '草稿已废除');
  }));

  // ---------------------------------------------------------
  // 2. 列表（分类/密级/状态/关键词）
  // ---------------------------------------------------------
  app.get('/api/docs', wrap(async (req, reply) => {
    const r = await docSvc.listDocs(req.query || {});
    return ok(reply, r);
  }));

  // ---------------------------------------------------------
  // 37. 公共盘清单（普通文件；放在 :id 之前避免被吞）
  // ---------------------------------------------------------
  app.get('/api/docs/public-list', wrap(async (req, reply) => {
    const keyword = req.query?.keyword || null;
    const params = [];
    let where = `d.status = 'published' AND d.security_level <> 'secret'`;
    if (keyword) { params.push(`%${keyword}%`); where += ` AND (d.title ILIKE $${params.length} OR d.code ILIKE $${params.length})`; }
    const list = await many(
      `SELECT d.id, d.code, d.title, d.title_vi, d.category, d.current_version, d.issue_date
         FROM doc_system d WHERE ${where} ORDER BY d.issue_date DESC NULLS LAST, d.id DESC LIMIT 200`,
      params
    );
    return ok(reply, list);
  }));

  // ---------------------------------------------------------
  // 28. 印章列表（放 :id 之前）
  // ---------------------------------------------------------
  app.get('/api/docs/seals', wrap(async (req, reply) => {
    const list = await many(`SELECT * FROM doc_seal WHERE active = TRUE ORDER BY sort_order, id`);
    return ok(reply, list);
  }));

  // 29. 维护印章图片/文案
  app.put('/api/docs/seals/:type', { preHandler: requirePermission('doc:manage') }, wrapBiz(async (req, reply) => {
    const { labelZh, labelVi, imageZh, imageVi, active, sortOrder } = req.body || {};
    const seal = await one(
      `UPDATE doc_seal
          SET label_zh = COALESCE($2, label_zh), label_vi = COALESCE($3, label_vi),
              image_zh = COALESCE($4, image_zh), image_vi = COALESCE($5, image_vi),
              active = COALESCE($6, active), sort_order = COALESCE($7, sort_order)
        WHERE type = $1 RETURNING *`,
      [req.params.type, labelZh ?? null, labelVi ?? null, imageZh ?? null, imageVi ?? null,
        active === undefined ? null : !!active, nNum(sortOrder)]
    );
    if (!seal) throw new Error('印章类型不存在');
    return ok(reply, seal, '印章已更新');
  }));

  // ---------------------------------------------------------
  // 30. 外来文件清单（放 :id 之前）
  // ---------------------------------------------------------
  app.get('/api/docs/external', wrap(async (req, reply) => {
    const r = await docLedger.query('external', req.query || {});
    return ok(reply, r);
  }));

  // ---------------------------------------------------------
  // 32. 评审记录（2 年/季度）（放 :id 之前）
  // ---------------------------------------------------------
  app.get('/api/docs/reviews', { preHandler: requirePermission('doc:manage') }, wrap(async (req, reply) => {
    const { reviewType, from, to, page, size } = req.query || {};
    const r = await docLedger.query('review', { reviewType, from, to, page, size });
    return ok(reply, r);
  }));

  // ---------------------------------------------------------
  // 34. 台账查询（放 :id 之前）
  // ---------------------------------------------------------
  app.get('/api/docs/ledger/:type', wrap(async (req, reply) => {
    // 台账查阅：doc:manage 或 doc:view 均可（admin 直通）
    if (!req.user.isAdmin
      && !req.user.permissions.includes('doc:manage')
      && !req.user.permissions.includes('doc:view')) {
      return reply.code(403).send({ code: 1, msg: '没有该操作的权限' });
    }
    const r = await docLedger.query(req.params.type, req.query || {});
    return ok(reply, r);
  }));

  // 35. 台账导出
  app.get('/api/docs/ledger/:type/export', { preHandler: requirePermission('doc:manage') }, wrapBiz(async (req, reply) => {
    const { lang = 'zh', ...filters } = req.query || {};
    const data = await docLedger.exportRows(req.params.type, filters);
    return ok(reply, { ...data, lang });
  }));

  // ---------------------------------------------------------
  // 22. 借阅归还（放 :id 之前，静态段 /borrow/ 前缀）
  // ---------------------------------------------------------
  app.post('/api/docs/borrow/:id/return', { preHandler: requirePermission('doc:manage') }, wrapBiz(async (req, reply) => {
    const rec = await one(
      `UPDATE doc_borrow_record SET status='returned', return_date=CURRENT_DATE
        WHERE id=$1 AND status <> 'returned' RETURNING *`,
      [n(req.params.id)]
    );
    if (!rec) throw new Error('借阅记录不存在或已归还');
    return ok(reply, rec, '已登记归还');
  }));

  // ---------------------------------------------------------
  // 38. 手动触发扫描（管理员）
  // ---------------------------------------------------------
  app.post('/api/docs/cron/scan', wrapBiz(async (req, reply) => {
    const isAdmin = req.user.isAdmin || req.user.permissions.includes('doc:manage');
    if (!isAdmin) { reply.code(403); return { code: 1, msg: '仅管理员可触发' }; }
    const r = await docCron.scanAll();
    return ok(reply, r, '扫描完成');
  }));

  // ---------------------------------------------------------
  // 2.1 体系文件发行动态（首页模块 + 阅读记录）
  //     静态段须先于动态段 /api/docs/:id 注册（既有做法，见 /next-code、/seals 等）。
  // ---------------------------------------------------------
  // 发行动态列表（按当前用户可见范围；含「我是否已读」）。data = 数组。
  app.get('/api/docs/issue/feed', wrap(async (req, reply) => {
    const limit = toInt(req.query?.limit, { def: 8, min: 1, max: 50 });
    const offset = toInt(req.query?.offset, { def: 0, min: 0, max: 100000 });
    return ok(reply, await docFeed.listFeeds(req.user, { limit, offset }));
  }));

  // 写阅读（下发接收）记录（幂等：重复阅读只刷新时间/累加次数）。data = 对象。
  app.post('/api/docs/issue/feed/:id/read', wrapBiz(async (req, reply) => {
    const id = n(req.params.id);
    if (id === null) throw Object.assign(new Error('参数不正确'), { statusCode: 400 });
    const r = await docFeed.markFeedRead(id, req.user);
    return ok(reply, r, '已记录阅读');
  }));

  // 阅读情况（已读名单 + 未读名单 + summary）——限管理员/发行方/doc:manage。data = 对象。
  app.get('/api/docs/issue/feed/:id/reads', wrapBiz(async (req, reply) => {
    const id = n(req.params.id);
    if (id === null) throw Object.assign(new Error('参数不正确'), { statusCode: 400 });
    return ok(reply, await docFeed.getFeedReads(id, req.user));
  }));

  // ---------------------------------------------------------
  // 3. 详情（含双语正文/版本/锁/印章/关联）
  // ---------------------------------------------------------
  app.get('/api/docs/:id', wrap(async (req, reply) => {
    const doc = await docSvc.getDoc(n(req.params.id), req.query?.lang || 'zh');
    if (!doc) return reply.code(404).send({ code: 1, msg: '文档不存在' });
    return ok(reply, doc);
  }));

  // ---------------------------------------------------------
  // 4. 新建
  // ---------------------------------------------------------
  app.post('/api/docs', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const { title, titleVi, code, level, category, ownerDeptId, content, securityLevel, draftId } = req.body || {};
    if (!title) throw new Error('请填写标题');
    const doc = await docSvc.createDoc({
      title, titleVi, code, level, category, ownerDeptId, content, securityLevel, createdBy: req.user.id,
    });
    // 正式创建成功 → 回收对应草稿（失败不影响创建结果：草稿多留一条比丢单据好）
    if (draftId) {
      try {
        await docDraft.consumeDraft(req.user.id, n(draftId));
      } catch (err) {
        req.log.warn({ err, draftId }, '草稿回收失败（不影响文档创建）');
      }
    }
    return ok(reply, doc, '文档已创建（草稿）');
  }));

  // ---------------------------------------------------------
  // 5. 修改元数据
  // ---------------------------------------------------------
  app.put('/api/docs/:id', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const doc = await docSvc.updateDoc(n(req.params.id), req.body || {});
    return ok(reply, doc, '已更新');
  }));

  // ---------------------------------------------------------
  // 6. 领取编辑锁
  // ---------------------------------------------------------
  app.post('/api/docs/:id/lock', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const r = await docSvc.acquireLock(n(req.params.id), req.user.id);
    return ok(reply, r, '已获得编辑权');
  }));

  // 7. 心跳
  app.post('/api/docs/:id/heartbeat', wrap(async (req, reply) => {
    const alive = await docSvc.heartbeatLock(n(req.params.id), req.user.id);
    return ok(reply, { alive }, alive ? '续期成功' : '锁已失效');
  }));

  // 8. 释放锁
  app.post('/api/docs/:id/unlock', wrap(async (req, reply) => {
    await docSvc.releaseLock(n(req.params.id), req.user.id);
    return ok(reply, null, '已释放');
  }));

  // ---------------------------------------------------------
  // 9. 存草稿（双语正文）
  // ---------------------------------------------------------
  app.post('/api/docs/:id/draft', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const { lang = 'zh', content, summary, fileId } = req.body || {};
    await docSvc.saveDraft({ docId: n(req.params.id), userId: req.user.id, lang, content, summary, fileId });
    return ok(reply, null, '草稿已保存');
  }));

  // ---------------------------------------------------------
  // 10. 升版（minor/major）
  // ---------------------------------------------------------
  app.post('/api/docs/:id/version', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const { bumpType = 'minor', content, changeLog } = req.body || {};
    const ver = await docSvc.bumpDocVersion({ docId: n(req.params.id), userId: req.user.id, bumpType, content, changeLog });
    return ok(reply, ver, '已升版');
  }));

  // ---------------------------------------------------------
  // 11. 维护某语言正文/摘要（缺语言补齐）
  // ---------------------------------------------------------
  app.post('/api/docs/:id/version-lang', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const { version, lang, fileId, summary, content } = req.body || {};
    if (!version || !lang) throw new Error('缺少 version 或 lang');
    await docSvc.maintainVersionLang({
      docId: n(req.params.id), userId: req.user.id, version, lang, fileId, summary, content,
    });
    return ok(reply, null, '已维护语言版本');
  }));

  // ---------------------------------------------------------
  // 12. 提交受控发行（发起流程）
  //     reviewNodes：发起人对评审环节的自由选择（可选）
  //       { selected:[0,1,4,5,6,7], removed:{ "2":[12] }, added:{ "1":[9] } }
  //     不传 → 按流程定义原样跑（与改造前行为完全一致）。
  // ---------------------------------------------------------
  app.post('/api/docs/:id/submit-issue', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const { version, issueDepts, reviewNodes } = req.body || {};
    const r = await docIssue.submitIssue({
      docId: n(req.params.id), userId: req.user.id, version, issueDepts,
      reviewNodes: reviewNodes && typeof reviewNodes === 'object' ? reviewNodes : null,
    });
    return ok(reply, r, r.customized ? '已按所选评审环节提交' : '已提交受控发行');
  }));

  // ---------------------------------------------------------
  // 13. 发行流程状态 + 当前节点
  // ---------------------------------------------------------
  app.get('/api/docs/:id/issue-status', wrap(async (req, reply) => {
    const r = await docIssue.getIssueStatus(n(req.params.id));
    return ok(reply, r);
  }));

  // ---------------------------------------------------------
  // 13b. 评审节点进度（逐节点状态/审批人/意见/时间）
  //      详情页「评审进度」面板使用；无实例时 data=null（前端展示预览态）。
  //      只读；可见性与文件详情一致（登录即可查看单据元数据）。
  // ---------------------------------------------------------
  app.get('/api/docs/:id/review-nodes', wrapBiz(async (req, reply) => {
    const id = n(req.params.id);
    if (id === null) throw Object.assign(new Error('参数不正确'), { statusCode: 400 });
    const r = await docReviewFlow.getReviewProgress(id);
    return ok(reply, r);
  }));

  // ---------------------------------------------------------
  // 14. 内部核格式通过/驳回（体系助理节点；映射到流程任务）
  // ---------------------------------------------------------
  app.post('/api/docs/:id/review-action', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const { action, comment } = req.body || {};
    const docId = n(req.params.id);
    const status = await docIssue.getIssueStatus(docId);
    if (!status) throw new Error('该文档无进行中的受控发行流程');
    // 找当前用户在该实例当前节点的待办任务
    const task = await one(
      `SELECT id FROM flow_task
        WHERE instance_id = $1 AND assignee_id = $2 AND status = 'assigned'
        ORDER BY id LIMIT 1`,
      [status.instanceId, req.user.id]
    );
    if (!task) throw new Error('您没有该文件当前的待办任务');
    const { approveTask } = await import('../services/flow-engine.js');
    const r = await approveTask({ taskId: task.id, userId: req.user.id, action: action === 'reject' ? 'reject' : 'approve', comment });
    return ok(reply, r, action === 'reject' ? '已驳回' : '已通过');
  }));

  // ---------------------------------------------------------
  // 15. 兜底直接发行
  // ---------------------------------------------------------
  app.post('/api/docs/:id/publish', { preHandler: requirePermission('doc:issue') }, wrapBiz(async (req, reply) => {
    await docSvc.publishDirect(n(req.params.id), req.user.id);
    return ok(reply, null, '已发行');
  }));

  // ---------------------------------------------------------
  // 16. 作废（编号冻结）——应急兜底直落；常规走 submit-obsolete 流程
  // ---------------------------------------------------------
  app.post('/api/docs/:id/obsolete', { preHandler: requirePermission('doc:issue') }, wrapBiz(async (req, reply) => {
    const { reason } = req.body || {};
    const r = await docSvc.obsoleteDoc({ docId: n(req.params.id), userId: req.user.id, reason });
    return ok(reply, r, '已作废（编号冻结）');
  }));

  // ---------------------------------------------------------
  // 16b. 发起废除申请（走 doc_obsolete 审批流程）
  // ---------------------------------------------------------
  app.post('/api/docs/:id/submit-obsolete', { preHandler: requirePermission('doc:issue') }, wrapBiz(async (req, reply) => {
    const { reason, replacementCode } = req.body || {};
    const r = await docObsolete.submitObsolete({
      docId: n(req.params.id), userId: req.user.id, reason, replacementCode,
    });
    return ok(reply, r, '已提交废除申请');
  }));

  // ---------------------------------------------------------
  // 16c. 废除流程状态 + 当前节点
  // ---------------------------------------------------------
  app.get('/api/docs/:id/obsolete-status', wrap(async (req, reply) => {
    const r = await docObsolete.getObsoleteStatus(n(req.params.id));
    return ok(reply, r);
  }));

  // ---------------------------------------------------------
  // 17. 销毁登记
  // ---------------------------------------------------------
  app.post('/api/docs/:id/destroy', { preHandler: requirePermission('doc:issue') }, wrapBiz(async (req, reply) => {
    const { method, destroyDate } = req.body || {};
    const r = await docSvc.destroyDoc({ docId: n(req.params.id), userId: req.user.id, method, destroyDate });
    return ok(reply, r, '已登记销毁');
  }));

  // ---------------------------------------------------------
  // 18. 发放/回收/补发列表
  // ---------------------------------------------------------
  app.get('/api/docs/:id/issue-records', { preHandler: requirePermission('doc:manage') }, wrap(async (req, reply) => {
    const type = req.query?.type || null;
    const params = [n(req.params.id)];
    let where = `r.doc_id = $1`;
    if (type) { params.push(type); where += ` AND r.record_type = $${params.length}`; }
    const list = await many(
      `SELECT r.*, d.name AS dept_name, d.name_en AS dept_name_en, h.real_name AS holder_name, o.real_name AS operator_name
         FROM doc_issue_record r
         LEFT JOIN org_department d ON d.id = r.dept_id
         LEFT JOIN org_user h ON h.id = r.holder_id
         LEFT JOIN org_user o ON o.id = r.operator_id
        WHERE ${where} ORDER BY r.operate_date DESC, r.id DESC`,
      params
    );
    return ok(reply, list);
  }));

  // 19. 新增发放/回收/补发
  app.post('/api/docs/:id/issue-records', { preHandler: requirePermission('doc:manage') }, wrapBiz(async (req, reply) => {
    const { recordType, version, deptId, holderId, copies, reason, issueNo, relatedRecordId } = req.body || {};
    if (!recordType) throw new Error('缺少记录类型');
    const doc = await one(`SELECT current_version FROM doc_system WHERE id = $1`, [n(req.params.id)]);
    if (!doc) throw new Error('文档不存在');
    const rec = await one(
      `INSERT INTO doc_issue_record
         (doc_id, version, record_type, dept_id, holder_id, copies, reason, issue_no, operator_id, related_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [n(req.params.id), version || doc.current_version, recordType, n(deptId), n(holderId),
        Number(copies) || 1, reason || null, issueNo || null, req.user.id, n(relatedRecordId)]
    );
    return ok(reply, rec, '已登记');
  }));

  // ---------------------------------------------------------
  // 20. 借阅记录
  // ---------------------------------------------------------
  app.get('/api/docs/:id/borrow', { preHandler: requirePermission('doc:manage') }, wrap(async (req, reply) => {
    const list = await many(
      `SELECT b.*, u.real_name AS borrower_name, a.real_name AS approver_name
         FROM doc_borrow_record b
         LEFT JOIN org_user u ON u.id = b.borrower_id
         LEFT JOIN org_user a ON a.id = b.approver_id
        WHERE b.doc_id = $1 ORDER BY b.borrow_date DESC, b.id DESC`,
      [n(req.params.id)]
    );
    return ok(reply, list);
  }));

  // 21. 借阅登记
  app.post('/api/docs/:id/borrow', { preHandler: requirePermission('doc:borrow') }, wrapBiz(async (req, reply) => {
    const { borrowerId, purpose, expectReturnDate, version } = req.body || {};
    const doc = await one(`SELECT current_version FROM doc_system WHERE id = $1`, [n(req.params.id)]);
    if (!doc) throw new Error('文档不存在');
    const rec = await one(
      `INSERT INTO doc_borrow_record (doc_id, version, borrower_id, purpose, expect_return_date, approver_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [n(req.params.id), version || doc.current_version, n(borrowerId) || req.user.id,
        purpose || null, expectReturnDate || null, req.user.id]
    );
    return ok(reply, rec, '已登记借阅');
  }));

  // ---------------------------------------------------------
  // 23. 关联文件
  // ---------------------------------------------------------
  app.get('/api/docs/:id/relations', wrap(async (req, reply) => {
    const list = await many(
      `SELECT r.id, r.related_doc_id, r.relation_type, d.code, d.title, d.title_vi, d.status
         FROM doc_relation r JOIN doc_system d ON d.id = r.related_doc_id
        WHERE r.doc_id = $1 ORDER BY r.id`,
      [n(req.params.id)]
    );
    return ok(reply, list);
  }));

  // 24. 新增关联
  app.post('/api/docs/:id/relations', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const { relatedDocId, relationType } = req.body || {};
    if (!relatedDocId) throw new Error('缺少关联文件');
    const rec = await one(
      `INSERT INTO doc_relation (doc_id, related_doc_id, relation_type)
       VALUES ($1,$2,$3)
       ON CONFLICT (doc_id, related_doc_id, relation_type) DO NOTHING RETURNING *`,
      [n(req.params.id), n(relatedDocId), relationType || 'refer']
    );
    return ok(reply, rec, '已关联');
  }));

  // ---------------------------------------------------------
  // 25. 获取叠章正文（密级校验）
  // ---------------------------------------------------------
  app.get('/api/docs/:id/sealed-file', wrapBiz(async (req, reply) => {
    const doc = await one(`SELECT id, security_level, current_version FROM doc_system WHERE id = $1`, [n(req.params.id)]);
    if (!doc) throw new Error('文档不存在');
    const lang = req.query?.lang || 'zh';
    const row = await one(
      `SELECT l.file_id, l.sealed_file_id, l.content,
              a.file_name AS file_name, a.file_path AS file_path, a.file_size AS file_size,
              sa.file_name AS sealed_file_name, sa.file_path AS sealed_file_path
         FROM doc_version_lang l
         LEFT JOIN attachment a  ON a.id  = l.file_id
         LEFT JOIN attachment sa ON sa.id = l.sealed_file_id
        WHERE l.doc_id = $1 AND l.version = $2 AND l.lang = $3`,
      [doc.id, doc.current_version, lang]
    );
    // 秘密文件：允许预览（水印），不给原始下载链接
    const secret = doc.security_level === 'secret';
    return ok(reply, {
      lang,
      securityLevel: doc.security_level,
      preview: row?.content || null,
      fileId: secret ? null : (row?.file_id || null),
      sealedFileId: row?.sealed_file_id || null,
      // 各语言绑定文件的展示信息（前端据此预览/下载对应语言那一份）
      fileName: row?.file_name || null,
      filePath: secret ? null : (row?.file_path || null),
      sealedFileName: row?.sealed_file_name || null,
      sealedFilePath: row?.sealed_file_path || null,
      watermark: secret ? { level: 'secret', user: req.user.username, at: new Date().toISOString() } : null,
      downloadAllowed: !secret,
    });
  }));

  // ---------------------------------------------------------
  // 26/27. 附件（复用）
  // ---------------------------------------------------------
  app.get('/api/docs/:id/attachments', wrap(async (req, reply) => {
    const list = await many(
      `SELECT a.id, a.file_name, a.file_path, a.file_size, a.mime_type, a.created_at,
              u.real_name AS uploader_name
         FROM attachment a LEFT JOIN org_user u ON u.id = a.uploaded_by
        WHERE a.biz_type = 'doc' AND a.biz_id = $1
        ORDER BY a.created_at DESC`,
      [n(req.params.id)]
    );
    return ok(reply, list);
  }));

  app.post('/api/docs/:id/attachments', { preHandler: requirePermission('doc:edit') }, wrapBiz(async (req, reply) => {
    const { fileName, filePath, fileSize, mimeType } = req.body || {};
    if (!filePath) throw new Error('缺少文件信息');
    const docId = n(req.params.id);
    // /api/upload 只写临时名（并发安全），这里必须定名到稳定目录，
    // 否则附件会永久滞留在 uploads/.staging-tmp（历史遗留问题）。
    const finalPath = docSvc.finalizeDocFile({ filePath, docId, fileName });
    const r = await one(
      `INSERT INTO attachment (biz_type, biz_id, file_name, file_path, file_size, mime_type, uploaded_by)
       VALUES ('doc', $1, $2, $3, $4, $5, $6) RETURNING *`,
      [docId, fileName || finalPath, finalPath, fileSize || 0, mimeType || null, req.user.id]
    );
    return ok(reply, r, '附件已关联');
  }));

  // ---------------------------------------------------------
  // 31. 外来文件季度评审
  // ---------------------------------------------------------
  app.post('/api/docs/:id/external-review', { preHandler: requirePermission('doc:manage') }, wrapBiz(async (req, reply) => {
    const { quarter, result, remark } = req.body || {};
    const docId = n(req.params.id);
    const rec = await one(
      `INSERT INTO doc_review_record (doc_id, review_type, plan_date, done_date, conclusion, reviewer_id, remark)
       VALUES ($1, 'external_quarterly', CURRENT_DATE, CURRENT_DATE, $2, $3, $4) RETURNING *`,
      [docId, result || 'keep', req.user.id, remark || null]
    );
    // 同步 external_record 最近季度与结果
    await query(
      `INSERT INTO doc_external_record (doc_id, last_review_quarter, review_result, review_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (doc_id) DO UPDATE
         SET last_review_quarter = EXCLUDED.last_review_quarter,
             review_result = EXCLUDED.review_result,
             review_by = EXCLUDED.review_by,
             updated_at = now()`,
      [docId, quarter || null, result || 'keep', req.user.id]
    );
    return ok(reply, rec, '外来文件评审已登记');
  }));

  // ---------------------------------------------------------
  // 33. 生成/登记定期评审
  // ---------------------------------------------------------
  app.post('/api/docs/:id/review-plan', { preHandler: requirePermission('doc:manage') }, wrapBiz(async (req, reply) => {
    const { reviewType = 'periodic', planDate } = req.body || {};
    const rec = await one(
      `INSERT INTO doc_review_record (doc_id, review_type, plan_date, reviewer_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [n(req.params.id), reviewType, planDate || null, req.user.id]
    );
    return ok(reply, rec, '评审计划已登记');
  }));

  // ---------------------------------------------------------
  // 36. 打印登记（秘密文件拦截）
  // ---------------------------------------------------------
  app.post('/api/docs/:id/print-log', wrapBiz(async (req, reply) => {
    const doc = await one(`SELECT id, code, security_level FROM doc_system WHERE id = $1`, [n(req.params.id)]);
    if (!doc) throw new Error('文档不存在');
    if (doc.security_level === 'secret') {
      // 记录一次被拒绝的尝试，供审计
      await notify(req.user.id, {
        title: `【打印被拒】${doc.code}`,
        content: `秘密文件 ${doc.code} 禁止打印（已记录本次尝试）。`,
        link: `/docs/${doc.id}`,
        category: 'reminder',
      });
      throw new Error('秘密文件禁止打印');
    }
    return ok(reply, { allowed: true, at: new Date().toISOString() }, '已登记打印');
  }));
}
