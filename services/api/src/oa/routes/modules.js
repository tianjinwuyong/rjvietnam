import { authenticate, ok, wrap, requirePermission } from '../middleware/index.js';
import { toId } from '../utils/params.js';
import { one, many } from '../db/index.js';
import * as mod from '../services/modules-service.js';
import * as calendar from '../services/calendar-service.js';
import * as ann from '../services/announcement-service.js';
import * as ipqc from '../services/ipqc-service.js';
import * as docSvc from '../services/doc-service.js';

/** 暂存文件转正 + 落 attachment（biz_type 区分的唯一出栈路径，参照 routes/doc.js 先例） */
async function attachStaged(req, { bizType, bizId, subDir, fileName, filePath, fileSize, mimeType }) {
  if (!filePath) throw new Error('缺少文件信息');
  const finalPath = docSvc.finalizeStagedFile({ filePath, subDir, fileName });
  return one(
    `INSERT INTO attachment (biz_type, biz_id, file_name, file_path, file_size, mime_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [bizType, bizId, fileName || finalPath, finalPath, fileSize || 0, mimeType || null, req.user.id]
  );
}

export default async function modulesRoutes(app) {
  app.addHook('preHandler', authenticate);

  /* ---- 知识共享 ---- */
  app.get('/api/knowledge', wrap(async (req, reply) => {
    return ok(reply, await mod.listKnowledge({ ...(req.query || {}), userId: req.user.id }));
  }));

  app.post('/api/knowledge', { preHandler: requirePermission('knowledge:manage') }, wrap(async (req, reply) => {
    const { title, category, description, filePath, fileSize } = req.body || {};
    if (!title || !filePath) return reply.code(400).send({ code: 1, msg: '请填写标题并上传文件' });
    const r = await mod.createKnowledge({ title, category, description, filePath, fileSize, uploaderId: req.user.id });
    return ok(reply, r, '已上传，待部门负责人审核');
  }));

  app.post('/api/knowledge/:id/approve', wrap(async (req, reply) => {
    const { action } = req.body || {};
    const r = await mod.approveKnowledge(toId(req.params.id), req.user.id, action);
    return ok(reply, r, action === 'approve' ? '已开放' : '已驳回');
  }));

  app.post('/api/knowledge/:id/view', wrap(async (req, reply) => {
    await mod.viewKnowledge(toId(req.params.id));
    return ok(reply, null, '');
  }));

  // 下载计数：前端点击「下载」时调用，返回 filePath 交前端直出
  app.post('/api/knowledge/:id/download', wrap(async (req, reply) => {
    const r = await mod.downloadKnowledge(toId(req.params.id));
    return ok(reply, r, '');
  }));

  // 上传新版本：基于现有（已开放且为当前版本）文档建 version+1 新记录，走审批
  app.post('/api/knowledge/:id/version', { preHandler: requirePermission('knowledge:manage') }, wrap(async (req, reply) => {
    const { title, category, description, filePath, fileSize } = req.body || {};
    if (!filePath) return reply.code(400).send({ code: 1, msg: '请上传新版本文件' });
    const r = await mod.createKnowledgeVersion(toId(req.params.id), {
      title, category, description, filePath, fileSize, uploaderId: req.user.id,
    });
    return ok(reply, r, '新版本已提交，待部门负责人审核');
  }));

  // 版本链历史（只读列表，含可下载的旧版本）
  app.get('/api/knowledge/:id/versions', wrap(async (req, reply) => {
    return ok(reply, await mod.listKnowledgeVersions(toId(req.params.id)));
  }));

  /* ---- 培训 ---- */
  app.get('/api/training', wrap(async (req, reply) => ok(reply, await mod.listTraining())));

  app.post('/api/training', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const r = await mod.createTraining(req.body || {});
    return ok(reply, r, '培训已创建');
  }));

  app.get('/api/questions', wrap(async (req, reply) => ok(reply, await mod.listQuestions(req.query?.category))));

  app.post('/api/questions/import', { preHandler: requirePermission('train:manage') }, wrap(async (req, reply) => {
    const n = await mod.importQuestions(req.body?.items || []);
    return ok(reply, { count: n }, `导入 ${n} 题`);
  }));

  app.post('/api/exam/submit', wrap(async (req, reply) => {
    const { trainingId, score, passed } = req.body || {};
    const r = await mod.recordExam({ trainingId: Number(trainingId), userId: req.user.id, score, passed });
    return ok(reply, r, passed ? '考试通过，上岗证已更新' : '已记录成绩');
  }));

  app.get('/api/certificates', wrap(async (req, reply) => ok(reply, await mod.listCertificates())));

  /* ---- 设备 ---- */
  app.get('/api/equipment', wrap(async (req, reply) => ok(reply, await mod.listEquipment(req.query || {}))));

  // 按资产编号（code）取设备详情——二维码扫码跳转落点。
  // 静态段 by-code 必须注册在 /api/equipment/:id 之前，避免被参数路由吞掉。
  app.get('/api/equipment/by-code/:code', wrap(async (req, reply) => {
    const code = req.params.code;
    const r = await mod.getEquipmentByCode(code, req.user.id).catch(err => {
      // 资产编号为空时 service 抛错，转为友好 400
      if (String(err.message).includes('资产编号必填')) return null;
      throw err;
    });
    if (!r) return reply.code(404).send({ code: 1, msg: `未找到资产编号为「${code}」的设备` });
    return ok(reply, r);
  }));

  // 导入模板列定义（静态路径，须放在 /:id 之前）
  app.get('/api/equipment/template', wrap(async (req, reply) => ok(reply, mod.equipmentImportTemplate())));

  // 批量导入（静态路径，须放在 /:id 之前）
  app.post('/api/equipment/import', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const rows = req.body?.rows || req.body?.items || [];
    const r = await mod.importEquipment(rows, req.user.id);
    return ok(reply, r, `导入完成：新增 ${r.inserted}，更新 ${r.updated}，失败 ${r.failed}`);
  }));

  app.post('/api/equipment', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const r = await mod.createEquipment(req.body || {});
    return ok(reply, r, '设备已添加');
  }));

  app.put('/api/equipment/:id', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const r = await mod.updateEquipment(toId(req.params.id), { ...(req.body || {}), operatorId: req.user.id });
    return ok(reply, r, '设备已更新');
  }));

  app.delete('/api/equipment/:id', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const r = await mod.deleteEquipment(toId(req.params.id));
    return ok(reply, r, '设备已删除');
  }));

  // 设备履历时间线（S3 补：读 equipment_history；路径为 :id 子路径，不会被 /:id 吞掉）
  app.get('/api/equipment/:id/history', wrap(async (req, reply) => {
    return ok(reply, await mod.listEquipmentHistory(toId(req.params.id), req.query || {}));
  }));

  // 停用/报废设备扫码留痕（P-402）：移动点检员口径，仅登录即可，不需 equip:manage
  app.post('/api/equipment/:id/scan-log', wrap(async (req, reply) => {
    return ok(reply, await mod.logEquipmentScan(toId(req.params.id), req.user.id, { scene: req.body?.scene }));
  }));

  /* ---- 校准计划/证书（S3-T03） ---- */
  app.get('/api/equipment/calibrations', wrap(async (req, reply) => {
    return ok(reply, await mod.listCalibrations(req.query || {}));
  }));

  app.post('/api/equipment/calibrations', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const r = await mod.createCalibration({ ...(req.body || {}), operatorId: req.user.id });
    return ok(reply, r, '校准计划已创建');
  }));

  app.put('/api/equipment/calibrations/:id', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const r = await mod.updateCalibration(toId(req.params.id), { ...(req.body || {}), operatorId: req.user.id });
    return ok(reply, r, '校准记录已更新');
  }));

  app.delete('/api/equipment/calibrations/:id', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const r = await mod.deleteCalibration(toId(req.params.id));
    return ok(reply, r, '校准记录已删除');
  }));

  // 外校分级预警发送日志（S3 补：读 equipment_alert_log）
  // 静态路径 /api/equipment/alerts 必须在 /api/equipment/:id 之前注册
  app.get('/api/equipment/alerts', wrap(async (req, reply) => {
    return ok(reply, await mod.listEquipmentAlerts(req.query || {}));
  }));

  // 手工触发外校分级预警扫描
  app.post('/api/equipment/alerts/scan', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const { scanCalibrationAlerts } = await import('../services/equipment-alert.js');
    const n = await scanCalibrationAlerts();
    return ok(reply, { count: n }, `外校预警扫描完成：处理 ${n} 条`);
  }));

  /* ---- 点检模板 / 记录 / 报表（S3-T04，静态段须在 /:id 之前） ---- */
  app.get('/api/equipment/inspect/templates', wrap(async (req, reply) => {
    return ok(reply, await mod.listInspectTemplates(req.query || {}));
  }));

  app.get('/api/equipment/inspect/templates/:id', wrap(async (req, reply) => {
    return ok(reply, await mod.getInspectTemplate(toId(req.params.id)));
  }));

  app.post('/api/equipment/inspect/templates', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const body = { ...(req.body || {}) };
    // 原 Excel 归档：暂存原件转正 → 写 attachment → 存 id 到模板
    if (body.sourceFilePath) {
      const att = await attachStaged(req, {
        bizType: 'equipment_inspect_template', bizId: null, subDir: `equip-inspect-tpl/${Date.now()}`,
        fileName: body.sourceFileName, filePath: body.sourceFilePath,
        fileSize: body.sourceFileSize, mimeType: body.sourceMimeType,
      });
      body.sourceFileId = att.id;
    }
    const r = await mod.createInspectTemplate({ ...body, createdBy: req.user.id });
    // 新建时模板 id 未知：先建后回填附件 biz_id（避免 biz_id=NULL 被清理逻辑误判）
    if (body.sourceFileId && r?.id) {
      await one(`UPDATE attachment SET biz_id = $1 WHERE id = $2`, [r.id, body.sourceFileId]);
    }
    return ok(reply, r, '点检模板已创建');
  }));

  app.put('/api/equipment/inspect/templates/:id', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    const body = { ...(req.body || {}) };
    if (body.sourceFilePath) {
      const att = await attachStaged(req, {
        bizType: 'equipment_inspect_template', bizId: id, subDir: `equip-inspect-tpl/${id}`,
        fileName: body.sourceFileName, filePath: body.sourceFilePath,
        fileSize: body.sourceFileSize, mimeType: body.sourceMimeType,
      });
      body.sourceFileId = att.id;
    }
    const r = await mod.updateInspectTemplate(id, body);
    return ok(reply, r, '点检模板已更新');
  }));

  app.delete('/api/equipment/inspect/templates/:id', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const r = await mod.deleteInspectTemplate(toId(req.params.id));
    return ok(reply, r, '点检模板已删除');
  }));

  /* ---- 点检记录（登录即可，点检员可提报） ---- */
  app.get('/api/equipment/inspect/records', wrap(async (req, reply) => {
    return ok(reply, await mod.listInspectRecords(req.query || {}));
  }));

  app.get('/api/equipment/inspect/records/:id', wrap(async (req, reply) => {
    return ok(reply, await mod.getInspectRecord(toId(req.params.id)));
  }));

  app.post('/api/equipment/inspect/records', wrap(async (req, reply) => {
    const r = await mod.createInspectRecord({ ...(req.body || {}), inspectorId: req.user.id });
    return ok(reply, r, r.status === 'submitted' ? '点检记录已提交' : '草稿已保存');
  }));

  app.put('/api/equipment/inspect/records/:id', wrap(async (req, reply) => {
    const r = await mod.updateInspectRecord(toId(req.params.id), req.user.id, req.body || {}, !!req.user.isAdmin);
    return ok(reply, r, r.status === 'submitted' ? '点检记录已提交' : '草稿已保存');
  }));

  // 人工上报设备维修申请单
  app.post('/api/equipment/inspect/records/:id/report-issue', wrap(async (req, reply) => {
    const r = await mod.reportInspectIssue(toId(req.params.id), req.user.id);
    const msg = r.error ? `上报失败：${r.error}` : (r.already ? '该记录已上报维修单' : '已上报设备维修申请单');
    return ok(reply, r, msg);
  }));

  // 记录内嵌图片（拍照/相册/粘贴）暂存 → 转正
  app.post('/api/equipment/inspect/records/:id/attachments', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    await mod.getInspectRecord(id);   // 记录必须存在
    const att = await attachStaged(req, {
      bizType: 'equipment_inspect_record', bizId: id, subDir: `equip-inspect/${id}`, ...(req.body || {}),
    });
    return ok(reply, att, '附件已关联');
  }));

  // 单条点检任务（填写页「任务 → 直达填写」用）
  app.get('/api/equipment/inspect/tasks/:id', wrap(async (req, reply) => {
    const r = await one(
      `SELECT id, equipment_id, template_id, task_type, plan_date, assignee_id, status, done_at
         FROM equipment_task WHERE id = $1`,
      [toId(req.params.id)]
    );
    if (!r) return reply.code(404).send({ code: 1, msg: '任务不存在' });
    return ok(reply, r);
  }));

  // 设备执行率 / 异常率报表（注意：区别于 /api/stats/* 另一个路由文件）
  app.get('/api/equipment/stats', wrap(async (req, reply) => {
    return ok(reply, await mod.getEquipmentStats(req.query || {}));
  }));

  // 点检专用统计别名（前端记录页按 `${base}/stats` 取数；与 /api/equipment/stats 同一实现）
  app.get('/api/equipment/inspect/stats', wrap(async (req, reply) => {
    return ok(reply, await mod.getEquipmentStats(req.query || {}));
  }));

  // 手工触发点检任务生成
  app.post('/api/equipment/tasks/generate', { preHandler: requirePermission('equip:manage') }, wrap(async (req, reply) => {
    const n = await mod.generateInspectTasks();
    return ok(reply, { count: n }, `点检任务生成完成：新增 ${n} 条`);
  }));

  app.get('/api/equipment/tasks', wrap(async (req, reply) => ok(reply, await mod.listEquipmentTasks(req.query || {}))));

  // 单条任务（点检填写页按 ?taskId= 深链读取；须排在 /tasks/:id/done 之前无冲突，路径不同）
  app.get('/api/equipment/tasks/:id', wrap(async (req, reply) => ok(reply, await mod.getEquipmentTask(toId(req.params.id)))));

  app.post('/api/equipment/tasks/:id/done', wrap(async (req, reply) => {
    await mod.completeEquipmentTask(toId(req.params.id), req.user.id, req.body?.result);
    return ok(reply, null, '已完成');
  }));

  /* 旧 /api/checklists（ipqc_checklist 孤儿链路）已随「巡线/首件改造」下线；
     遗留表与 DROP 脚本见 server/sql/deferred/99_drop_ipqc_fai_legacy.sql（部署后执行）。 */

  /* ============================================================
   * S4 IPQC 巡线 / 首件 FAI —— 「Excel 导入模板 + 富文本填写」模型
   * 注意：静态路径（templates / records / stats / tasks）必须排在 /:id 之前。
   * ============================================================ */

  /* ---- IPQC 巡线模板 ---- */
  app.get('/api/ipqc/templates', wrap(async (req, reply) => ok(reply, await ipqc.listIpqcTemplates(req.query || {}))));

  app.get('/api/ipqc/templates/:id', wrap(async (req, reply) => ok(reply, await ipqc.getIpqcTemplate(toId(req.params.id)))));

  app.post('/api/ipqc/templates', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const body = { ...(req.body || {}) };
    // 原 Excel 归档：把暂存原件转正并写 attachment，再存 id 到模板
    if (body.sourceFilePath) {
      const att = await attachStaged(req, {
        bizType: 'ipqc_template', bizId: null, subDir: `ipqc-tpl/${Date.now()}`,
        fileName: body.sourceFileName, filePath: body.sourceFilePath,
        fileSize: body.sourceFileSize, mimeType: body.sourceMimeType,
      });
      body.sourceFileId = att.id;
    }
    const r = await ipqc.createIpqcTemplate({ ...body, createdBy: req.user.id });
    // G3：新建时模板 id 未知，先建后回填附件的 biz_id（避免 biz_id=NULL 被清理逻辑误判）
    if (body.sourceFileId && r?.id) {
      await one(`UPDATE attachment SET biz_id = $1 WHERE id = $2`, [r.id, body.sourceFileId]);
    }
    return ok(reply, r, '巡线模板已创建');
  }));

  app.put('/api/ipqc/templates/:id', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    const body = { ...(req.body || {}) };
    if (body.sourceFilePath) {
      const att = await attachStaged(req, {
        bizType: 'ipqc_template', bizId: id, subDir: `ipqc-tpl/${id}`,
        fileName: body.sourceFileName, filePath: body.sourceFilePath,
        fileSize: body.sourceFileSize, mimeType: body.sourceMimeType,
      });
      body.sourceFileId = att.id;
    }
    const r = await ipqc.updateIpqcTemplate(id, body);
    return ok(reply, r, '巡线模板已更新');
  }));

  app.delete('/api/ipqc/templates/:id', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    return ok(reply, await ipqc.deleteIpqcTemplate(toId(req.params.id)), '巡线模板已删除');
  }));

  /* ---- IPQC 巡线记录（登录即可，巡线员可提报） ---- */
  app.get('/api/ipqc/records', wrap(async (req, reply) => ok(reply, await ipqc.listIpqcRecords(req.query || {}))));

  app.get('/api/ipqc/records/:id', wrap(async (req, reply) => ok(reply, await ipqc.getIpqcRecord(toId(req.params.id)))));

  app.post('/api/ipqc/records', wrap(async (req, reply) => {
    // 发起人/巡线员一律以登录用户为准（放在展开之后，杜绝 body 覆盖为 null）
    const r = await ipqc.createIpqcRecord({ ...(req.body || {}), checkerId: req.user.id });
    return ok(reply, r, r.status === 'submitted' ? '巡线记录已提交' : '草稿已保存');
  }));

  app.put('/api/ipqc/records/:id', wrap(async (req, reply) => {
    const r = await ipqc.updateIpqcRecord(toId(req.params.id), req.user.id, req.body || {}, !!req.user.isAdmin);
    return ok(reply, r, r.status === 'submitted' ? '巡线记录已提交' : '草稿已保存');
  }));

  // 人工上报品质异常单
  app.post('/api/ipqc/records/:id/report-issue', wrap(async (req, reply) => {
    const r = await ipqc.reportIpqcIssue(toId(req.params.id), req.user.id);
    const msg = r.error ? `上报失败：${r.error}` : (r.already ? '该记录已上报异常单' : '已上报品质异常单');
    return ok(reply, r, msg);
  }));

  // 记录内嵌图片（拍照/相册/粘贴）暂存 → 转正
  app.post('/api/ipqc/records/:id/attachments', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    await ipqc.getIpqcRecord(id);   // 记录必须存在
    const att = await attachStaged(req, {
      bizType: 'ipqc_record', bizId: id, subDir: `ipqc/${id}`, ...(req.body || {}),
    });
    return ok(reply, att, '附件已关联');
  }));

  /* ---- IPQC 统计 / 任务 ---- */
  app.get('/api/ipqc/stats', wrap(async (req, reply) => ok(reply, await ipqc.getIpqcStats(req.query || {}))));

  app.post('/api/ipqc/tasks/generate', { preHandler: requirePermission('ipqc:manage') }, wrap(async (req, reply) => {
    const n = await ipqc.generateIpqcTasks();
    return ok(reply, { count: n }, `巡线任务生成完成：新增 ${n} 条`);
  }));

  // 任务详情（填写页「任务 → 直达填写」用：取任务上的模板/产线，不漏接）
  app.get('/api/ipqc/tasks/:id', wrap(async (req, reply) => {
    const r = await one(
      `SELECT id, template_id, line, shift, plan_date, assignee_id, status, done_at FROM ipqc_task WHERE id = $1`,
      [toId(req.params.id)]
    );
    if (!r) return reply.code(404).send({ code: 1, msg: '任务不存在' });
    return ok(reply, r);
  }));

  /* ---- 首件 FAI 模板 ---- */
  app.get('/api/fai/templates', wrap(async (req, reply) => ok(reply, await ipqc.listFaiTemplates(req.query || {}))));

  // 静态路径须在 /:id 之前；F4：首件统计取首件口径（不再复用巡线的关闭率/TOP）
  app.get('/api/fai/stats', wrap(async (req, reply) => ok(reply, await ipqc.getIpqcStats({ ...(req.query || {}), module: 'fai' }))));

  app.get('/api/fai/templates/:id', wrap(async (req, reply) => ok(reply, await ipqc.getFaiTemplate(toId(req.params.id)))));

  app.post('/api/fai/templates', { preHandler: requirePermission('fai:manage') }, wrap(async (req, reply) => {
    const body = { ...(req.body || {}) };
    if (body.sourceFilePath) {
      const att = await attachStaged(req, {
        bizType: 'fai_template', bizId: null, subDir: `fai-tpl/${Date.now()}`,
        fileName: body.sourceFileName, filePath: body.sourceFilePath,
        fileSize: body.sourceFileSize, mimeType: body.sourceMimeType,
      });
      body.sourceFileId = att.id;
    }
    const r = await ipqc.createFaiTemplate({ ...body, createdBy: req.user.id });
    // G3：同 IPQC —— 先建后回填附件 biz_id
    if (body.sourceFileId && r?.id) {
      await one(`UPDATE attachment SET biz_id = $1 WHERE id = $2`, [r.id, body.sourceFileId]);
    }
    return ok(reply, r, '首件模板已创建');
  }));

  app.put('/api/fai/templates/:id', { preHandler: requirePermission('fai:manage') }, wrap(async (req, reply) => {
    const id = toId(req.params.id);
    const body = { ...(req.body || {}) };
    if (body.sourceFilePath) {
      const att = await attachStaged(req, {
        bizType: 'fai_template', bizId: id, subDir: `fai-tpl/${id}`,
        fileName: body.sourceFileName, filePath: body.sourceFilePath,
        fileSize: body.sourceFileSize, mimeType: body.sourceMimeType,
      });
      body.sourceFileId = att.id;
    }
    const r = await ipqc.updateFaiTemplate(id, body);
    return ok(reply, r, '首件模板已更新');
  }));

  app.delete('/api/fai/templates/:id', { preHandler: requirePermission('fai:manage') }, wrap(async (req, reply) => {
    return ok(reply, await ipqc.deleteFaiTemplate(toId(req.params.id)), '首件模板已删除');
  }));

  /* ---- 首件 FAI 记录（登录即可，检验员可提报） ---- */
  app.get('/api/fai/records', wrap(async (req, reply) => ok(reply, await ipqc.listFaiRecords(req.query || {}))));

  app.get('/api/fai/records/:id', wrap(async (req, reply) => ok(reply, await ipqc.getFaiRecord(toId(req.params.id)))));

  app.post('/api/fai/records', wrap(async (req, reply) => {
    const r = await ipqc.createFaiRecord({ ...(req.body || {}), inspectorId: req.user.id });
    return ok(reply, r, r.status === 'submitted' ? '首件记录已提交' : '草稿已保存');
  }));

  app.put('/api/fai/records/:id', wrap(async (req, reply) => {
    const r = await ipqc.updateFaiRecord(toId(req.params.id), req.user.id, req.body || {}, !!req.user.isAdmin);
    return ok(reply, r, r.status === 'submitted' ? '首件记录已提交' : '草稿已保存');
  }));

  app.post('/api/fai/records/:id/report-issue', wrap(async (req, reply) => {
    const r = await ipqc.reportFaiIssue(toId(req.params.id), req.user.id);
    const msg = r.error ? `上报失败：${r.error}` : (r.already ? '该记录已上报异常单' : '已上报品质异常单');
    return ok(reply, r, msg);
  }));

  app.post('/api/fai/records/:id/attachments', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    await ipqc.getFaiRecord(id);
    const att = await attachStaged(req, {
      bizType: 'fai_record', bizId: id, subDir: `fai/${id}`, ...(req.body || {}),
    });
    return ok(reply, att, '附件已关联');
  }));

  /* ---- 统计 ---- */
  app.get('/api/stats/advanced', wrap(async (req, reply) => ok(reply, await mod.getAdvancedStats())));

  /* ============================================================
   * S7：知识库增强（点赞 / 收藏 / 全文检索）
   * 静态路径须置于 /api/knowledge/:id 之前
   * ============================================================ */
  app.get('/api/knowledge/favorites', wrap(async (req, reply) => {
    return ok(reply, await mod.listFavorites(req.user.id, req.query || {}));
  }));

  app.get('/api/knowledge/search', wrap(async (req, reply) => {
    return ok(reply, await mod.searchKnowledge({ ...(req.query || {}), userId: req.user.id }));
  }));

  app.get('/api/knowledge/likes', wrap(async (req, reply) => {
    return ok(reply, await mod.listMyLikes(req.user.id, req.query || {}));
  }));

  // 下载/浏览统计看板（静态路径，须在 /:id 之前）
  app.get('/api/knowledge/stats', wrap(async (req, reply) => {
    return ok(reply, await mod.knowledgeDownloadStats({ limit: req.query?.limit }));
  }));

  app.post('/api/knowledge/:id/like', wrap(async (req, reply) => {
    const r = await mod.likeKnowledge(toId(req.params.id), req.user.id);
    return ok(reply, r, r.liked ? '已点赞' : '已取消点赞');
  }));

  app.post('/api/knowledge/:id/favorite', wrap(async (req, reply) => {
    const r = await mod.favoriteKnowledge(toId(req.params.id), req.user.id);
    return ok(reply, r, r.favorited ? '已收藏' : '已取消收藏');
  }));

  /* ============================================================
   * S7：日历日程（个人日程 CRUD + 首页聚合视图）
   * 静态路径 /api/calendar/events 须置于 /api/calendar/:id 之前
   * ============================================================ */
  app.get('/api/calendar/events', wrap(async (req, reply) => {
    const events = await calendar.listEvents({
      userId: req.user.id,
      from: req.query?.from,
      to: req.query?.to,
    });
    return ok(reply, events);
  }));

  app.get('/api/calendar', wrap(async (req, reply) => {
    // 等价于 events（缺省近 30 天），便于前端标准列表调用
    const events = await calendar.listEvents({
      userId: req.user.id,
      from: req.query?.from,
      to: req.query?.to,
    });
    return ok(reply, events);
  }));

  app.post('/api/calendar', wrap(async (req, reply) => {
    const r = await calendar.createEvent(req.body || {}, req.user.id);
    return ok(reply, r, '日程已创建');
  }));

  app.get('/api/calendar/:id', wrap(async (req, reply) => {
    return ok(reply, await calendar.getEvent(toId(req.params.id), req.user.id));
  }));

  app.put('/api/calendar/:id', wrap(async (req, reply) => {
    const r = await calendar.updateEvent(toId(req.params.id), req.body || {}, req.user.id);
    return ok(reply, r, '日程已更新');
  }));

  app.delete('/api/calendar/:id', wrap(async (req, reply) => {
    const r = await calendar.deleteEvent(toId(req.params.id), req.user.id);
    return ok(reply, r, '日程已删除');
  }));

  /* ============================================================
   * S7：通告公告（列表 / 详情 / 发布 / 已读 / 未读数）
   * 静态路径 /api/announcements/unread 须置于 /api/announcements/:id 之前
   * ============================================================ */
  app.get('/api/announcements/unread', wrap(async (req, reply) => {
    const n = await ann.unreadCount(req.user.id);
    return ok(reply, { unread: n });
  }));

  app.get('/api/announcements', wrap(async (req, reply) => {
    return ok(reply, await ann.listAnnouncements(req.query || {}, req.user));
  }));

  app.post('/api/announcements', wrap(async (req, reply) => {
    const r = await ann.createAnnouncement(req.body || {}, req.user.id);
    return ok(reply, r, '通告已保存');
  }));

  app.get('/api/announcements/:id', wrap(async (req, reply) => {
    return ok(reply, await ann.getAnnouncement(toId(req.params.id), req.user));
  }));

  app.put('/api/announcements/:id', wrap(async (req, reply) => {
    const r = await ann.updateAnnouncement(toId(req.params.id), req.body || {}, req.user);
    return ok(reply, r, '通告已更新');
  }));

  app.post('/api/announcements/:id/publish', wrap(async (req, reply) => {
    const r = await ann.publishAnnouncement(toId(req.params.id), req.user);
    return ok(reply, r, r.alreadyPublished ? '该通告已发布' : '通告已发布');
  }));

  app.post('/api/announcements/:id/read', wrap(async (req, reply) => {
    await ann.markRead(toId(req.params.id), req.user.id);
    return ok(reply, null, '已标记已读');
  }));

  app.delete('/api/announcements/:id', wrap(async (req, reply) => {
    const r = await ann.deleteAnnouncement(toId(req.params.id), req.user);
    return ok(reply, r, '通告已删除');
  }));

  // 阅读回执明细：已读人员（含时间）+ 未读人员。仅发布者/管理员可看（与编辑权一致）。
  app.get('/api/announcements/:id/reads', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    const row = await one(`SELECT id, publisher_id FROM announcement WHERE id = $1`, [id]);
    if (!row) return reply.code(404).send({ code: 1, msg: '通告不存在' });
    const manageable = !!req.user.isAdmin || Number(row.publisher_id) === Number(req.user.id);
    if (!manageable) return reply.code(403).send({ code: 1, msg: '只有发布人可以查看阅读回执' });
    const read = await many(
      `SELECT ar.user_id, u.real_name, u.department_id, d.name AS dept_name, ar.read_at
         FROM announcement_read ar
         LEFT JOIN org_user u ON u.id = ar.user_id
         LEFT JOIN org_department d ON d.id = u.department_id
        WHERE ar.announcement_id = $1
        ORDER BY ar.read_at`,
      [id]
    );
    const unread = await many(
      `SELECT u.id AS user_id, u.real_name, u.department_id, d.name AS dept_name
         FROM org_user u
         LEFT JOIN org_department d ON d.id = u.department_id
        WHERE u.active = TRUE
          AND COALESCE(u.is_system, FALSE) = FALSE
          AND NOT EXISTS (
                SELECT 1 FROM announcement_read ar
                 WHERE ar.announcement_id = $1 AND ar.user_id = u.id
              )
        ORDER BY u.real_name`,
      [id]
    );
    return ok(reply, { read, unread });
  }));
}