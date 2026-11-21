// ============================================================
// oa-iqc —— 品质管理 → IQC 检验（P1：OA 接管检验执行）
//
// 两类调用方：
//   1) WMS（X-Api-Key，服务身份）：推送待检批次
//   2) OA 用户（登录态）：列表 / 认领 / 录入 / 提交 / 回填
//
// 权限：读用 org:manage 同级的 ipqc:manage（品质人员本来就有）；
//   写（认领/提交/回填）同样走 ipqc:manage —— P1 暂不新增权限码，避免角色重配。
// ============================================================
import { authenticate, ok, requirePermission, wrap } from '../middleware/index.js';
import {
  receiveLot, listLots, getLot, getSheet, claimLot, releaseLot,
  saveRecord, submitRecord, approveBackfill, releaseStaleClaims, statsIqc,
  getReport, retryPendingBackfill, listIqcTemplates,
} from '../services/oa-iqc-service.js';
import { runReconcile } from '../services/iqc-reconcile-service.js';
import { pullPendingLots } from '../services/wms-iqc-pull.js';

function toId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function oaIqcRoutes(app) {
  app.addHook('preHandler', authenticate);

  /* ---------- 入站：WMS 推送待检批次（服务身份） ---------- */
  app.post('/api/integration/iqc/lots', wrap(async (req, reply) => {
    if (!req.user?.isApi && !req.user?.isAdmin) {
      return reply.code(403).send({ code: 1, msg: '仅服务身份可调用' });
    }
    const r = await receiveLot(req.body || {}, { source: 'wms' });
    return ok(reply, r, r.status === 'duplicated' ? '重复推送，已忽略' : '已接收');
  }));

  /* ---------- 手动从 WMS 拉取待检批次（页面空着时点一下，不用等 5 分钟定时） ---------- */
  app.post('/api/iqc/lots/sync-wms', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const r = await pullPendingLots({ actor: req.user?.username || req.user?.realName || null });
    if (r.skipped) return ok(reply, r, r.reason || '未配置 WMS 账号');
    const msg = `拉取 ${r.fetched} 条，新增 ${r.inserted}，刷新 ${r.updated}`
      + (r.errors?.length ? `，${r.errors.length} 条失败` : '');
    return ok(reply, r, msg);
  }));

  /* ---------- 待检列表 ---------- */
  app.get('/api/iqc/lots', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    return ok(reply, await listLots(req.query || {}));
  }));

  app.get('/api/iqc/lots/:id', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await getLot(id));
  }));

  /* ---------- 认领 / 释放 ---------- */
  app.post('/api/iqc/lots/:id/claim', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await claimLot(id, req.user), '已认领该批次');
  }));

  app.post('/api/iqc/lots/:id/release', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await releaseLot(id, req.user), '已释放');
  }));

  /* ---------- 可选模板清单（现场选/换模板用） ---------- */
  app.get('/api/iqc/templates', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    return ok(reply, await listIqcTemplates());
  }));

  /* ---------- 打开检验单（模板 + 项目清单 + 服务端抽样推定 + 已有记录） ----------
     ?templateId= 表示检验员现场选定/更换模板：选定即记为该物料的绑定模板（下次自动命中）。 */
  app.get('/api/iqc/lots/:id/sheet', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const templateId = toId(req.query?.templateId);
    return ok(reply, await getSheet(id, { templateId }));
  }));

  /* ---------- 检验记录（草稿 / 提交） ---------- */
  app.post('/api/iqc/lots/:id/record', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await saveRecord(id, req.body || {}, req.user), '已保存');
  }));

  // 语义化别名（前端按「批次 → 记录」路径调用；与上面完全等价）
  app.post('/api/iqc/lots/:id/record/save', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await saveRecord(id, req.body || {}, req.user), '已保存草稿');
  }));

  app.post('/api/iqc/records/:id/submit', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await submitRecord(id, req.user);
    const msg = r.approvalError
      ? `已推送 WMS，但自动发起审批失败：${r.approvalError}（可用「审批回填」兜底）`
      : '已提交，已发起审批';
    return ok(reply, r, msg);
  }));

  /* ---------- 统计报表 ---------- */
  app.get('/api/iqc/stats', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    return ok(reply, await statsIqc(req.query || {}));
  }));

  /* ---------- 报告（打印/PDF 数据源，含快照与签核） ---------- */
  app.get('/api/iqc/records/:id/report', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await getReport(id));
  }));

  /* ---------- 落账补偿（手工触发；定时任务见 iqc-jobs） ---------- */
  app.post('/api/iqc/jobs/retry-backfill', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    return ok(reply, await retryPendingBackfill(), '已重试落账');
  }));

  /* ---------- WMS 历史入口（历史不迁，给个跳转） ---------- */
  app.get('/api/iqc/wms-link', wrap(async (req, reply) => {
    const url = String(process.env.WMS_PUBLIC_URL || '').replace(/\/+$/, '');
    return ok(reply, { url: url ? url + '/iqc' : null });
  }));

  /* ---------- 对账 / 后台任务手动触发 ---------- */
  app.get('/api/iqc/reconcile', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    return ok(reply, await runReconcile(req.query || {}));
  }));

  app.post('/api/iqc/jobs/release-stale', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    return ok(reply, await releaseStaleClaims(), '已回收超时认领');
  }));

  /* ---------- 审批通过 → 回填 WMS 落账 ---------- */
  app.post('/api/iqc/records/:id/approve', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await approveBackfill(id, req.user);
    return ok(reply, r, r.alreadySynced ? '此前已回填' : '已回填 WMS 并完成落账');
  }));
}
