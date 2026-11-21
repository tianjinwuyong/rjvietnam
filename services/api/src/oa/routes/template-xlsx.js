// ============================================================
// 导入模板（服务端生成 .xlsx，带下拉选）
// ------------------------------------------------------------
// 为什么不散在各个路由文件里：
//   · 这 4 份模板原来是浏览器端现拼的，列定义 + 示例行 + 说明页散在 4 个压缩产物里；
//     挪到服务端后集中一处，改列定义只改 template-xlsx.js 一个地方；
//   · 模板是**纯读**接口，权限沿用模块前缀闸门（/api/equipment、/api/org 等），
//     这里只挂 authenticate，与改造前 GET /api/xxx/template 的力度完全一致。
//
// 路由前缀注意：
//   /api/attendance/schedule/template.xlsx 与既有的 /template（JSON 列定义）并存 ——
//   老前端还在用 JSON 版自己拼表，新前端走服务端版；两条路都保留，不动老接口。
// ============================================================
import { authenticate, wrap } from '../middleware/index.js';
import { resolveLang } from '../i18n/lang.js';
import {
  buildScheduleImportXlsx,
  buildEquipmentImportXlsx,
  buildOrgImportXlsx,
  buildOnboardingImportXlsx,
} from '../services/template-xlsx.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 附件下载头：filename* 兼容中文，且强制浏览器下载而非预览 */
function sendXlsx(reply, buf, filename) {
  reply.header('Content-Type', XLSX_MIME);
  reply.header('Content-Disposition',
    `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  reply.header('Cache-Control', 'no-store');
  return reply.send(buf);
}

/** 文件名跟着界面语言走（与改造前浏览器端生成的文件名保持一致，别让人以为换了东西） */
function pickName(lang, zh, other) {
  return lang === 'zh' ? zh : other;
}

export default async function templateXlsxRoutes(app) {
  app.addHook('preHandler', authenticate);

  /** 排班导入模板（考勤排班页） */
  app.get('/api/attendance/schedule/template.xlsx', wrap(async (req, reply) => {
    const lang = resolveLang(req);
    const buf = await buildScheduleImportXlsx(lang);
    return sendXlsx(reply, buf, pickName(lang, '排班导入模板.xlsx', 'schedule-import-template.xlsx'));
  }));

  /** 设备台账导入模板 */
  app.get('/api/equipment/template.xlsx', wrap(async (req, reply) => {
    const lang = resolveLang(req);
    const buf = await buildEquipmentImportXlsx(lang);
    return sendXlsx(reply, buf, pickName(lang, '设备导入模板.xlsx', 'equipment-template.xlsx'));
  }));

  /** 人员信息导入模板 */
  app.get('/api/org/import/template.xlsx', wrap(async (req, reply) => {
    const lang = resolveLang(req);
    const buf = await buildOrgImportXlsx(lang);
    return sendXlsx(reply, buf, pickName(lang, '人员导入模板.xlsx', 'org-import-template.xlsx'));
  }));

  /** 入职登记导入模板 */
  app.get('/api/onboardings/template.xlsx', wrap(async (req, reply) => {
    const lang = resolveLang(req);
    const buf = await buildOnboardingImportXlsx(lang);
    return sendXlsx(reply, buf, pickName(lang, '入职登记导入模板.xlsx', 'onboarding-import-template.xlsx'));
  }));
}
