// ============================================================
// 设备盘点路由（设备管理卡 V1.0 · API-S0~S10）
// ------------------------------------------------------------
// 鉴权：全部登录；写操作与 PC 查看加 equip:manage；移动端核对/列表仅登录（不新增权限码）。
// 注意：静态段 scope-preview / mobile-tasks 必须注册在 /:id 之前，否则被参数路由吞掉。
// 无「发布」端点——发布由发布审批通过的终态钩子自动完成（避免绕过审批）。
// ============================================================
import { authenticate, ok, wrap, requirePermission } from '../middleware/index.js';
import { toId } from '../utils/params.js';
import * as st from '../services/equipment-stocktake.js';

const canManage = requirePermission('equip:manage');

export default async function stocktakeRoutes(app) {
  app.addHook('preHandler', authenticate);

  /* ---- 静态段（必须在 /:id 之前） ---- */
  // API-S0 范围 → 预计设备数（新建联动）
  app.get('/api/equipment/stocktakes/scope-preview', { preHandler: canManage }, wrap(async (req, reply) => {
    return ok(reply, await st.scopePreview(req.query || {}));
  }));

  // API-S9 移动端任务列表（仅 ongoing/closing）
  app.get('/api/equipment/stocktakes/mobile-tasks', wrap(async (req, reply) => {
    return ok(reply, await st.listMobileTasks());
  }));

  // API-S1 创建（草稿 / 直接提交审批）
  app.post('/api/equipment/stocktakes', { preHandler: canManage }, wrap(async (req, reply) => {
    const b = req.body || {};
    const r = await st.createStocktake({ ...b, userId: req.user.id });
    return ok(reply, r, b.submitNow ? '已提交审批，等待总经理审批' : '已保存草稿');
  }));

  // API-S11 编辑（仅 draft/rejected；保存后回 draft）
  app.put('/api/equipment/stocktakes/:id', { preHandler: canManage }, wrap(async (req, reply) => {
    const r = await st.updateStocktake(toId(req.params.id), req.body || {});
    return ok(reply, r, '已保存');
  }));

  // API-S12 删除（仅 draft）
  app.delete('/api/equipment/stocktakes/:id', { preHandler: canManage }, wrap(async (req, reply) => {
    const r = await st.deleteStocktake(toId(req.params.id));
    return ok(reply, r, '已删除');
  }));

  // API-S2 PC 列表（关键词/状态/分页）
  app.get('/api/equipment/stocktakes', { preHandler: canManage }, wrap(async (req, reply) => {
    return ok(reply, await st.listStocktakes(req.query || {}));
  }));

  // API-S10 报告数据（供前端 xlsx 导出）
  app.get('/api/equipment/stocktakes/:id/report', { preHandler: canManage }, wrap(async (req, reply) => {
    const r = await st.getStocktakeReport(toId(req.params.id));
    if (!r) return reply.code(404).send({ code: 1, msg: '盘点任务不存在' });
    return ok(reply, r);
  }));

  // API-S3 详情（进度 + 三类差异 + 核对明细 + 审批时间线）
  app.get('/api/equipment/stocktakes/:id', { preHandler: canManage }, wrap(async (req, reply) => {
    const r = await st.getStocktakeDetail(toId(req.params.id));
    if (!r) return reply.code(404).send({ code: 1, msg: '盘点任务不存在' });
    return ok(reply, r);
  }));

  // API-S4 提交发布审批（draft/rejected → pending）
  app.post('/api/equipment/stocktakes/:id/submit', { preHandler: canManage }, wrap(async (req, reply) => {
    const r = await st.submitPublish(toId(req.params.id), req.user.id);
    return ok(reply, r, '已提交审批，等待总经理审批');
  }));

  // API-S5 撤回发布申请（pending → draft）
  app.post('/api/equipment/stocktakes/:id/withdraw', { preHandler: canManage }, wrap(async (req, reply) => {
    const r = await st.withdrawPublish(toId(req.params.id), req.user.id);
    return ok(reply, r, '已撤回');
  }));

  // API-S6 提交结束审批（ongoing → closing）
  app.post('/api/equipment/stocktakes/:id/submit-finish', { preHandler: canManage }, wrap(async (req, reply) => {
    const r = await st.submitFinish(toId(req.params.id), req.user.id);
    return ok(reply, r, '已提交结束审批');
  }));

  // API-S7 撤回结束申请（closing → ongoing）
  app.post('/api/equipment/stocktakes/:id/withdraw-finish', { preHandler: canManage }, wrap(async (req, reply) => {
    const r = await st.withdrawFinish(toId(req.params.id), req.user.id);
    return ok(reply, r, '已撤回结束申请');
  }));

  // API-S8 扫码核对（幂等；仅登录）
  app.post('/api/equipment/stocktakes/:id/check', wrap(async (req, reply) => {
    const r = await st.checkEquipment({ stocktakeId: toId(req.params.id), code: req.body?.code, userId: req.user.id });
    return ok(reply, r);
  }));
}
