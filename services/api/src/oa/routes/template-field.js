// ============================================================
// 模板自定义字段 —— 路由（第 38 轮）
// 挂载：server/src/routes/index.js
// 权限：template:field（admin / quality）
// ============================================================
import { authenticate, ok, wrap, requirePermission } from '../middleware/index.js';
import { toId } from '../utils/params.js';
import * as ff from '../services/frequency-field-service.js';

export default async function templateFieldRoutes(app) {
  app.addHook('preHandler', authenticate);

  // 列出字段定义（支持 ?scope=inspect|ipqc|fai & ?active=true）
  app.get('/api/template-fields', wrap(async (req, reply) => {
    const { scope, active } = req.query || {};
    return ok(reply, await ff.listTemplateFields({ scope, active }));
  }));

  // 列出某 scope 的内置字段配置（第 39 轮；含停用，供模板编辑器按配置渲染）
  app.get('/api/template-fields/builtin/:scope', wrap(async (req, reply) => {
    return ok(reply, await ff.listBuiltinFields(req.params.scope));
  }));

  // 新增字段定义
  app.post('/api/template-fields', { preHandler: requirePermission('template:field') }, wrap(async (req, reply) => {
    return ok(reply, await ff.createTemplateField(req.body || {}), '已新增');
  }));

  // 更新字段定义
  app.put('/api/template-fields/:id', { preHandler: requirePermission('template:field') }, wrap(async (req, reply) => {
    return ok(reply, await ff.updateTemplateField(toId(req.params.id), req.body || {}), '已保存');
  }));

  // 删除字段定义（?force=true 强制级联清值）
  app.delete('/api/template-fields/:id', { preHandler: requirePermission('template:field') }, wrap(async (req, reply) => {
    const force = String(req.query?.force || '') === 'true';
    return ok(reply, await ff.deleteTemplateField(toId(req.params.id), { force }), '已删除');
  }));

  // 读取某模板的自定义字段值（含未填占位）
  app.get('/api/template-fields/values/:scope/:templateId', wrap(async (req, reply) => {
    const { scope, templateId } = req.params;
    return ok(reply, await ff.getTemplateFieldValues(scope, toId(templateId)));
  }));
}
