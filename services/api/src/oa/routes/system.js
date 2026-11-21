import { authenticate, ok, wrap, requirePermission } from '../middleware/index.js';
import { many, one, query } from '../db/index.js';
import { toId } from '../utils/params.js';
import { grantAdminRole, revokeAdminRole, reconcileAdminFlag, isDeptManagerOrAbove } from '../utils/admin.js';
import { config } from '../config/index.js';
import { notify } from '../services/notify.js';
import {
  orgImportTemplate, importOrg, exportOrg, listPositionDict,
} from '../services/org-import-service.js';
import {
  listPositionDictAll, createPosition, updatePosition, deletePosition,
  listSectionDepartments, getActivePositionByCode,
} from '../services/position-service.js';
import { isAdminUser, hasAdminRole } from '../utils/admin.js';
import { checkDisableBlockers, listDisableBlockers } from '../services/handover-service.js';
import {
  listMinutes, getMinutes, createMinutes, updateMinutes, deleteMinutes,
  minutesTemplate, importMinutes, exportMinutes,
} from '../services/minutes-service.js';
import { stagingTempAbs, absFromRel } from '../services/drive-service.js';
import { authorizeFileDownload, denyMessage } from '../middleware/file-access.js';
import { recordTransfer, listTransfers } from '../services/org-transfer-service.js';
import {
  listOnboardings, getOnboarding, createOnboarding, updateOnboarding,
  confirmOnboarding, cancelOnboarding, importOnboardings, batchConfirmOnboardings,
} from '../services/onboarding-service.js';
import {
  revealSensitive, listViewers, addViewer, removeViewer, listLogs as listSensitiveLogs,
} from '../services/sensitive-service.js';
import { invalidateCardRuleCache } from '../services/attendance-service.js';
import { DOWNLOAD_MIME } from '../utils/mime.js';
import fs from 'node:fs';
import path from 'node:path';

// 下载/落库共用的 MIME 表见 utils/mime.js（原来这里内联了一份，已抽取避免两处漂移）

/**
 * mimetype → 扩展名（上传时 filename 无扩展名的兜底）
 * 只覆盖移动端拍照/相册常见类型，未列出的继续按「不支持」拒绝。
 */
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

/**
 * 统一管理员真值（用户建/改专用）：
 *   入参 isAdmin/is_admin 明确给出时，据此授予/撤销 admin 角色；
 *   未给出时，把 org_user.is_admin 标志列回写为角色表真值，保证两源永不分叉。
 * @param {number} userId
 * @param {object} body 请求体
 */
async function applyAdminFlag(userId, body) {
  const raw = body?.isAdmin ?? body?.is_admin;
  if (raw === true) return grantAdminRole(userId);
  if (raw === false) return revokeAdminRole(userId);
  return reconcileAdminFlag(userId);
}

/**
 * 账号管理权限（可触碰管理员身份）：管理员或 system:manage。
 * 与「组织主数据维护」分开命名，是为了让下面的安全护栏一眼看出边界在哪。
 */
function canManageAccounts(user) {
  return !!user.isAdmin || (user.permissions || []).includes('system:manage');
}

/**
 * 组织主数据写权限：在账号管理之上放开给人事的 org:manage
 * （组织与人员页面内的编辑/新增员工、建部门）。删除类操作仍只走 canManageAccounts。
 */
function canManageOrgData(user) {
  return canManageAccounts(user) || (user.permissions || []).includes('org:manage');
}

/**
 * 请求是否意图变更管理员身份（设 is_admin 标志 / 分配 admin 角色）。
 * 用于拦住「只有 org:manage 的人事把员工提权成管理员」。
 */
function requestsAdmin(body) {
  const flag = body?.isAdmin ?? body?.is_admin;
  return flag === true || hasAdminRole(body?.roleCodes);
}

/**
 * 归一英文名输入（T2 三语改造）：去首尾空格，空串/未传 → null。
 * 英文名**非必填**；存 NULL 时前端 en 环境由 utils/label.js 回退中文。
 * @param {*} v 原始入参
 * @returns {string|null} 归一后的英文名或 null
 */
function normEnName(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * 归一部门编码：去空格 → 转大写 → 只保留字母/数字/下划线/短横线。
 * 编码会拼进体系文件编号前缀（DT-OP-<CODE>- / WB-<CODE>- 等），
 * 出现中文、空格、斜杠都会让取号结果畸形，故入口处强制收敛；清洗后为空则视为清空编码。
 */
function normDeptCode(v) {
  const s = String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  return s || null;
}

/**
 * 校验「部门负责人」候选账号（POST / PUT 共用）。
 *
 * 准入条件必须与流程引擎 services/flow-engine.js 的 resolveDeptLeader 完全一致：
 * 账号存在 + 在职 + 非系统账号。这三条里任一条不满足，引擎都会**静默跳过**这个
 * leader_id 回落到「部门内最高职级」，界面上就显示成「—」，等于设了没设。
 * 所以这里宁可明确拒绝，也不让脏 id 落库。
 *
 * @returns {Promise<{error:string}|{id:string, user:object}>}
 */
async function validateDeptLeader(raw) {
  const id = toId(raw);
  if (!id) return { error: '负责人参数不合法' };
  const u = await one(
    `SELECT id, real_name, department_id, active, COALESCE(is_system, FALSE) AS is_system
       FROM org_user WHERE id = $1`,
    [id]
  );
  if (!u) return { error: '负责人账号不存在' };
  if (u.active !== true) return { error: `「${u.real_name}」已停用，不能担任部门负责人` };
  if (u.is_system) return { error: `「${u.real_name}」是系统账号，不能担任部门负责人` };
  return { id, user: u };
}

export default async function systemRoutes(app) {
  app.addHook('preHandler', authenticate);

  // ---- 组织架构 ----
  // 出参：`d.*` 已包含 name_en（55_i18n_en.sql 新增列）→ 前端 en 环境取英文部门名，
  //       取不到时由 web/src/utils/label.js 的 deptLabel() 回退中文（后端不做语言决策）。
  app.get('/api/departments', wrap(async (req, reply) => {
    const list = await many(
      `SELECT d.*, u.real_name AS leader_name,
              (SELECT COUNT(*)::int FROM org_user
                WHERE department_id = d.id AND active = TRUE
                  AND COALESCE(is_system, FALSE) = FALSE) AS user_count
         FROM org_department d LEFT JOIN org_user u ON u.id = d.leader_id
        WHERE d.active = TRUE ORDER BY d.sort_order, d.id`
    );
    return ok(reply, list);
  }));

  app.post('/api/departments', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) {
      return reply.code(403).send({ code: 1, msg: '无权限' });
    }
    // nameEn：英文部门名，**非必填**（T2 三语改造）。空串/未传 → NULL，en 环境回退中文。
    const { name, nameEn, parentId, code, organization, sortOrder, leaderId: rawLeaderId } = req.body || {};
    if (!name) return reply.code(400).send({ code: 1, msg: '请填写部门名称' });
    // 负责人可选：新建时一并指定（前端部门弹窗暂不传，留给接口/导入用），校验口径同 PUT
    let newLeaderId = null;
    if (rawLeaderId !== undefined && rawLeaderId !== null && rawLeaderId !== '') {
      const v = await validateDeptLeader(rawLeaderId);
      if (v.error) return reply.code(400).send({ code: 1, msg: v.error });
      newLeaderId = v.id;
    }
    // 编码归一 + 唯一性预检（给出「已被某部门使用」的可读提示，而不是抛唯一索引冲突）
    const deptCode = normDeptCode(code);
    if (deptCode) {
      const dup = await one(`SELECT id, name FROM org_department WHERE upper(code) = $1`, [deptCode]);
      if (dup) return reply.code(400).send({ code: 1, msg: `部门编码 ${deptCode} 已被「${dup.name}」使用` });
    }
    const r = await one(
      `INSERT INTO org_department (name, name_en, parent_id, code, organization, sort_order, leader_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, normEnName(nameEn), parentId || null, deptCode, organization || '本公司', sortOrder || 0, newLeaderId]
    );
    return ok(reply, r, '部门已创建');
  }));

  // 编辑部门（T2 新增）：开放 名称 / 英文名 / 上级 / 排序 / 启用状态 / 负责人。
  // code 不可编辑（工段码 SEC_* 与部门码被流程、导入、统计等多处引用）。
  app.put('/api/departments/:id', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) {
      return reply.code(403).send({ code: 1, msg: '无权限' });
    }
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const cur = await one(
      `SELECT id, name, name_en, code, parent_id, sort_order, active, leader_id
         FROM org_department WHERE id = $1`,
      [id]
    );
    if (!cur) return reply.code(404).send({ code: 1, msg: '部门不存在' });

    const body = req.body || {};
    const name = body.name === undefined ? cur.name : String(body.name || '').trim();
    if (!name) return reply.code(400).send({ code: 1, msg: '请填写部门名称' });
    const nameEn = body.nameEn === undefined ? cur.name_en : normEnName(body.nameEn);
    const parentId = body.parentId === undefined ? cur.parent_id : (body.parentId || null);
    // 防环：不能把自己设为自己的上级，也不能挂到自己的下级之下（单层防御，树深 ≤ 3）
    if (parentId !== null && String(parentId) === String(id)) {
      return reply.code(400).send({ code: 1, msg: '上级部门不能是自己' });
    }
    const sortOrder = body.sortOrder === undefined ? cur.sort_order : Number(body.sortOrder) || 0;
    const active = body.active === undefined ? cur.active : (body.active === true || body.active === 'true');

    // 部门负责人（2026-11-03 补）：原接口刻意只开放 名称/英文名/上级/排序/启用，导致
    // 全库 leader_id 无人可改、5 个部门还留着已不存在的旧账号 id，界面永远显示「—」。
    // 校验口径必须与流程引擎 resolveDeptLeader 完全一致 —— 必须「存在 + 在职 + 非系统账号」，
    // 否则引擎会静默跳过这个 leader_id 回落到「部门内最高职级」，设了等于没设。
    let leaderId = cur.leader_id;
    let leaderCrossDept = false;
    if (body.leaderId !== undefined) {
      if (body.leaderId === null || body.leaderId === '') {
        leaderId = null; // 显式清空负责人
      } else {
        const v = await validateDeptLeader(body.leaderId);
        if (v.error) return reply.code(400).send({ code: 1, msg: v.error });
        leaderId = v.id;
        // 跨部门指定不拒绝（上级或管代兼任是常见做法），但要让调用方知道
        leaderCrossDept = v.user.department_id === null || String(v.user.department_id) !== String(id);
      }
    }

    // 部门编码可改（现场诉求：建完就不能改，输错只能重建）。
    // 编码参与体系文件编号前缀（DT-OP-<CODE>- 等），故：① 统一大写归一；
    // ② 全库唯一；③ 改动只影响之后新建文件的取号，已发行文件编号不变（历史不追溯）。
    let code = cur.code;
    if (body.code !== undefined) {
      code = normDeptCode(body.code);
      if (code) {
        const dup = await one(
          `SELECT id, name FROM org_department WHERE upper(code) = $1 AND id <> $2`,
          [code, id]
        );
        if (dup) return reply.code(400).send({ code: 1, msg: `部门编码 ${code} 已被「${dup.name}」使用` });
      }
    }

    const r = await one(
      `UPDATE org_department
          SET name = $2, name_en = $3, parent_id = $4, sort_order = $5, active = $6,
              code = $7, leader_id = $8, updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, name, nameEn, parentId, sortOrder, active, code, leaderId]
    );
    // 回填负责人姓名，省掉前端再查一次（GET 列表里用的是同一个 LEFT JOIN 口径）
    if (leaderId) {
      const lu = await one(`SELECT real_name FROM org_user WHERE id = $1`, [leaderId]);
      r.leader_name = lu ? lu.real_name : null;
    } else {
      r.leader_name = null;
    }
    return ok(reply, r, leaderCrossDept ? '部门已更新（负责人不在本部门）' : '部门已更新');
  }));

  // ---------------------------------------------------------
  // 删除部门
  //   现场诉求：部门建错了必须能删掉重来（此前只有新增/编辑，没有删除）。
  //   护栏（宁可拒绝，不可留悬空引用）：
  //     ① 有下级部门 → 拒绝（先处理子部门）
  //     ② 有员工（含停用账号）→ 拒绝（先把人调走）
  //     ③ 被业务数据引用（文档/设备/考勤/交接/草稿）→ 拒绝并指明是哪类
  //   全部通过才物理删除。权限沿用「删除类只走账号管理权限」的既有口径。
  // ---------------------------------------------------------
  app.delete('/api/departments/:id', wrap(async (req, reply) => {
    if (!canManageAccounts(req.user)) {
      return reply.code(403).send({ code: 1, msg: '无权限（删除部门需账号管理权限）' });
    }
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const dept = await one(`SELECT id, name FROM org_department WHERE id = $1`, [id]);
    if (!dept) return reply.code(404).send({ code: 1, msg: '部门不存在' });

    const child = await one(
      `SELECT count(*)::int n FROM org_department WHERE parent_id = $1`, [id]
    );
    if (child.n > 0) {
      return reply.code(400).send({ code: 1, msg: `「${dept.name}」下还有 ${child.n} 个下级部门，请先删除或移走下级部门` });
    }

    const staff = await one(
      `SELECT count(*)::int n FROM org_user
        WHERE department_id = $1 AND COALESCE(is_system, FALSE) = FALSE`,
      [id]
    );
    if (staff.n > 0) {
      return reply.code(400).send({ code: 1, msg: `「${dept.name}」下还有 ${staff.n} 名员工，请先把员工调到其他部门` });
    }

    // 业务引用逐项检查（列名固定，无用户输入拼接）
    const refs = [
      ['doc_system', 'owner_dept_id', '体系文件'],
      ['doc_draft', 'owner_dept_id', '文件草稿'],
      ['doc_issue_record', 'dept_id', '文件发行记录'],
      ['equipment', 'department_id', '设备'],
      ['attendance_day_override', 'department_id', '考勤日结调整'],
      ['work_handover', 'dept_id', '工作交接'],
    ];
    for (const [table, col, label] of refs) {
      const hit = await one(`SELECT count(*)::int n FROM ${table} WHERE ${col} = $1`, [id]);
      if (hit.n > 0) {
        return reply.code(400).send({ code: 1, msg: `「${dept.name}」已被 ${hit.n} 条${label}数据引用，不能删除；如需停用请编辑后取消启用` });
      }
    }

    await query(`DELETE FROM org_department WHERE id = $1`, [id]);
    return ok(reply, { id }, '部门已删除');
  }));

  // ---------------------------------------------------------
  // 员工入职登记（确认入职即自动建号，并出现在「组织与人员」）
  //   动线：录入入职信息 →（可留待入职核对）→ 确认入职 → 建 org_user（工号+初始密码）
  //   权限：与组织维护一致（管理员或 org:manage）
  // ---------------------------------------------------------
  app.get('/api/onboardings', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const { status, keyword, page, size } = req.query || {};
    return ok(reply, await listOnboardings({ status, keyword, page, size }));
  }));

  // 批量导入（存量在职员工）：静态段必须早于 /:id，否则会被动态段吞掉
  app.post('/api/onboardings/import', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const rows = req.body?.rows || [];
    if (!Array.isArray(rows)) return reply.code(400).send({ code: 1, msg: '导入数据格式不正确' });
    if (rows.length > 500) return reply.code(400).send({ code: 1, msg: '单次最多导入 500 行，请分批导入' });
    const r = await importOnboardings(rows, req.user.id);
    const msg = `导入完成：新增 ${r.created} 条，失败 ${r.failed} 条`;
    return ok(reply, r, msg);
  }));

  // 批量确认入职（导入后一次性建号）
  app.post('/api/onboardings/batch-confirm', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const ids = req.body?.ids || [];
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ code: 1, msg: '请选择要确认入职的登记' });
    if (ids.length > 200) return reply.code(400).send({ code: 1, msg: '单次最多确认 200 人，请分批操作' });
    const r = await batchConfirmOnboardings(ids, req.user.id);
    const parts = [`已确认入职 ${r.success} 人`];
    if (r.merged) parts.push(`其中 ${r.merged} 条为重复登记（已自动作废并指向已有入职记录）`);
    if (r.linked) parts.push(`${r.linked} 人账号已存在（仅补齐登记，未新建账号）`);
    if (r.failed) parts.push(`失败 ${r.failed} 人`);
    return ok(reply, r, parts.join('，'));
  }));

  // 授权查看敏感信息（身份证号）：需现场输入被授权账号的账号+密码
  app.post('/api/onboardings/:id/reveal', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const { username, password } = req.body || {};
    const r = await revealSensitive({
      username, password, targetType: 'onboarding', targetId: id,
      ip: req.ip || req.headers['x-forwarded-for'] || null,
    });
    return ok(reply, r, '已验证，敏感信息仅本次显示');
  }));

  app.get('/api/onboardings/:id', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await getOnboarding(id));
  }));

  app.post('/api/onboardings', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    return ok(reply, await createOnboarding(req.body || {}, req.user.id), '入职登记已保存');
  }));

  app.put('/api/onboardings/:id', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await updateOnboarding(id, req.body || {}), '已保存');
  }));

  // 确认入职：建账号（幂等，重复点击会被拦）
  app.post('/api/onboardings/:id/confirm', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await confirmOnboarding(id, req.user.id);
    if (r.duplicate) {
      return ok(reply, r, `该员工已由登记 #${r.mergedInto.id}（工号 ${r.mergedInto.employeeNo}）办理入职，本条属于重复登记，已自动作废并留痕，密码未变更`);
    }
    if (r.linked) {
      return ok(reply, r, `该员工账号已存在（工号 ${r.employeeNo}），本次仅补齐入职登记，未新建账号、密码未变更`);
    }
    return ok(reply, r, '已完成入职并创建账号');
  }));

  // 作废登记（仅待入职可作废）
  app.post('/api/onboardings/:id/cancel', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await cancelOnboarding(id), '登记已作废');
  }));

  // ---------------------------------------------------------
  // 敏感信息授权查看：授权人清单（仅系统管理员可维护）+ 查看审计
  // ---------------------------------------------------------
  app.get('/api/sensitive-viewers', wrap(async (req, reply) => {
    if (!req.user.isAdmin) return reply.code(403).send({ code: 1, msg: '仅系统管理员可查看授权清单' });
    return ok(reply, await listViewers());
  }));

  app.post('/api/sensitive-viewers', wrap(async (req, reply) => {
    if (!req.user.isAdmin) return reply.code(403).send({ code: 1, msg: '仅系统管理员可授权' });
    const userId = toId(req.body?.userId);
    if (!userId) return reply.code(400).send({ code: 1, msg: '请选择要授权的人员' });
    return ok(reply, await addViewer(userId, req.user.id, req.body?.remark || null), '已授权');
  }));

  app.delete('/api/sensitive-viewers/:userId', wrap(async (req, reply) => {
    if (!req.user.isAdmin) return reply.code(403).send({ code: 1, msg: '仅系统管理员可取消授权' });
    const userId = toId(req.params.userId);
    if (!userId) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    return ok(reply, await removeViewer(userId), '已取消授权');
  }));

  app.get('/api/sensitive-logs', wrap(async (req, reply) => {
    if (!req.user.isAdmin) return reply.code(403).send({ code: 1, msg: '仅系统管理员可查看审计日志' });
    return ok(reply, await listSensitiveLogs({ limit: req.query?.limit }));
  }));

  // ---- 用户 ----
  // scope：all（默认，管理页要能管到 admin/wms_bot 这类账号）/ employee（只要员工）/ system（只要系统账号）
  // 系统账号不是员工、不参与工资核算与考勤，业务侧一律用 scope=employee 或 v_employee_roster。
  app.get('/api/users', wrap(async (req, reply) => {
    const { keyword, departmentId, organization } = req.query || {};
    const scope = String(req.query?.scope || 'all').toLowerCase();
    const params = [];
    let where = 'WHERE u.active = TRUE';
    if (scope === 'employee') where += ' AND COALESCE(u.is_system, FALSE) = FALSE';
    else if (scope === 'system') where += ' AND COALESCE(u.is_system, FALSE) = TRUE';
    if (keyword) { params.push(`%${keyword}%`); where += ` AND (u.real_name ILIKE $${params.length} OR u.username ILIKE $${params.length})`; }
    if (departmentId) { params.push(departmentId); where += ` AND u.department_id = $${params.length}`; }
    if (organization) { params.push(organization); where += ` AND u.organization = $${params.length}`; }

    const list = await many(
      `SELECT u.id, u.username, u.employee_no, u.real_name, u.email, u.phone, u.position,
              u.position_code, u.department_id,
              u.organization, u.is_admin, u.is_external, u.is_system, u.manager_id, u.active, u.last_login_at,
              u.must_change_pwd AS must_change_pwd,
              u.salary_class_id, u.attendance_rule_code,
              d.name AS dept_name, d.name_en AS dept_name_en,
              m.real_name AS manager_name,
              -- 入职日期/试用期：以入职登记（确认入职时回写）为准，
              -- 登记缺失时兜底用账号上的 hire_date（迁移 110 起两侧触发器同步）
              COALESCE(ob.hire_date, u.hire_date) AS hire_date,
              ob.probation_days, ob.id AS onboarding_id
         FROM org_user u
         LEFT JOIN org_department d ON d.id = u.department_id
         LEFT JOIN org_user m ON m.id = u.manager_id
         LEFT JOIN employee_onboarding ob ON ob.user_id = u.id
         ${where} ORDER BY u.id LIMIT 500`,
      params
    );

    // 手机号字段鉴权（用户口径 2026-10-12）：仅「部门经理及以上」可见，其余人返回 null。
    // 注意：不删除 phone 字段，仅置空 —— 避免前端 `u.phone` 取值异常。
    // 本接口是通用人员列表（选人/选参会人等都依赖），普通员工仍须能拿到列表，故不整体 403。
    const canSeePhone = await isDeptManagerOrAbove(req.user.id);
    const data = canSeePhone
      ? list
      : list.map(({ phone, ...rest }) => ({ ...rest, phone: null }));

    return ok(reply, data);
  }));

  app.post('/api/users', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) {
      return reply.code(403).send({ code: 1, msg: '无权限' });
    }
    // 安全护栏：仅 org:manage 的人事只能建普通账号，提权类请求仍须 system:manage/admin
    if (!canManageAccounts(req.user) && requestsAdmin(req.body)) {
      return reply.code(403).send({ code: 1, msg: '仅有组织管理权限，不能创建管理员账号或分配管理员角色' });
    }
    const { username, realName, email, phone, departmentId, position, positionCode, organization,
            managerId, isExternal, initialPassword,
            salaryClassId, attendanceRuleCode } = req.body || {};
    if (!realName) return reply.code(400).send({ code: 1, msg: '请填写姓名' });

    // 默认角色：所有员工账号至少要有 employee（含 flow:submit / flow:view）。
    // 不传 roleCodes 或传空数组时兜底成 ['employee']——否则建出来的账号权限为空，
    // 连休假单、Near Miss 都提不了（2026-10-28 实测 35 个账号 100% 无角色）。
    // 用户口径 2026-11-03：employee 是「基础权限」，不可移除 —— 即使显式传了别的角色
    // （如只勾「管理者代表」），也要补回 employee，避免建出「有岗无权」的账号。
    let roleCodes = req.body?.roleCodes;
    if (!Array.isArray(roleCodes) || roleCodes.length === 0) roleCodes = ['employee'];
    roleCodes = [...new Set(roleCodes.map(String).map(s => s.trim()).filter(Boolean))];
    if (!roleCodes.includes('employee')) roleCodes.push('employee');

    // 岗位必填（用户口径 2026-10-12）：position_code 是「流程按岗位找人」（flow-engine 按
    // position_code 解析审批人）与「培训按岗位导入员工」的依据；缺岗位的账号会掉队
    // （收不到对应流程、进不了培训名单），故新增用户必须指定岗位。
    const codeInput = (positionCode === undefined || positionCode === null) ? '' : String(positionCode).trim();
    if (!codeInput) {
      return reply.code(400).send({ code: 1, msg: '请选择岗位（岗位是流程指派与培训导入的依据，必填）' });
    }
    // 必须命中字典中**启用中**的岗位，保证 org_user.position_code 永不写入无效 code（规格 §1.7）
    const hit = await getActivePositionByCode(codeInput);
    if (!hit) {
      return reply.code(400).send({ code: 1, msg: `岗位编码「${codeInput}」不存在或已停用，请从岗位字典中选择` });
    }
    const finalPositionCode = hit.code;
    const syncedPositionName = hit.name_zh; // 用于下方 position 自由文本同步

    // position（自由文本，展示用）与 position_code（机器用）并存：
    // 若显式传了 position 则以此为准；否则当传了合法 positionCode 时，自动把 position 同步为该岗位的 name_zh，
    // 避免出现「码有值、文本为空」的不一致展示。
    const finalPosition = (position === undefined || position === null || String(position).trim() === '')
      ? (syncedPositionName || null)
      : position;

    const { hashPassword, nextEmployeeNo } = await import('../services/auth.js');

    // 工号自动生成（续 DT 序号之后）；账号默认 = 工号
    const employeeNo = await nextEmployeeNo();
    const finalUsername = username || employeeNo;

    // 初始密码走合规配置（新建/导入专用，不校验复杂度）；置 must_change_pwd = TRUE
    const pwd = initialPassword || config.security.initialPassword;
    const hash = await hashPassword(pwd);

    const u = await one(
      `INSERT INTO org_user (username, employee_no, password_hash, real_name, email, phone, department_id,
                             position, position_code, organization, manager_id, is_external, must_change_pwd,
                             salary_class_id, attendance_rule_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,$13,$14) RETURNING *`,
      [finalUsername, employeeNo, hash, realName, email || null, phone || null, departmentId || null,
       finalPosition, finalPositionCode, organization || '本公司', managerId || null, !!isExternal,
       salaryClassId ? Number(salaryClassId) : null, attendanceRuleCode || null]
    );
    for (const rc of roleCodes) {
      const r = await one(`SELECT id FROM sys_role WHERE code=$1`, [rc]);
      if (r) await query(`INSERT INTO sys_user_role (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.id, r.id]);
    }
    // 管理员真值一致性：入参 isAdmin/is_admin 优先；否则标志列跟随角色表
    await applyAdminFlag(u.id, req.body);
    return ok(reply, { id: u.id, username: finalUsername, employeeNo, initialPassword: pwd, mustChangePwd: true }, '用户已创建');
  }));

  app.put('/api/users/:id', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) {
      return reply.code(403).send({ code: 1, msg: '无权限' });
    }
    const id = toId(req.params.id);
    // 安全护栏：仅 org:manage 的人事不得编辑管理员账号，也不得把任何人提权为管理员
    if (!canManageAccounts(req.user)
      && (requestsAdmin(req.body) || await isAdminUser(id))) {
      return reply.code(403).send({ code: 1, msg: '仅有组织管理权限，不能修改管理员账号或授予管理员身份' });
    }
    const { realName, email, phone, departmentId, position, organization, managerId, isExternal, active,
            salaryClassId, attendanceRuleCode } = req.body || {};

    // ---- 工作交接阻断校验（D4，第 37 轮新增）----
    // 将 active 由 true 改为 false（停用/离职）时，若仍有在途待办或未完成的交接单，
    // 默认拒绝并要求先发起工作交接；管理员显式传 forceDisable=true 方可强制停用（写审计日志）。
    // 零副作用：无在途事项时，行为与改造前逐位一致（单条聚合查询，不产生任何写入）。
    if (active === false) {
      const cur = await one(`SELECT active, real_name FROM org_user WHERE id = $1`, [id]);
      if (cur && cur.active === true) {
        const blockers = await checkDisableBlockers(id);
        if (blockers.total > 0) {
          const force = req.body?.forceDisable === true;
          if (!force) {
            const details = await listDisableBlockers(id);
            return reply.code(409).send({
              code: 1,
              needHandover: true,
              blockers,
              items: details.map(d => ({
                node_name: d.node_name, instance_no: d.instance_no,
                title: d.title, def_name: d.def_name,
              })),
              msg: `该员工有 ${blockers.total} 项待交接事项（在途待办 ${blockers.todo} / 未完成交接单 ${blockers.handover}），请先发起工作交接，或由管理员确认强制停用`,
            });
          }
          // 强制停用：写审计日志 + 通知人事，绝不静默
          await query(
            `INSERT INTO notification (user_id, title, content, category)
             VALUES ($1, $2, $3, 'system')`,
            [
              req.user.id,
              '【强制停用账号】',
              `员工「${cur.real_name}」(#${id}) 存在 ${blockers.total} 项未交接事项，已被强制停用（在途待办 ${blockers.todo} / 交接单 ${blockers.handover}）。`,
            ]
          ).catch(() => {});
          console.warn(
            `[handover] 强制停用账号 id=${id} name=${cur.real_name} by=${req.user.id} blockers=${JSON.stringify(blockers)}`
          );
        }
      }
    }

    // 岗位更新语义（修正 2026-10-13，第 35 轮全量测试发现）：
    //   · 未传 positionCode（undefined）→ 保持原值不变（**不得**因一次无关编辑如只改电话/停用账号就报 400）
    //   · 显式传 ''/null            → 置空（允许，但会触发「流程按岗位找人」失效，由前端约束）
    //   · 传非空                    → 必须命中「启用中」岗位，否则 400；若与该用户现有岗位相同（可能已停用）也放行
    // 历史问题：第 31 轮曾把三条分支收敛为「必须传且合法」，导致任何部分更新
    //   （{active:false} / {phone} / 仅角色变更）都返回 400，账号停用功能被彻底打断。
    const curUser = await one(`SELECT department_id, position_code, position FROM org_user WHERE id = $1`, [id]);
    if (!curUser) return reply.code(404).send({ code: 1, msg: '用户不存在' });

    const codeRaw = req.body?.positionCode;
    const codeProvided = !(codeRaw === undefined);
    let codeClause = null;   // null 表示 SQL 中不更新 position_code
    let codeParam = null;
    let syncedPositionName = null;

    if (codeProvided) {
      const codeTrim = (codeRaw === null) ? '' : String(codeRaw).trim();
      if (codeTrim) {
        // 非空：必须命中「启用中」岗位；或与现有岗位一致（容忍已停用的老岗位维持不变）
        let hit = await getActivePositionByCode(codeTrim);
        if (!hit && String(curUser.position_code || '') === codeTrim) {
          hit = await one(`SELECT code, name_zh FROM sys_i18n_dict WHERE dict_type = 'position' AND code = $1`, [codeTrim]);
        }
        if (!hit) {
          return reply.code(400).send({ code: 1, msg: `岗位编码「${codeTrim}」不存在或已停用，请从岗位字典中选择` });
        }
        codeClause = 'position_code=$11';
        codeParam = hit.code;
        syncedPositionName = hit.name_zh;
      } else {
        // 显式清空
        codeClause = 'position_code=NULL';
      }
    }

    // position 同步：仅在「传了合法 positionCode」且「未显式传 position」时回填 name_zh；
    // 其余情况沿用 COALESCE 原语义（显式传值则更新，未传则保持）。
    const positionArg = (syncedPositionName && (position === undefined || position === null || String(position).trim() === ''))
      ? syncedPositionName
      : position;

    // 基础 10 个参数；仅当需要更新岗位码时追加第 11 个参数（占位符与参数个数必须严格一致，否则 pg 报 08P01）
    const sqlParams = [id, realName, email, phone, departmentId, positionArg, organization, managerId || null, isExternal, active];
    if (codeParam !== null) sqlParams.push(codeParam);

    await query(
      `UPDATE org_user SET real_name=COALESCE($2,real_name), email=COALESCE($3,email),
              phone=COALESCE($4,phone), department_id=COALESCE($5,department_id),
              position=COALESCE($6,position), organization=COALESCE($7,organization),
              manager_id=$8, is_external=COALESCE($9,is_external), active=COALESCE($10,active)${codeClause ? `,
              ${codeClause}` : ''},
              updated_at=now()
        WHERE id=$1`,
      sqlParams
    );
    // 员工匹配（批次 D）：salary_class_id / attendance_rule_code 按「显式提供才更新」处理（含置空）。
    // 与 position_code 语义一致：无关的部分更新（如只停用账号）不得把这两列清空。
    const hasSalaryClass = Object.prototype.hasOwnProperty.call(req.body, 'salaryClassId');
    const hasAttRule = Object.prototype.hasOwnProperty.call(req.body, 'attendanceRuleCode');
    if (hasSalaryClass || hasAttRule) {
      await query(
        `UPDATE org_user SET
           salary_class_id = CASE WHEN $2::boolean THEN $3::bigint ELSE salary_class_id END,
           attendance_rule_code = CASE WHEN $4::boolean THEN $5::text ELSE attendance_rule_code END,
           updated_at = now()
         WHERE id = $1`,
        [id, hasSalaryClass, salaryClassId ? Number(salaryClassId) : null, hasAttRule, attendanceRuleCode || null]
      );
      // 打卡规则缓存按 userId 缓存，改码后须失效，避免继续读到旧规则
      if (hasAttRule) invalidateCardRuleCache();
    }

    if (Array.isArray(req.body?.roleCodes)) {
      // 基础角色不可移除（用户口径 2026-11-03）：
      // 前端角色选择器是「整体覆盖」语义 —— 提交什么，最终就只剩什么。若用户只勾了
      // 「管理者代表」，原有的 employee 会被一并删掉，账号立刻失去流程提交/查看等基础权限。
      // 这里兜一层：无论提交什么，employee 始终保留。
      const codes = [...new Set(req.body.roleCodes.map(String).map(s => s.trim()).filter(Boolean))];
      if (!codes.includes('employee')) codes.push('employee');
      await query(`DELETE FROM sys_user_role WHERE user_id=$1`, [id]);
      for (const rc of codes) {
        const r = await one(`SELECT id FROM sys_role WHERE code=$1`, [rc]);
        if (r) await query(`INSERT INTO sys_user_role (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, r.id]);
      }
    }
    // 管理员真值一致性：入参 isAdmin/is_admin 优先；否则标志列跟随角色表
    await applyAdminFlag(id, req.body);

    // 调岗留痕（旁路）：部门或岗位真的变了才记一条。
    // 读回变更后的真实值再比对，避免被 COALESCE 语义（传 null = 不修改）误导。
    // 留痕失败绝不影响保存结果，只记日志。
    try {
      const after = await one(
        `SELECT department_id, position_code, position FROM org_user WHERE id = $1`, [id]
      );
      if (after) {
        await recordTransfer({
          userId: id,
          before: {
            deptId: curUser.department_id, positionCode: curUser.position_code, positionName: curUser.position,
          },
          after: {
            deptId: after.department_id, positionCode: after.position_code, positionName: after.position,
          },
          operatorId: req.user.id,
          reason: req.body?.transferReason ? String(req.body.transferReason).trim().slice(0, 500) : null,
          source: 'manual',
        });
      }
    } catch (err) {
      req.log.warn({ err, userId: id }, '调岗留痕写入失败（不影响保存）');
    }
    return ok(reply, null, '已保存');
  }));

  // 某员工的调岗历史（部门/岗位变更留痕）
  app.get('/api/users/:id/transfers', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const user = await one(`SELECT id, real_name, username FROM org_user WHERE id = $1`, [id]);
    if (!user) return reply.code(404).send({ code: 1, msg: '员工不存在' });
    return ok(reply, { user, list: await listTransfers(id, { limit: req.query?.limit }) });
  }));

  // 重置密码（2026-11-04 用户口径：改成固定密码，随机串不好记）
  // 口径与「新建用户」统一：一律 config.security.initialPassword（默认 oa@123456），
  // 并置 must_change_pwd=TRUE —— 前端路由守卫会强制跳 /first-login 自行改密，
  // 因此「好记」只用于第一次登录，改完各人密码互不相同。
  app.post('/api/users/:id/reset-password', wrap(async (req, reply) => {
    if (!canManageOrgData(req.user)) return reply.code(403).send({ code: 1, msg: '无权限' });
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    // 安全护栏：管理员密码只能由 system:manage/admin 重置，人事不得接管管理员账号
    if (!canManageAccounts(req.user) && await isAdminUser(id)) {
      return reply.code(403).send({ code: 1, msg: '仅有组织管理权限，不能重置管理员账号的密码' });
    }
    const target = await one(`SELECT id FROM org_user WHERE id = $1`, [id]);
    if (!target) return reply.code(404).send({ code: 1, msg: '员工不存在' });
    const pwd = config.security.initialPassword;
    const { hashPassword } = await import('../services/auth.js');
    await query(
      `UPDATE org_user SET password_hash=$1, must_change_pwd=TRUE, pwd_changed_at=NULL, updated_at=now()
        WHERE id=$2`,
      [await hashPassword(pwd), id]
    );
    // 重置即失效该用户所有在线会话，避免旧 token 绕过「首次登录须改密」。
    // 例外：重置自己的密码时保留当前会话（否则一点按钮就把自己踢下线，
    // 且 must_change_pwd=TRUE 已能在下次路由跳转时强制改密）。
    if (Number(id) !== Number(req.user.id)) {
      await query(`DELETE FROM sys_session WHERE user_id = $1`, [id]);
    }
    return ok(reply, { password: pwd, mustChangePwd: true }, '密码已重置，请转告用户首次登录后修改');
  }));

  // 角色与权限列表
  app.get('/api/roles', wrap(async (req, reply) => {
    const roles = await many(`SELECT * FROM sys_role ORDER BY built_in DESC, id`);
    const perms = await many(`SELECT * FROM sys_permission ORDER BY module, id`);
    return ok(reply, { roles, permissions: perms });
  }));

  // ---- 系统参数 ----
  app.get('/api/config', wrap(async (req, reply) => {
    const list = await many(`SELECT key, value, label FROM sys_config ORDER BY key`);
    return ok(reply, list);
  }));

  app.put('/api/config', wrap(async (req, reply) => {
    if (!req.user.isAdmin) return reply.code(403).send({ code: 1, msg: '无权限' });
    const items = req.body?.items || [];
    for (const it of items) {
      await query(
        `INSERT INTO sys_config (key, value, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [it.key, String(it.value)]
      );
    }
    return ok(reply, null, '参数已保存');
  }));

  // ---- 附件上传 ----
  // 层级化存储改造（用户口径 2026-10-12）：
  //   不再自造 `YYYYMM/时间戳-随机hex.ext` 扁平名，而是：
  //   - 目标文件夹由 body/query 的 folderId 指定（公共盘上传）；无 folderId 的通用附件
  //     落在 uploads 根（保持其它模块附件路径简单，且 file_path 记录相对位置便于下载）。
  //   - 文件名 = 用户原文（界面名），磁盘名 = sanitize(原文)，二者一致（除非含非法字符）。
  //   - 重名去重由 drive-service.addFile 在咨询锁内完成（`名称(1).ext`）。
  //   实现：先写「临时名」到 uploads/.staging-tmp/，返回 tempRelPath；调用方随后
  //   POST /api/drive/file（携带 folderId/tempRelPath）→ addFile 在锁内定名并原子更名。
  app.post('/api/upload', wrap(async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ code: 1, msg: '未收到文件' });

    // 手机拍照兜底（2026-10-28）：
    //   部分机型/浏览器（Android WebView、iOS 相机直传）给出的 filename 没有扩展名
    //   （"image"、"blob"），旧逻辑 path.extname 得到 ''，直接被白名单拒成
    //   "不支持的文件类型："，用户表现就是"拍完照片用不了"。
    //   这里按 mimetype 反推扩展名；仍然不认的类型照旧拒绝，不放开安全性。
    let ext = path.extname(file.filename).toLowerCase();
    if (!ext) ext = MIME_TO_EXT[String(file.mimetype || '').toLowerCase()] || '';
    if (!config.upload.allowExt.includes(ext)) {
      return reply.code(400).send({ code: 1, msg: `不支持的文件类型：${ext || file.mimetype || '未知'}` });
    }

    // 必须先消费流再校验大小：@fastify/multipart 的 file.fileSize 在流被读取前恒为 0，
    // 之前在建流阶段判断会导致「大小上限形同虚设」且返回的 fileSize 永远是 0。
    // 超限的硬拦截由 multipart 的 limits.fileSize 兜底（此时 truncated 为 true）。
    const buf = await file.toBuffer();
    if (file.truncated || buf.length > config.upload.maxSize) {
      return reply.code(400).send({ code: 1, msg: '文件超出大小限制' });
    }

    // 暂存到临时名（最终名在落库事务、持锁后确定，避免并发撞名）
    const tempAbs = stagingTempAbs(ext);
    await fs.promises.writeFile(tempAbs, buf);
    const tempRel = path.relative(config.upload.dir, tempAbs).split(path.sep).join('/');

    return ok(reply, {
      fileName: file.filename,
      tempRelPath: tempRel,
      // 兼容字段：旧前端若直接读取 filePath 也有值（= 临时相对路径），不会导致 404 崩溃
      filePath: tempRel,
      fileSize: buf.length,
      mimeType: file.mimetype,
    }, '上传成功');
  }));

  // 附件下载
  app.get('/api/files/*', wrap(async (req, reply) => {
    // 路径归一：旧实现用 `rel.replace(/\.\./g,'')` + path.join 兜穿越，属于「黑名单」式防御；
    // 统一改用 drive-service 已加固的 absFromRel（拒绝 .. 段 / 绝对路径 / 盘符 / 越根，含二次解码校验）。
    const relRaw = (req.params['*'] || '');
    let full;
    try {
      full = absFromRel(relRaw);
    } catch {
      return reply.code(400).send({ code: 1, msg: '非法的文件路径' });
    }
    // 日志与 DB 反查用的统一相对路径（与 attachment.file_path / drive_file.file_path 同形态）
    const rel = path.relative(config.upload.dir, full).split(path.sep).join('/');
    if (!fs.existsSync(full)) return reply.code(404).send({ code: 1, msg: '文件不存在' });

    // ---- 归属授权（B3 修复：原实现只判登录 ⇒ 任意登录用户可下载任意附件 / 公共盘文件）----
    // 分类与判定见 middleware/file-access.js：公共盘走 drive_acl、流程附件走单据可见性、
    // 会议交付件走会议可见性、受控文档走「文档可读且非 secret」，其余业务附件沿用各自模块口径。
    const access = await authorizeFileDownload(rel, req.user);
    if (!access.allowed) {
      if (access.reason === 'doc_secret' && access.doc) {
        // 记录一次被拒绝的下载尝试，供审计（失败不影响主流程）
        await notify(req.user.id, {
          title: `【下载被拒】${access.doc.code}`,
          content: `秘密文件 ${access.doc.code} 禁止下载（已记录本次尝试）。`,
          link: `/docs/${access.doc.id}`,
          category: 'reminder',
        }).catch(() => {});
        return reply.code(403).send({ code: 1, msg: '秘密文件禁止下载' });
      }
      // 无法归类的历史文件 / 越权访问：留痕便于盘点，但不回显内部判定细节
      req.log.warn(
        `[files] 下载被拒 category=${access.category} reason=${access.reason} ` +
        `user=${req.user?.id} path=${rel} ${access.dimension || ''}`
      );
      return reply.code(403).send({ code: 1, msg: denyMessage(access.reason) });
    }

    // 预览走 inline（PDF/图片要在浏览器里直接看）；显式下载（?dl=1）走 attachment，
    // 并且回填**原始文件名** —— 否则用户拿到的落盘名是 uploads 里的哈希名
    // （1793926071327-06dc0cac.xlsx），看不出这是什么文件。
    const wantDownload = String(req.query?.dl || '') === '1';
    let dlName = path.basename(rel);
    if (wantDownload) {
      const row = await one(
        `SELECT file_name FROM attachment WHERE file_path = $1 ORDER BY id DESC LIMIT 1`,
        [rel]
      ).catch(() => null);
      if (row && row.file_name) dlName = row.file_name;
    }
    // filename 给 ASCII 兜底（老浏览器），filename* 给中文原名
    const asciiName = dlName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    reply.header(
      'Content-Disposition',
      `${wantDownload ? 'attachment' : 'inline'}; filename="${asciiName}"; ` +
      `filename*=UTF-8''${encodeURIComponent(dlName)}`
    );
    // F-05：按扩展名强制 Content-Type + nosniff，禁止浏览器猜测类型
    const ct = DOWNLOAD_MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream';
    reply.header('Content-Type', ct);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(full));
  }));

  // ---- 操作审计（管理员可查）----
  app.get('/api/audit', wrap(async (req, reply) => {
    if (!req.user.isAdmin) return reply.code(403).send({ code: 1, msg: '无权限' });
    const { limit = 100 } = req.query || {};
    const list = await many(
      `SELECT l.*, i.instance_no, i.title, u.real_name, u.organization
         FROM flow_log l
         LEFT JOIN flow_instance i ON i.id = l.instance_id
         LEFT JOIN org_user u ON u.id = l.actor_id
        ORDER BY l.created_at DESC LIMIT $1`,
      [Number(limit)]
    );
    return ok(reply, list);
  }));

  // ============================================================
  // S6：组织架构 Excel 批量导入
  // ============================================================

  // 导入模板（中越双语表头）
  app.get('/api/org/import/template', wrap(async (req, reply) => {
    return ok(reply, orgImportTemplate());
  }));

  // 岗位字典（导入校验岗位码用）
  // ⚠️ 保留不动：返回结构被多处下拉依赖（ImportMembersDialog / TrainingPlanTab 等）。
  app.get('/api/org/positions', wrap(async (req, reply) => {
    return ok(reply, await listPositionDict());
  }));

  // ============================================================
  // S6+：岗位字典自定义（管理员可 新增/编辑/停用/删除）
  // 权威规格：docs/岗位字典自定义与工段分类-实施方案.md §3.2
  // 权限：写路由必须走 utils/admin.js 的 isAdminUser（单一真值来源）。
  // 路由顺序：/api/org/positions/all 必须在 /api/org/positions/:id 之前注册，
  //           否则 'all' 会被当作 :id 参数命中。
  // ============================================================

  // 工段下拉（部门树下 parent=生产部 的子部门），供培训「按工段」多选使用
  // 缺口2：接受可选 ?parentCode=（默认 'PD' 生产部），保留现有无参调用行为不变。
  // 语义 = 「指定父部门下的子部门（即工段）」；前端应以本接口为取工段的**唯一稳定来源**，
  // 不要硬编码 SEC_ 前缀。非法 parentCode → 返回空数组（200），不 500。
  app.get('/api/org/sections', wrap(async (req, reply) => {
    const { parentCode } = req.query || {};
    const pc = (parentCode === undefined || parentCode === null || String(parentCode).trim() === '')
      ? 'PD'
      : String(parentCode).trim();
    return ok(reply, await listSectionDepartments({ parentCode: pc }));
  }));

  // 岗位管理视图（含已停用项 + 引用计数）；须在 /:id 之前注册
  app.get('/api/org/positions/all', { preHandler: requirePermission('org:manage') }, wrap(async (req, reply) => {
    return ok(reply, await listPositionDictAll());
  }));

  // 新增岗位（仅管理员）
  app.post('/api/org/positions', wrap(async (req, reply) => {
    if (!(await isAdminUser(req.user.id))) return reply.code(403).send({ code: 1, msg: '无权限' });
    const r = await createPosition(req.body || {});
    return ok(reply, r, '岗位已创建');
  }));

  // 编辑岗位（仅管理员；code 不可编辑）
  app.put('/api/org/positions/:id', wrap(async (req, reply) => {
    if (!(await isAdminUser(req.user.id))) return reply.code(403).send({ code: 1, msg: '无权限' });
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await updatePosition(id, req.body || {});
    return ok(reply, r, '岗位已更新');
  }));

  // 删除岗位（仅管理员；被引用时返回 400 提示改用停用）
  app.delete('/api/org/positions/:id', wrap(async (req, reply) => {
    if (!(await isAdminUser(req.user.id))) return reply.code(403).send({ code: 1, msg: '无权限' });
    const id = toId(req.params.id);
    if (!id) return reply.code(400).send({ code: 1, msg: '参数不合法' });
    const r = await deletePosition(id);
    return ok(reply, r, '岗位已删除');
  }));

  // 执行导入
  // F-03：单请求行数上限 500。根因是 Node 默认 requestTimeout=300s —— 超长单请求
  // 会被客户端判定失败而服务端仍在落库，用户重试即重复导入；改为分批提交（前端配套）。
  const MAX_ORG_IMPORT_ROWS = 500;
  app.post('/api/org/import', { preHandler: requirePermission('org:manage') }, wrap(async (req, reply) => {
    const rows = req.body?.rows || [];
    if (!Array.isArray(rows)) return reply.code(400).send({ code: 1, msg: '导入数据格式不正确' });
    if (rows.length > MAX_ORG_IMPORT_ROWS) {
      return reply.code(400).send({
        code: 1,
        msg: `单次最多导入 ${MAX_ORG_IMPORT_ROWS} 行（本次 ${rows.length} 行），请分批导入`,
      });
    }
    const result = await importOrg(rows, req.user.id);
    const msg = `导入完成：部门新增 ${result.deptInserted}/更新 ${result.deptUpdated}，`
      + `用户新增 ${result.userInserted}/更新 ${result.userUpdated}`
      + (result.matchedByFallback ? `（其中无工号兜底匹配 ${result.matchedByFallback}）` : '')
      + `，失败 ${result.failed}`;
    return ok(reply, result, msg);
  }));

  // 导出全组织（S1 越权修复：与 import 一致，需 org:manage 权限）
  app.get('/api/org/export', { preHandler: requirePermission('org:manage') }, wrap(async (req, reply) => {
    return ok(reply, await exportOrg());
  }));

  // ============================================================
  // S6：组织架构纪要
  // ============================================================

  // 纪要导入模板
  app.get('/api/org/minutes/template', wrap(async (req, reply) => {
    return ok(reply, minutesTemplate());
  }));

  // 纪要导出（注意：需在 /:id 之前注册，避免 'export' 被当作 id）
  app.get('/api/org/minutes/export', wrap(async (req, reply) => {
    return ok(reply, await exportMinutes());
  }));

  // 纪要列表
  app.get('/api/org/minutes', wrap(async (req, reply) => {
    const { keyword, page, pageSize } = req.query || {};
    return ok(reply, await listMinutes({ keyword, page, pageSize }));
  }));

  // 纪要详情
  app.get('/api/org/minutes/:id', wrap(async (req, reply) => {
    const m = await getMinutes(toId(req.params.id));
    if (!m) return reply.code(404).send({ code: 1, msg: '纪要不存在' });
    return ok(reply, m);
  }));

  // 新建纪要
  app.post('/api/org/minutes', { preHandler: requirePermission('org:manage') }, wrap(async (req, reply) => {
    const m = await createMinutes(req.body || {}, req.user.id);
    return ok(reply, m, '纪要已创建');
  }));

  // 纪要导入
  app.post('/api/org/minutes/import', { preHandler: requirePermission('org:manage') }, wrap(async (req, reply) => {
    const rows = req.body?.rows || [];
    const result = await importMinutes(rows, req.user.id);
    return ok(reply, result, `导入完成：成功 ${result.inserted}，失败 ${result.failed}`);
  }));

  // 更新纪要
  app.put('/api/org/minutes/:id', { preHandler: requirePermission('org:manage') }, wrap(async (req, reply) => {
    const r = await updateMinutes(toId(req.params.id), req.body || {});
    return ok(reply, r, '已保存');
  }));

  // 删除纪要
  app.delete('/api/org/minutes/:id', { preHandler: requirePermission('org:manage') }, wrap(async (req, reply) => {
    const r = await deleteMinutes(toId(req.params.id));
    return ok(reply, r, '已删除');
  }));
}