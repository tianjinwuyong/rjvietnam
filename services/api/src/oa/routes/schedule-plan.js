// ============================================================
// 排班计划路由（部门提报 → HR 确认 → 回写）
// ------------------------------------------------------------
// 为什么单独一个前缀 /api/schedule-plan：
//   模块级权限按「最长路径前缀」匹配。若挂在 /api/attendance 下，部门主管要能提报
//   就必须拿到 attendance 模块的 operate，而该模块的 perm_codes 含 attend:schedule，
//   等于顺带把「直接改生效排班」的权力给了他们，审批闸门形同虚设。
//   独立前缀 + 独立模块（schedule_plan / attend:schedule_plan）才能真正分开。
//
// 静态路由（template / options）必须注册在 /:id 之前，否则会被动态段吃掉。
// ============================================================
import { authenticate, ok, wrap, requireAnyPermission } from '../middleware/index.js';
import { levelOf } from '../services/module-permission.js';
import * as svc from '../services/schedule-plan-service.js';
import * as xls from '../services/schedule-plan-excel.js';

const PLAN_PERMS = ['attend:schedule_plan', 'attend:schedule', 'attend:schedule_approve'];

/**
 * 纵深防御：除模块前缀闸门之外的第二道鉴权。
 *
 * 为什么必须有：checkModuleAccess 对「未登记为模块的路径」一律放行，
 * 一旦 sys_module 里 schedule_plan 这行被停用 / 删除 / api_prefixes 被改动，
 * 前缀闸门就静默失效，本模块全部接口变成「登录即可访问」。
 * 这里直接认权限码，与模块表配置解耦；view 级仍放行读接口（写操作由模块闸门拦）。
 */
function requirePlanAccess() {
  return async (req, reply) => {
    const u = req.user || {};
    if (u.isAdmin || u.isSystem || u.isApi) return;
    const perms = u.permissions || [];
    if (PLAN_PERMS.some((c) => perms.includes(c))) return;
    const lv = levelOf(u, 'schedule_plan');
    if (lv === 'view' || lv === 'operate') return;
    return reply.code(403).send({ code: 1, msg: '没有排班计划的访问权限' });
  };
}

/** 附件下载头：filename* 兼容中文，且强制浏览器下载而非预览 */
function xlsxHeaders(reply, filename) {
  reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  reply.header('Content-Disposition',
    `attachment; filename="schedule.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  reply.header('Cache-Control', 'no-store');
  return reply;
}

export default async function schedulePlanRoutes(app) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requirePlanAccess());

  /** 下拉框数据：可用部门 / 班次 / 权限标记 */
  app.get('/api/schedule-plan/options', wrap(async (req, reply) => {
    const [departments, shifts] = await Promise.all([
      svc.listDepartments(req.user),
      svc.listShifts(),
    ]);
    return ok(reply, {
      departments,
      shifts,
      isHr: svc.isHr(req.user),
      canPlan: svc.canPlan(req.user),
      restCode: svc.REST_CODE,
    });
  }));

  /** Excel 导入模板列定义（前端生成文件） */
  app.get('/api/schedule-plan/template', wrap(async (req, reply) => {
    return ok(reply, svc.importTemplate());
  }));

  /** Excel 导入模板（服务端生成 .xlsx，含班次说明页） */
  app.get('/api/schedule-plan/template.xlsx', wrap(async (req, reply) => {
    const shifts = await svc.listShifts();
    const buf = await xls.buildTemplate(shifts, {});
    xlsxHeaders(reply, '排班计划导入模板.xlsx');
    return reply.send(buf);
  }));

  /** 计划列表 */
  app.get('/api/schedule-plan', wrap(async (req, reply) => {
    return ok(reply, await svc.listPlans(req.query || {}, req.user));
  }));

  /** 新建草稿（同部门同月已有草稿则复用） */
  app.post('/api/schedule-plan', wrap(async (req, reply) => {
    const r = await svc.createPlan(req.body || {}, req.user);
    return ok(reply, r, r.reused ? '已存在草稿，直接打开继续编辑' : '已新建排班计划草稿');
  }));

  /**
   * 一键生成：建草稿 + 铺满整月。
   * 有上月已生效排班 → 沿用每人上月的主班次；没有 → 工作日白班 / 周末休息。
   * 少掉「新建 → 预填」两步，也避免每月从零重排。
   */
  app.post('/api/schedule-plan/quick', wrap(async (req, reply) => {
    const r = await svc.quickCreate(req.body || {}, req.user);
    let msg;
    if (r.reused) msg = '已存在草稿，直接打开继续编辑';
    else if (r.inherited) msg = `已沿用 ${r.inherited.from} 的班次（${r.users} 人 / ${r.filled} 格），只需调整例外`;
    else msg = `已按「工作日上班 / 周末休息」生成 ${r.filled} 格（${r.users} 人）`;
    return ok(reply, r, msg);
  }));

  /** 计划详情（表头 + 明细 + 花名册 + 当月现状 + 班次） */
  app.get('/api/schedule-plan/:id', wrap(async (req, reply) => {
    return ok(reply, await svc.getPlan(req.params.id, req.user));
  }));

  /** 改备注 */
  app.put('/api/schedule-plan/:id', wrap(async (req, reply) => {
    return ok(reply, await svc.updatePlan(req.params.id, req.body || {}, req.user), '已保存');
  }));

  /** 删草稿 */
  app.delete('/api/schedule-plan/:id', wrap(async (req, reply) => {
    await svc.deletePlan(req.params.id, req.user);
    return ok(reply, { ok: true }, '草稿已删除');
  }));

  /** 整月预填（工作日 / 周末默认班次） */
  app.post('/api/schedule-plan/:id/generate', wrap(async (req, reply) => {
    const r = await svc.generateMonth(req.params.id, req.body || {}, req.user);
    return ok(reply, r, `已预填 ${r.written} 格（${r.users} 人 × ${r.dates} 天）`);
  }));

  /** 单格调整（网格单击） */
  app.post('/api/schedule-plan/:id/cell', wrap(async (req, reply) => {
    return ok(reply, await svc.setCell(req.params.id, req.body || {}, req.user), '已更新');
  }));

  /** 批量刷格（整行 / 整列 / 框选矩形） */
  app.post('/api/schedule-plan/:id/batch', wrap(async (req, reply) => {
    const r = await svc.setCells(req.params.id, req.body || {}, req.user);
    return ok(reply, r, `已更新 ${r.changed} 格`);
  }));

  /** 精确格子写入（拖拽刷格：只写划过的格子） */
  app.post('/api/schedule-plan/:id/cells', wrap(async (req, reply) => {
    const r = await svc.setCellList(req.params.id, req.body || {}, req.user);
    return ok(reply, r, `已更新 ${r.changed} 格`);
  }));

  /**
   * Excel 文件导入（multipart）。
   * 与 JSON 版 /import 的区别：文件由服务端解析，用户拿得到「第几行错在哪」，
   * 且不会把上万个 JSON 行塞进请求体。
   */
  app.post('/api/schedule-plan/:id/import.xlsx', wrap(async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ code: 1, msg: '未收到文件' });
    const name = String(file.filename || '').toLowerCase();
    if (name && !/\.(xlsx|xlsm|xls)$/.test(name)) {
      return reply.code(400).send({ code: 1, msg: '请上传 .xlsx 文件（Excel 2007+）' });
    }
    const buf = await file.toBuffer();
    if (!buf.length) return reply.code(400).send({ code: 1, msg: '文件为空' });
    if (buf.length > 8 * 1024 * 1024) return reply.code(400).send({ code: 1, msg: '文件不能超过 8MB' });

    let parsed;
    try {
      parsed = xls.parseImportBuffer(buf);
    } catch (e) {
      return reply.code(400).send({ code: 1, msg: 'Excel 解析失败，请确认是 .xlsx 且未加密' });
    }
    if (!parsed.rows.length) {
      return reply.code(400).send({ code: 1, msg: parsed.errors[0]?.msg || '文件里没有可导入的数据行' });
    }
    const r = await svc.importRows(req.params.id, parsed.rows, req.user);
    // 解析阶段（日期无法识别）与业务校验阶段的错误合并返回，用户一次改完
    const errors = [...parsed.errors, ...(r.errors || [])].slice(0, 200);
    return ok(reply, Object.assign({}, r, { errors }), `导入完成：成功 ${r.inserted} 行，失败 ${r.failed + parsed.errors.length} 行`);
  }));

  /** Excel 行导入 */
  app.post('/api/schedule-plan/:id/import', wrap(async (req, reply) => {
    const rows = req.body?.rows || req.body?.items || [];
    const r = await svc.importRows(req.params.id, rows, req.user);
    return ok(reply, r, `导入完成：成功 ${r.inserted} 行，失败 ${r.failed} 行`);
  }));

  /** 导出计划行（前端生成 xlsx） */
  app.get('/api/schedule-plan/:id/export', wrap(async (req, reply) => {
    return ok(reply, await svc.exportRows(req.params.id, req.user));
  }));

  /** 导出计划为 .xlsx（服务端生成：明细页 + 月历宽表 + 说明页） */
  app.get('/api/schedule-plan/:id/export.xlsx', wrap(async (req, reply) => {
    const data = await svc.getPlan(req.params.id, req.user);
    const buf = xls.buildExport({
      plan: data.plan,
      users: data.users,
      dates: data.dates,
      items: data.items,
      shifts: data.shifts,
    });
    xlsxHeaders(reply, `${data.plan.plan_no}-排班计划.xlsx`);
    return reply.send(buf);
  }));

  /** 提交审批（HR 可用 direct=true 直接生效） */
  app.post('/api/schedule-plan/:id/submit', wrap(async (req, reply) => {
    const r = await svc.submitPlan(req.params.id, req.user, { direct: !!req.body?.direct });
    const msg = r.direct
      ? `已直接生效：回写 ${r.applied} 格${r.skipped?.length ? `，跳过 ${r.skipped.length} 格冲突` : ''}`
      : '已提交人事审批';
    return ok(reply, r, msg);
  }));

  /** 撤回 */
  app.post('/api/schedule-plan/:id/withdraw', wrap(async (req, reply) => {
    const r = await svc.withdrawPlan(req.params.id, req.user);
    return ok(reply, r, r.status === 'cancelled' ? '已撤回' : '已作废');
  }));

  /**
   * 手工重放回写（补偿用）。
   * 场景：审批已通过但回写时数据库抖动，plan 停在 approved + applied_at IS NULL。
   * 仅人事/管理员可触发；幂等（已回写直接返回 already）。
   */
  app.post('/api/schedule-plan/:id/apply',
    { preHandler: requireAnyPermission('attend:schedule', 'attend:schedule_approve') },
    wrap(async (req, reply) => {
      const r = await svc.applyPlan(req.params.id, { approverId: Number(req.user.id) });
      if (r.already) return ok(reply, r, '该计划已回写过，无需重复执行');
      return ok(reply, r, `已回写 ${r.applied} 格${r.skipped?.length ? `，跳过 ${r.skipped.length} 格冲突` : ''}`);
    }));
}
