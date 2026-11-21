// ============================================================
// oa-mrb —— MRB 评审（P2）
//   · /api/integration/mrb      服务身份：接收 WMS 推送的 MRB
//   · /api/mrb/*                登录用户：列表 / 详情 / 审批回填
// ============================================================
import { authenticate, ok, requirePermission, wrap } from '../middleware/index.js';
import { receiveMrb, listMrbs, getMrb, decide, reject, resubmitMrb } from '../services/oa-mrb-service.js';

function toId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function oaMrbRoutes(app) {
  app.addHook('preHandler', authenticate);

  app.post('/api/integration/mrb', wrap(async (req, reply) => {
    if (!req.user?.isApi && !req.user?.isAdmin) {
      return reply.code(403).send({ code: 1, msg: '仅服务身份可调用' });
    }
    const r = await receiveMrb(req.body || {});
    return ok(reply, r, r.status === 'duplicated' ? '重复推送，已忽略' : '已接收');
  }));

  app.get('/api/mrb/list', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    return ok(reply, await listMrbs(req.query || {}));
  }));

  app.get('/api/mrb/:id', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await getMrb(id));
  }));

  app.post('/api/mrb/:id/decision', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await decide(id, req.body || {}, req.user);
    return ok(reply, r, r.alreadyDecided ? '此前已回填' : '已回填 WMS');
  }));

  app.post('/api/mrb/:id/resubmit', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await resubmitMrb(id, req.user), '已重新提交评审');
  }));

  app.post('/api/mrb/:id/reject', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await reject(id, req.body || {}, req.user);
    return ok(reply, r, r.alreadyDecided ? '此前已回填' : '已否决并回填 WMS');
  }));
}
