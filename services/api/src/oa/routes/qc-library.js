// ============================================================
// qc-library —— 品质管理 → IQC / OQC 检验模板库
//
// 路由层只做三件事：参数解析、权限、调 service 后套 ok() 信封。
// 所有 SQL 与业务校验都在 qc-library-service.js，别往这里搬。
//
// 权限沿用现有权限码 ipqc:manage（品质人员已有），不新增权限码，
// 避免上线还要重配角色。
// ============================================================
import { authenticate, ok, requirePermission, wrap } from '../middleware/index.js';
import {
  listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, duplicateTemplate,
  listTemplateItems, replaceTemplateItems, importSection,
  listStandardItems,
  saveAllStandardItems, createStandardItem, updateStandardItem, deleteStandardItem, bulkUpsertStandardItems,
  listTemplateMaterials, addTemplateMaterials, removeTemplateMaterial, listTemplatesByMaterial,
} from '../services/qc-library-service.js';

const write = { preHandler: requirePermission('ipqc:manage') };

function toId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function qcLibraryRoutes(app) {
  app.addHook('preHandler', authenticate);

  /* ---------------- 模板 ---------------- */
  app.get('/api/qc/templates', wrap(async (req, reply) =>
    ok(reply, await listTemplates(req.query || {}))));

  app.get('/api/qc/templates/:id', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await getTemplate(id));
  }));

  app.post('/api/qc/templates', write, wrap(async (req, reply) =>
    ok(reply, await createTemplate(req.body || {}, req.user), '模板已创建')));

  app.put('/api/qc/templates/:id', write, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await updateTemplate(id, req.body || {}, req.user), '模板已保存');
  }));

  app.delete('/api/qc/templates/:id', write, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await deleteTemplate(id), '模板已删除');
  }));

  app.post('/api/qc/templates/:id/duplicate', write, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await duplicateTemplate(id, req.body || {}, req.user), '模板已复制');
  }));

  /* ---------------- 检验项 ---------------- */
  app.get('/api/qc/templates/:id/items', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await listTemplateItems(id));
  }));

  app.put('/api/qc/templates/:id/items', write, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const items = (req.body || {}).items;
    return ok(reply, await replaceTemplateItems(id, items, req.user), '检验项已保存');
  }));

  app.post('/api/qc/templates/:id/import-section', write, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await importSection(id, (req.body || {}).sectionType, req.user);
    return ok(reply, r, `已导入 ${r.count} 条`);
  }));

  /* ---------------- 标准项目库 ---------------- */
  app.get('/api/qc/standard-items', wrap(async (req, reply) =>
    ok(reply, await listStandardItems(req.query || {}))));

  // 整页保存（WMS「IQC 标准库管理」的顶部保存按钮走这里）：一次提交全部段，事务内落库
  app.post('/api/qc/standard-items/save-all', write, wrap(async (req, reply) => {
    const r = await saveAllStandardItems((req.body || {}).items, req.user);
    const parts = [`新增 ${r.inserted} 条`, `更新 ${r.updated} 条`];
    if (r.skipped) parts.push(`跳过 ${r.skipped} 条空行`);
    return ok(reply, r, `已保存：${parts.join('，')}`);
  }));

  app.post('/api/qc/standard-items/bulk', write, wrap(async (req, reply) => {
    const r = await bulkUpsertStandardItems((req.body || {}).items, req.user);
    return ok(reply, r, `新增 ${r.inserted} 条，更新 ${r.updated} 条`);
  }));

  app.post('/api/qc/standard-items', write, wrap(async (req, reply) =>
    ok(reply, await createStandardItem(req.body || {}, req.user), '标准项目已创建')));

  app.put('/api/qc/standard-items/:id', write, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await updateStandardItem(id, req.body || {}, req.user), '标准项目已保存');
  }));

  app.delete('/api/qc/standard-items/:id', write, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await deleteStandardItem(id), '标准项目已删除');
  }));

  /* ---------------- 物料绑定 ---------------- */
  app.get('/api/qc/templates/:id/materials', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await listTemplateMaterials(id));
  }));

  app.post('/api/qc/templates/:id/materials', write, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await addTemplateMaterials(id, (req.body || {}).materialCodes, req.user);
    return ok(reply, r, `新增 ${r.added} 个，跳过 ${r.skipped} 个`);
  }));

  app.delete('/api/qc/templates/:id/materials/:materialCode', write, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await removeTemplateMaterial(id, req.params.materialCode), '已解绑');
  }));

  // 物料反查模板：检验单打开时按物料选模板
  app.get('/api/qc/materials/:code/templates', wrap(async (req, reply) =>
    ok(reply, await listTemplatesByMaterial(req.params.code, req.query || {}))));
}
