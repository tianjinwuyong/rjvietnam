// ============================================================
// 培训考证路由（岗前 / 在岗培训：计划 + 记录 + 按员工查询）
// ------------------------------------------------------------
// 与旧路由的关系：modules.js 仍提供 /api/training（旧培训列表/考试）与
//   /api/certificates（上岗证）。本文件只提供 /api/training/plans* 与
//   /api/training/records* 等**新增**子路径，二者互不冲突。
//
// 注意：静态段（export / preview / by-user）必须注册在可能冲突的 :id 之前。
// 写操作统一 requirePermission('train:manage')；读操作登录即可。
//
// 【读操作"登录即可"是用户拍板的有意设计，勿擅自加权限】
//   用户口径（2026-10-12）：「培训记录查询不需要权限校验」。
//   因此 /api/training/records、/api/training/records/by-user/:userId、
//   /api/training/records/export 三个读接口**保持无 requirePermission**，
//   任何登录用户均可查询任意员工的培训记录 —— 这是刻意的，收口会破坏
//   「按员工信息能查询到员工的培训记录」这一原始需求。
//   写操作（建/改/删计划、导入成员、生成/改/删记录）仍受 train:manage 保护。
// ============================================================
import { authenticate, ok, wrap, requirePermission } from '../middleware/index.js';
import { toId, toInt } from '../utils/params.js';
import * as svc from '../services/training-plan-service.js';

/**
 * 解析「id 列表」入参（query 的逗号串 或 body 数组）→ 正安全整数数组（去重、忽略非法项）。
 * 例：'8,9,10' / [8, '9', 'x'] → [8, 9]。
 * @param {string|Array<*>|undefined} v
 * @returns {number[]}
 */
function parseIdList(v) {
  const raw = Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]);
  const out = [];
  for (const item of raw) {
    if (item === undefined || item === null) continue;
    const s = String(item).trim();
    if (!s) continue;
    const n = toId(s);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

export default async function trainingRoutes(app) {
  app.addHook('preHandler', authenticate);

  /* ---------------- 员工预览（按岗位 / 按工段，不落库） ---------------- */
  // 工段=部门：departmentIds=1,2,3 走多部门分支；否则维持既有 positionCode 通路（不回归）
  app.get('/api/training/members/preview', wrap(async (req, reply) => {
    const { positionCode, departmentIds } = req.query || {};
    const deptIds = parseIdList(typeof departmentIds === 'string' ? departmentIds.split(',') : departmentIds);
    if (deptIds.length) {
      return ok(reply, await svc.previewMembersByDepartments(deptIds));
    }
    return ok(reply, await svc.previewMembersByPosition({ positionCode }));
  }));

  /* ---------------- 培训计划 ---------------- */
  app.get('/api/training/plans', wrap(async (req, reply) => {
    const { trainingType, positionCode, keyword, status, page, size } = req.query || {};
    return ok(reply, await svc.listPlans({
      trainingType, positionCode, keyword, status,
      page: toInt(page, { def: 1, min: 1 }) ?? 1,
      size: toInt(size, { def: 20, min: 1, max: 200 }) ?? 20,
    }));
  }));

  // 计划明细导出（静态路径，须在 /plans/:id 之前）
  app.get('/api/training/plans/:id/export', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.planExport(id));
  }));

  app.get('/api/training/plans/:id', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const plan = await svc.getPlan(id);
    if (!plan) return reply.code(404).send({ code: 1, msg: '培训计划不存在' });
    return ok(reply, plan);
  }));

  app.post('/api/training/plans', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const r = await svc.createPlan(req.body || {}, req.user.id);
    return ok(reply, r, '培训计划已创建');
  }));

  app.put('/api/training/plans/:id', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await svc.updatePlan(id, req.body || {});
    return ok(reply, r, '培训计划已更新');
  }));

  app.delete('/api/training/plans/:id', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await svc.deletePlan(id);
    return ok(reply, r, '培训计划已删除');
  }));

  /* ---------------- 计划适用员工 ---------------- */

  // 计划名单（含每人已生成的记录数）
  app.get('/api/training/plans/:id/members', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const plan = await svc.getPlan(id);
    if (!plan) return reply.code(404).send({ code: 1, msg: '培训计划不存在' });
    return ok(reply, plan.members || []);
  }));

  // 按岗位 / 工段(部门) / 员工列表批量导入（优先级：userIds > departmentIds > positionCode）
  app.post('/api/training/plans/:id/members/import', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const { positionCode, userIds, departmentIds } = req.body || {};
    const r = await svc.importMembers(id, {
      positionCode,
      userIds,
      departmentIds: parseIdList(departmentIds),
    });
    return ok(reply, r, `导入完成：新增 ${r.added}，跳过 ${r.skipped}`);
  }));

  // 从名单移除员工
  app.post('/api/training/plans/:id/members/remove', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const { userIds } = req.body || {};
    const r = await svc.removeMembers(id, userIds);
    return ok(reply, r, `已移除 ${r.removed} 名员工`);
  }));

  // 按 成员 × 明细 批量生成空记录
  app.post('/api/training/plans/:id/records/generate', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const { userIds } = req.body || {};
    const r = await svc.generateRecords(id, { userIds });
    return ok(reply, r, `已生成 ${r.created} 条培训记录（跳过 ${r.skipped} 条已存在）`);
  }));

  /* ---------------- 培训记录 ---------------- */

  // 记录导出（静态路径，须在潜在 :id 之前）
  app.get('/api/training/records/export', wrap(async (req, reply) => {
    const { userId, planId, trainingType, positionCode, keyword, from, to } = req.query || {};
    return ok(reply, await svc.recordsExport({
      userId: toId(userId) || null,
      planId: toId(planId) || null,
      trainingType, positionCode, keyword, from, to,
    }));
  }));

  // 按员工查询全部培训记录（核心需求）
  app.get('/api/training/records/by-user/:userId', wrap(async (req, reply) => {
    const userId = toId(req.params.userId);
    if (!userId) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const { trainingType, from, to, page, size } = req.query || {};
    return ok(reply, await svc.listRecordsByUser(userId, {
      trainingType, from, to,
      page: toInt(page, { def: 1, min: 1 }) ?? 1,
      size: toInt(size, { def: 100, min: 1, max: 500 }) ?? 100,
    }));
  }));

  app.get('/api/training/records', wrap(async (req, reply) => {
    const { userId, planId, trainingType, positionCode, keyword, from, to, page, size } = req.query || {};
    return ok(reply, await svc.listRecords({
      userId: toId(userId) || null,
      planId: toId(planId) || null,
      trainingType, positionCode, keyword, from, to,
      page: toInt(page, { def: 1, min: 1 }) ?? 1,
      size: toInt(size, { def: 20, min: 1, max: 500 }) ?? 20,
    }));
  }));

  // 批量录入 / 更新
  app.post('/api/training/records/batch', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const records = req.body?.records || [];
    const r = await svc.saveRecordsBatch(records, req.user.id);
    return ok(reply, r, `已保存 ${r.updated} 条${r.failed.length ? `，失败 ${r.failed.length} 条` : ''}`);
  }));

  app.put('/api/training/records/:id', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await svc.updateRecord(id, req.body || {}, req.user.id);
    return ok(reply, r, '培训记录已更新');
  }));

  app.delete('/api/training/records/:id', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await svc.deleteRecord(id);
    return ok(reply, r, '培训记录已删除');
  }));
}
