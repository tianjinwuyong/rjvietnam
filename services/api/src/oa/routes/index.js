import authRoutes from './auth.js';
import flowRoutes from './flow.js';
import systemRoutes from './system.js';
import docRoutes from './doc.js';
import docImportRoutes from './doc-import.js';
import modulesRoutes from './modules.js';
import trainingRoutes from './training.js';
import examRoutes from './exam.js';
import driveRoutes from './drive.js';
import attendanceRoutes from './attendance.js';
import meetingRoutes from './meeting.js';
import templateFieldRoutes from './template-field.js';
import stocktakeRoutes from './stocktake.js';
import qualityRoutes from './quality.js';
import oaIqcRoutes from './oa-iqc.js';
import oaMrbRoutes from './oa-mrb.js';
import oqcRoutes from './oqc.js';
import qcLibraryRoutes from './qc-library.js';
import integrationRoutes from './integration.js';
import openRoutes from './open.js';
import payrollRoutes from './payroll.js';
import permissionRoutes from './permissions.js';
import schedulePlanRoutes from './schedule-plan.js';
// 导入模板（服务端生成 .xlsx，班次/频率/状态/部门等固定取值字段带下拉选）
import templateXlsxRoutes from './template-xlsx.js';

export async function registerRoutes(app) {
  await app.register(authRoutes, { prefix: '' });
  await app.register(flowRoutes, { prefix: '' });
  await app.register(systemRoutes, { prefix: '' });
  await app.register(docRoutes, { prefix: '' });
  // 正文导入：docx → 保真 HTML（保留字号/字体/颜色/对齐/缩进/边框）—— /api/doc-import/*
  await app.register(docImportRoutes, { prefix: '' });
  await app.register(modulesRoutes, { prefix: '' });
  // 培训考证（岗前/在岗：计划 + 记录 + 按员工查询）——新增子路径 /api/training/plans*、/records*
  await app.register(trainingRoutes, { prefix: '' });
  // 在线考试（考试定义 / 题库 / 答卷 / 倒计时）—— /api/exams*
  await app.register(examRoutes, { prefix: '' });
  await app.register(driveRoutes, { prefix: '' });
  // S5：员工考勤管理 + 薪资架构（新增模块）
  await app.register(attendanceRoutes, { prefix: '' });
  // 会议模块（一期：系列/会议/参会人/纪要/决议/待办/交付件/会前回顾/跟进表）
  await app.register(meetingRoutes, { prefix: '' });
  // 模板自定义字段（第 38 轮：点检/IPQC/首件 横向字段可配置）
  await app.register(templateFieldRoutes, { prefix: '' });
  // 设备盘点（设备管理卡 V1.0：范围预览/创建/两段审批/扫码核对/报告）
  await app.register(stocktakeRoutes, { prefix: '' });
  // 品质总览：WMS IQC 检验看板接入（/api/quality/wms-iqc/*，只读）
  await app.register(qualityRoutes, { prefix: '' });
  // IQC 检验（P1：OA 接管检验执行；含 WMS 待检推送的入站接口）
  await app.register(oaIqcRoutes, { prefix: '' });
  // MRB 评审（P2：WMS 建单推 OA，审批结论回填 WMS）
  await app.register(oaMrbRoutes, { prefix: '' });
  // 出货检验（OQC）：抽样方案走 WMS 单点计算
  await app.register(oqcRoutes, { prefix: '' });
  // IQC / OQC 检验模板库（模板 + 检验项 + 标准项目池 + 物料绑定）
  await app.register(qcLibraryRoutes, { prefix: '' });
  // 对接配置中心（WMS 等外部系统连接参数，管理员在 /integration-setup.html 配置）
  await app.register(integrationRoutes, { prefix: '' });
  // 对外统一 API（WMS/MES 等外部系统，x-api-key 鉴权）
  await app.register(openRoutes, { prefix: '' });
  // 薪资 v2（月薪制 + 14 段倍率 + 分险种社保 + 免税个税 + 首月递延）—— /api/payroll/*
  await app.register(payrollRoutes, { prefix: '' });
  // 模块级权限（浏览/操作/无权限）：/api/permissions/*
  await app.register(permissionRoutes, { prefix: '' });
  // 排班计划（部门提报 → HR 确认 → 回写生效排班）：/api/schedule-plan/*
  // 独立前缀是为了让「提报权」与「直改生效排班的权力(attend:schedule)」物理分开
  await app.register(schedulePlanRoutes, { prefix: '' });
  // 导入模板（.xlsx）：模板列定义与下拉选都在服务端生成，见 services/template-xlsx.js
  await app.register(templateXlsxRoutes, { prefix: '' });
}