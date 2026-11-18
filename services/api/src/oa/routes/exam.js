// ============================================================
// 考试路由（在线考试 / 题库 / 答卷）
// ------------------------------------------------------------
// 权限口径：
//   · 管理端（建考试、题库、发布、成绩单）= train:manage
//   · 考生端（我的考试、开始/交卷/重考）= 登录即可，且只能操作自己的答卷
// 静态段（my / attempts / publish）必须注册在 :id 之前。
// ============================================================
import { authenticate, ok, wrap, requirePermission } from '../middleware/index.js';
import { toId, toInt } from '../utils/params.js';
import * as svc from '../services/exam-service.js';

export default async function examRoutes(app) {
  app.addHook('preHandler', authenticate);

  /* ---------------- 管理端：考试定义 ---------------- */
  app.get('/api/exams', wrap(async (req, reply) => {
    const { planId, status, keyword, page, size } = req.query || {};
    return ok(reply, await svc.listExams({
      planId: toId(planId) || null, status: status || null, keyword,
      page: toInt(page, { def: 1, min: 1 }) ?? 1,
      size: toInt(size, { def: 20, min: 1, max: 200 }) ?? 20,
    }));
  }));

  app.post('/api/exams', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    return ok(reply, await svc.createExam(req.body || {}, req.user.id), '考试已创建');
  }));

  /* ---------------- 考生端（静态段在前） ---------------- */
  app.get('/api/exams/my', wrap(async (req, reply) => {
    return ok(reply, await svc.listMyExams(req.user.id));
  }));

  app.get('/api/exams/attempts/:attemptId', wrap(async (req, reply) => {
    const id = toId(req.params.attemptId);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.getAttempt(id, req.user.id));
  }));

  app.post('/api/exams/attempts/:attemptId/submit', wrap(async (req, reply) => {
    const id = toId(req.params.attemptId);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.submitAttempt(id, req.user.id, req.body?.answers || {}), '已交卷');
  }));

  app.post('/api/exams/attempts/:attemptId/retake', wrap(async (req, reply) => {
    const id = toId(req.params.attemptId);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.retake(id, req.user.id), '已开始新一轮考试');
  }));

  /* ---------------- 管理端：单场考试 ---------------- */
  app.get('/api/exams/:id/attempts', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.listAttempts(id));
  }));

  app.post('/api/exams/:id/publish', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.publishExam(id), '考试已发布并已通知参训员工');
  }));

  app.post('/api/exams/:id/close', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.closeExam(id), '考试已结束');
  }));

  app.get('/api/exams/:id', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.getExam(id));
  }));

  app.put('/api/exams/:id', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.updateExam(id, req.body || {}), '考试已更新');
  }));

  app.delete('/api/exams/:id', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.deleteExam(id), '考试已删除');
  }));

  /* ---------------- 管理端：题库 ---------------- */
  app.get('/api/exams/:id/questions', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.listQuestions(id));
  }));

  app.post('/api/exams/:id/questions', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.saveQuestion(id, req.body || {}), '题目已保存');
  }));

  app.post('/api/exams/:id/questions/import', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.importQuestions(id, req.body?.questions || []), '导入完成');
  }));

  app.put('/api/exams/:id/questions/:qid', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    const qid = toId(req.params.qid);
    if (!id || !qid) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.saveQuestion(id, req.body || {}, qid), '题目已保存');
  }));

  app.delete('/api/exams/:id/questions/:qid', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    const qid = toId(req.params.qid);
    if (!id || !qid) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await svc.deleteQuestion(qid, id), '题目已删除');
  }));
}
