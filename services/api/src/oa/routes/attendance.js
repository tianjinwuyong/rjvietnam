import { authenticate, ok, wrap, requirePermission, requireAnyPermission } from '../middleware/index.js';
import * as attend from '../services/attendance-service.js';
import * as salary from '../services/salary-service.js';
import * as sched from '../services/schedule-service.js';
import * as comp from '../services/comp-service.js';
import * as ruleSvc from '../services/attendance-rule-service.js';

// ============================================================
// S5 考勤 + 薪资 + 排班 路由
//   · 考勤（attendance）：导入/模板/原始/汇总/计算/导出 —— 写操作需 attend:manage
//   · 排班（schedule）：模板/导入/月历/调班/班次设置/卡点识别 —— 写操作需 attend:schedule
//   · 薪资（salary）：架构 CRUD/审批/试算/记录/导出/职类分配 —— 写操作需 salary:manage
//   · 薪资读接口做权限隔离：仅本人或 salary:manage 可查看
//   · 考勤/卡点读接口同样做权限隔离：无管理权限者只能读到本人
// ============================================================

/* 卡点读接口口径：考勤管理 / 排班 / 卡点查看，任一即可 */
const ANOMALY_READ = requireAnyPermission('attend:manage', 'attend:schedule', 'attend:anomaly');

export default async function attendanceRoutes(app) {
  app.addHook('preHandler', authenticate);

  // ---------------- 考勤 ----------------

  /*
   * 考勤读接口的数据范围：attend:manage 可查全员，其余人强制只看本人。
   * 入参 userId 对无权限者一律丢弃 —— 否则改个 URL 参数就能拉全厂考勤。
   */
  function selfScopeQuery(req) {
    const q = { ...(req.query || {}) };
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('attend:manage');
    if (!canManage) q.userId = req.user.id;
    return q;
  }

  // 打卡导入模板列定义（静态路径须放在 /:id 之前）
  app.get('/api/attendance/template', wrap(async (req, reply) => {
    return ok(reply, attend.attendanceImportTemplate());
  }));

  // 批量导入打卡（逐行 upsert，只增不改）
  app.post('/api/attendance/import', { preHandler: requirePermission('attend:manage') }, wrap(async (req, reply) => {
    const rows = req.body?.rows || req.body?.items || [];
    const r = await attend.importAttendance(rows, req.user.id);
    return ok(reply, r, `导入完成：新增 ${r.inserted}，跳过 ${r.skipped}，失败 ${r.failed}`);
  }));

  // 打卡原始数据（只读；无 attend:manage 仅本人）
  app.get('/api/attendance/raw', wrap(async (req, reply) => {
    return ok(reply, await attend.listAttendanceRaw(selfScopeQuery(req)));
  }));

  // 考勤汇总列表（只读；无 attend:manage 仅本人）
  app.get('/api/attendance/summary', wrap(async (req, reply) => {
    return ok(reply, await attend.listAttendanceSummary(selfScopeQuery(req)));
  }));

  /*
   * 休假台账（休假电子流 → 考勤的对接结果，只读）。
   * 一单一行：单号 / 假别（含字典的带薪与计考勤口径）/ 起止 / 天数 / 写入工时 / 状态。
   *   status: pending 审批中（考勤只做预告，不参与计薪）
   *           written 已写入考勤日汇总
   *           revoked 已撤销并回收
   * 数据范围与其它考勤读接口一致：无 attend:manage 只能看本人。
   */
  app.get('/api/attendance/leaves', wrap(async (req, reply) => {
    const q = selfScopeQuery(req);
    return ok(reply, await attend.listAttendanceLeaves({
      userId: q.userId || null,
      from: q.from || null,
      to: q.to || null,
      status: q.status || null,
      leaveType: q.leaveType || null,
      keyword: q.keyword || null,
      limit: Number(q.limit) || 500
    }));
  }));

  // 触发工时计算（写操作）
  app.post('/api/attendance/compute', { preHandler: requirePermission('attend:manage') }, wrap(async (req, reply) => {
    const { from, to, userId } = req.body || {};
    const r = await attend.computeAttendance({ from, to, userId });
    return ok(reply, r, `考勤计算完成：${r.from} ~ ${r.to}，${r.users} 人 / ${r.days} 天`);
  }));

  // 考勤导出结构（前端生成 xlsx；无 attend:manage 仅本人）
  app.get('/api/attendance/export', wrap(async (req, reply) => {
    return ok(reply, await attend.attendanceExport(selfScopeQuery(req)));
  }));

  // ---------------- 打卡规则 + 工作日历（批次 A，管理 API） ----------------
  app.get('/api/attendance/rules', wrap(async (req, reply) => {
    return ok(reply, await ruleSvc.listRules());
  }));
  app.get('/api/attendance/rules/:code', wrap(async (req, reply) => {
    return ok(reply, await ruleSvc.getRule(req.params.code));
  }));
  app.post('/api/attendance/rules', { preHandler: requirePermission('attend:manage') }, wrap(async (req, reply) => {
    return ok(reply, await ruleSvc.saveRule(req.body || {}), '规则已保存');
  }));
  app.put('/api/attendance/rules/:code', { preHandler: requirePermission('attend:manage') }, wrap(async (req, reply) => {
    return ok(reply, await ruleSvc.saveRule({ ...(req.body || {}), code: req.params.code }), '规则已保存');
  }));
  app.delete('/api/attendance/rules/:code', { preHandler: requirePermission('attend:manage') }, wrap(async (req, reply) => {
    return ok(reply, await ruleSvc.deleteRule(req.params.code), '规则已删除');
  }));

  app.get('/api/attendance/calendar/:yearMonth', wrap(async (req, reply) => {
    return ok(reply, await attend.getWorkCalendar(req.params.yearMonth) || null);
  }));

  // 越南法定节假日清单（按年）。日历页用来标注与强制休息。
  app.get('/api/attendance/holiday', wrap(async (req, reply) => {
    return ok(reply, await ruleSvc.listHolidays(req.query?.year));
  }));

  app.put('/api/attendance/calendar/:yearMonth', { preHandler: requirePermission('attend:manage') }, wrap(async (req, reply) => {
    return ok(reply, await ruleSvc.upsertWorkCalendar({ ...(req.body || {}), yearMonth: req.params.yearMonth }), '工作日历已保存');
  }));

  // ---------------- 排班 ----------------
  // 注意：静态路径（template / export / shifts / anomalies）须放在动态段之前

  // 排班导入模板列定义
  app.get('/api/attendance/schedule/template', wrap(async (req, reply) => {
    return ok(reply, sched.scheduleImportTemplate());
  }));

  // 批量导入排班（UPSERT 可覆盖）
  app.post('/api/attendance/schedule/import', { preHandler: requirePermission('attend:schedule') }, wrap(async (req, reply) => {
    const rows = req.body?.rows || req.body?.items || [];
    const r = await sched.importSchedule(rows, req.user.id);
    return ok(reply, r, `排班导入完成：新增 ${r.inserted}，更新 ${r.updated}，失败 ${r.failed}`);
  }));

  // 排班导出结构（前端生成 xlsx）
  app.get('/api/attendance/schedule/export', wrap(async (req, reply) => {
    return ok(reply, await sched.scheduleExport(req.query || {}));
  }));

  // 排班查询 / 月历数据
  app.get('/api/attendance/schedule', wrap(async (req, reply) => {
    return ok(reply, await sched.listSchedule(req.query || {}));
  }));

  // 手工调整单个排班单元格（月历点击调班）
  app.post('/api/attendance/schedule/cell', { preHandler: requirePermission('attend:schedule') }, wrap(async (req, reply) => {
    const r = await sched.setScheduleCell(req.body || {}, req.user.id);
    return ok(reply, r, r.action === 'cleared' ? '排班已清空' : '排班已调整');
  }));

  // 批量刷班（月历框选多人多日）
  app.post('/api/attendance/schedule/batch', { preHandler: requirePermission('attend:schedule') }, wrap(async (req, reply) => {
    const r = await sched.batchSetSchedule(req.body || {}, req.user.id);
    return ok(reply, r, `批量刷班完成：${r.users} 人 × ${r.dates} 天`);
  }));

  // 删除排班（等价于清空单元格；用 POST 兼容部分客户端对 DELETE body 的差异）
  app.delete('/api/attendance/schedule', { preHandler: requirePermission('attend:schedule') }, wrap(async (req, reply) => {
    const q = { ...(req.query || {}), ...(req.body || {}) };
    const userId = Number(q.userId);
    if (!userId) {
      return reply.code(400).send({ code: 1, msg: '请指定员工（userId）' });
    }
    const r = await sched.setScheduleCell({ userId, workDate: q.workDate, clear: true }, req.user.id);
    return ok(reply, r, '排班已删除');
  }));

  // 班次定义列表（含停用，供班次设置页）
  app.get('/api/attendance/shifts', wrap(async (req, reply) => {
    const includeInactive = String(req.query?.includeInactive) === 'true'
      || req.user.isAdmin || (req.user.permissions || []).includes('attend:schedule');
    return ok(reply, await sched.listShiftDefs({ includeInactive }));
  }));

  // 班次定义更新（时间窗 + 待遇口径）
  app.put('/api/attendance/shifts/:code', { preHandler: requirePermission('attend:schedule') }, wrap(async (req, reply) => {
    const r = await sched.updateShiftDef(req.params.code, req.body || {});
    return ok(reply, r, '班次设置已保存');
  }));

  // 卡点识别（写操作：落 attendance_anomaly）
  app.post('/api/attendance/anomalies/detect', { preHandler: requirePermission('attend:schedule') }, wrap(async (req, reply) => {
    const { from, to, userId, departmentId } = req.body || {};
    const r = await sched.detectAnomalies({ from, to, userId, departmentId });
    return ok(reply, r,
      `卡点识别完成：${r.from} ~ ${r.to}，${r.users} 人，命中 ${r.detected} 项（新增 ${r.inserted} / 更新 ${r.updated}）`);
  }));

  // 卡点统计
  app.get('/api/attendance/anomalies/stats', { preHandler: ANOMALY_READ }, wrap(async (req, reply) => {
    return ok(reply, await sched.anomalyStats(req.query || {}));
  }));

  // 卡点导出结构（前端生成 xlsx）
  app.get('/api/attendance/anomalies/export', { preHandler: ANOMALY_READ }, wrap(async (req, reply) => {
    return ok(reply, await sched.anomalyExport(req.query || {}));
  }));

  // 卡点列表
  app.get('/api/attendance/anomalies', { preHandler: ANOMALY_READ }, wrap(async (req, reply) => {
    return ok(reply, await sched.listAnomalies(req.query || {}));
  }));

  // 卡点人工闭环
  app.post('/api/attendance/anomalies/:id/resolve', { preHandler: requirePermission('attend:schedule') }, wrap(async (req, reply) => {
    const r = await sched.resolveAnomaly(Number(req.params.id), req.body?.note, req.user.id);
    return ok(reply, r, r.alreadyResolved ? '该卡点已闭环' : '卡点已闭环');
  }));

  // 撤销卡点闭环
  app.post('/api/attendance/anomalies/:id/unresolve', { preHandler: requirePermission('attend:schedule') }, wrap(async (req, reply) => {
    const r = await sched.unresolveAnomaly(Number(req.params.id));
    return ok(reply, r, '已撤销闭环');
  }));

  // ---------------- 卡点一键补卡（第33轮：加班/夜班漏卡支持签卡补卡） ----------------
  // ⚠️ 路由顺序：静态段（remedy-stats）必须放在 /:id/... 之前

  // 补卡状态统计（卡点页签顶部用）
  app.get('/api/attendance/anomalies/remedy-stats', wrap(async (req, reply) => {
    return ok(reply, await sched.remedyStats(req.query || {}));
  }));

  // 补卡预填信息（被签卡人 / 日期 / 建议时段 / 原因），供前端一键发起
  app.get('/api/attendance/anomalies/:id/remedy-preview', wrap(async (req, reply) => {
    const id = Number(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await sched.missCardPreview(id));
  }));

  // 一键发起补卡：创建 miss_card 实例并回写卡点状态
  // 权限：attend:remedy（人事/文员）。代提授权由 flow 路由统一把关。
  app.post('/api/attendance/anomalies/:id/miss-card', { preHandler: requirePermission('attend:remedy') }, wrap(async (req, reply) => {
    const id = Number(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const body = req.body || {};
    const r = await sched.createMissCardFromAnomaly(id, {
      operatorId: req.user.id,
      submitNow: body.submitNow !== false,   // 默认直接提交
      slot: body.slot,
      reasonType: body.reasonType,
      evidence: body.evidence,
      witness: body.witness,
      title: body.title,
      formData: body.formData,
    });
    const msg = r.reused
      ? (r.submitted ? '该卡点已有在途补卡单' : '该卡点已有补卡草稿')
      : (r.submitted ? '补卡申请已提交' : '补卡草稿已保存');
    return ok(reply, r, msg);
  }));

  // 撤销卡点的补卡关联（补卡单作废时回收）
  app.post('/api/attendance/anomalies/:id/clear-remedy', { preHandler: requirePermission('attend:remedy') }, wrap(async (req, reply) => {
    const id = Number(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await sched.clearAnomalyRemedy(id), '补卡关联已撤销');
  }));

  // ---------------- 调休 / 补班（第 35 轮） ----------------

  // 日期性质覆盖列表
  app.get('/api/attendance/comp/overrides', wrap(async (req, reply) => {
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('attend:comp');
    const q = { ...(req.query || {}) };
    if (!canManage) q.userId = req.user.id; // 员工仅见自己
    return ok(reply, await comp.listOverrides(q));
  }));

  // 写日期性质覆盖（单人 / 部门）
  app.post('/api/attendance/comp/overrides', { preHandler: requirePermission('attend:comp') }, wrap(async (req, reply) => {
    return ok(reply, await comp.upsertOverride(req.body || {}, req.user.id), '日期性质覆盖已保存');
  }));

  // 删除覆盖
  app.delete('/api/attendance/comp/overrides/:id', { preHandler: requirePermission('attend:comp') }, wrap(async (req, reply) => {
    return ok(reply, await comp.removeOverride(Number(req.params.id)), '覆盖已删除');
  }));

  // 欠班余额
  app.get('/api/attendance/comp/balance', wrap(async (req, reply) => {
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('attend:comp');
    const uid = canManage && req.query?.userId ? Number(req.query.userId) : req.user.id;
    return ok(reply, await comp.oweBalance(uid));
  }));

  // 欠班账明细
  app.get('/api/attendance/comp/ledger', wrap(async (req, reply) => {
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('attend:comp');
    const q = { ...(req.query || {}) };
    if (!canManage) q.userId = req.user.id;
    return ok(reply, await comp.oweLedger(q));
  }));

  // 集体调休批量下发
  app.post('/api/attendance/comp/batch', { preHandler: requirePermission('attend:comp') }, wrap(async (req, reply) => {
    const r = await comp.batchCompDay(req.body || {}, req.user.id);
    return ok(reply, r, `集体调休已下发：${r.users} 人`);
  }));

  // 调休统计
  app.get('/api/attendance/comp/stats', wrap(async (req, reply) => {
    return ok(reply, await comp.compStats(req.query || {}));
  }));

  // 欠班逾期扫描（供前端提醒/HR 查看）
  app.get('/api/attendance/comp/overdue', { preHandler: requirePermission('attend:comp') }, wrap(async (req, reply) => {
    return ok(reply, await comp.scanOverdue(req.query?.asOf));
  }));

  // 年假抵扣欠班
  app.post('/api/attendance/comp/offset-annual', { preHandler: requirePermission('attend:comp') }, wrap(async (req, reply) => {
    return ok(reply, await comp.offsetByAnnual(req.body || {}), '年假抵扣已登记');
  }));

  // ---------------- 薪资 ----------------

  // 薪资架构列表
  app.get('/api/salary/structures', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.listSalaryStructures(req.query || {}));
  }));

  // 薪资架构详情
  app.get('/api/salary/structures/:id', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const r = await salary.getSalaryStructure(Number(req.params.id));
    if (!r) return reply.code(404).send({ code: 1, msg: '薪资架构不存在' });
    return ok(reply, r);
  }));

  // 新建薪资架构
  app.post('/api/salary/structures', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const r = await salary.createSalaryStructure(req.body || {}, req.user.id);
    return ok(reply, r, `薪资架构已创建（版本 v${r.version}）`);
  }));

  // 更新薪资架构（仅草稿）
  app.put('/api/salary/structures/:id', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const r = await salary.updateSalaryStructure(Number(req.params.id), req.body || {});
    return ok(reply, r, '薪资架构已更新');
  }));

  // 审批薪资架构（draft → approved，旧版归档）
  app.post('/api/salary/structures/:id/approve', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const r = await salary.approveSalaryStructure(Number(req.params.id), req.user.id);
    return ok(reply, r, '薪资架构已审批通过');
  }));

  // ---------------- 职类树（批次 B，管理 API） ----------------
  app.get('/api/salary/classes', wrap(async (req, reply) => {
    return ok(reply, await salary.listSalaryClasses());
  }));
  app.get('/api/salary/classes/:id', wrap(async (req, reply) => {
    return ok(reply, await salary.getSalaryClass(Number(req.params.id)));
  }));
  app.post('/api/salary/classes', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.saveSalaryClass(req.body || {}), '职类已保存');
  }));
  app.put('/api/salary/classes/:id', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.saveSalaryClass({ ...(req.body || {}), id: Number(req.params.id) }), '职类已保存');
  }));
  app.delete('/api/salary/classes/:id', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.deleteSalaryClass(Number(req.params.id)), '职类已删除');
  }));

  // ---------------- 职类分配（批次 E：批量匹配 + 个别覆盖） ----------------
  app.get('/api/salary/assignments', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.listSalaryAssignments(req.query || {}));
  }));

  // 单人分配 / 个别覆盖
  app.post('/api/salary/assignments', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const { userId, classId, effectiveFrom, source } = req.body || {};
    const r = await salary.assignSalaryClass(userId, classId, effectiveFrom, source, req.user.id);
    return ok(reply, r, '职类分配已保存');
  }));

  // 批量分配（逐人结果回传）
  app.post('/api/salary/assignments/batch', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const r = await salary.assignSalaryClassBatch(req.body || {}, req.user.id);
    return ok(reply, r, `批量分配完成：成功 ${r.ok}，失败 ${r.failed}`);
  }));

  // 薪资试算
  app.post('/api/salary/generate', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const { period, userId } = req.body || {};
    const r = await salary.generateSalary(period, userId);
    return ok(reply, r, `试算完成：生成 ${r.generated}，跳过 ${r.skipped}`);
  }));

  // 薪资记录列表（权限隔离：仅本人或 salary:manage）
  app.get('/api/salary/records', wrap(async (req, reply) => {
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('salary:manage');
    const q = { ...(req.query || {}) };
    if (!canManage) {
      q.userId = req.user.id; // 强制只看本人
    }
    return ok(reply, await salary.listSalaryRecords(q));
  }));

  // 绩效结果列表（只读，salary:manage；period/user 过滤）
  app.get('/api/salary/performance-records', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.listPerformanceRecords(req.query || {}));
  }));

  // 薪资导出结构（权限隔离：仅本人或 salary:manage）
  app.get('/api/salary/export', wrap(async (req, reply) => {
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('salary:manage');
    const q = { ...(req.query || {}) };
    if (!canManage) {
      q.userId = req.user.id;
    }
    return ok(reply, await salary.salaryExport(q));
  }));

  // ---------------- 个人所得税（2026-10-26 新增） ----------------
  // 税率表与减除额（只读，salary:manage）
  app.get('/api/salary/tax/config', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.getTaxConfig(req.query?.asOfDate));
  }));

  // 个税登记（抚养人 / 税号 / 居民身份）
  app.get('/api/salary/tax/profiles', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.listTaxProfiles(req.query || {}));
  }));

  app.post('/api/salary/tax/profiles', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.saveTaxProfile(req.body || {}, req.user.id), '个税登记已保存');
  }));

  app.delete('/api/salary/tax/profiles/:id', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.deleteTaxProfile(req.params.id), '已删除');
  }));

  // 个税试算（不落库）
  app.post('/api/salary/tax/preview', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.previewPit(req.body || {}));
  }));

  // ---------------- 个税口径维护（2026-10-28 用户口径：法律常变，金额都要能改） ----------------
  // 开关 + 两项减除额
  app.put('/api/salary/tax/config', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const r = await salary.saveTaxSettings(req.body || {}, req.user.id);
    return ok(reply, r, '个税口径已保存，重算工资单后生效');
  }));

  // 税率表版本清单
  app.get('/api/salary/tax/brackets', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, { list: await salary.listTaxBracketVersions() });
  }));

  // 某一版明细（含备注）
  app.get('/api/salary/tax/brackets/:effectiveFrom', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    return ok(reply, await salary.getTaxBracketVersion(req.params.effectiveFrom));
  }));

  // 保存一版（按生效日整版覆盖，不动历史）
  app.put('/api/salary/tax/brackets', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const r = await salary.saveTaxBracketVersion(req.body || {}, req.user.id);
    return ok(reply, r, r.message);
  }));

  // 删除一版
  app.delete('/api/salary/tax/brackets/:effectiveFrom', { preHandler: requirePermission('salary:manage') }, wrap(async (req, reply) => {
    const r = await salary.deleteTaxBracketVersion(req.params.effectiveFrom);
    return ok(reply, r, '已删除该版税率表');
  }));
}
