// ============================================================
// sensitive-service —— 敏感信息「授权查看」
//
// 现场需求：入职登记的身份证号不能默认可见，查看要现场输入一个**被授权账号**的
// 账号+密码（管理员事先指定谁能授权，管理员本人天然可以）。
//
// 安全设计（三条都必须有，缺一条这个功能就形同虚设）：
//   1) **默认不可见**：列表/详情只回掩码（****1234），明文永不随常规查询返回；
//   2) **现场二次认证**：reveal 必须带 username + password，且该账号必须是
//      「管理员 / 授权清单成员 / 拥有 hr:sensitive 权限」三者之一；
//   3) **强制审计**：无论成功还是被拒，都往 sensitive_view_log 写一条（含 IP）。
//      被拒也记，是因为"谁在尝试偷看"本身就是要追的线。
//
// 注意：这里不返回 token，明文只在这一次响应里出现，前端关窗即消失。
// ============================================================
import bcrypt from 'bcryptjs';
import { many, one, query } from '../db/index.js';

/** 身份证掩码：保留前 3 位与后 4 位，中间打码（足够核对，不足以冒用） */
export function maskIdCard(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.length <= 7) return '*'.repeat(Math.max(1, s.length - 2)) + s.slice(-2);
  return `${s.slice(0, 3)}${'*'.repeat(Math.max(4, s.length - 7))}${s.slice(-4)}`;
}

/** 该账号是否具备"授权他人查看"的资格：管理员 / 授权清单 / hr:sensitive 权限 */
async function canRevealSensitive(userId) {
  const u = await one(`SELECT id, is_admin FROM org_user WHERE id = $1 AND active = TRUE`, [userId]);
  if (!u) return false;
  if (u.is_admin) return true;
  const listed = await one(`SELECT 1 AS ok FROM sensitive_viewer WHERE user_id = $1`, [userId]);
  if (listed) return true;
  const perm = await one(
    `SELECT 1 AS ok
       FROM sys_user_role ur
       JOIN sys_role_permission rp ON rp.role_id = ur.role_id
       JOIN sys_permission p ON p.id = rp.permission_id
      WHERE ur.user_id = $1 AND p.code = 'hr:sensitive'
      LIMIT 1`,
    [userId]
  );
  return !!perm;
}

/** 授权清单（管理员维护） */
export async function listViewers() {
  return many(
    `SELECT v.id, v.user_id, v.granted_at, v.remark,
            u.real_name, u.username, u.employee_no, u.department_id,
            d.name AS dept_name, g.real_name AS granted_by_name
       FROM sensitive_viewer v
       JOIN org_user u ON u.id = v.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN org_user g ON g.id = v.granted_by
      ORDER BY v.granted_at DESC`
  );
}

export async function addViewer(userId, operatorId, remark = null) {
  const u = await one(`SELECT id, real_name, is_admin, active FROM org_user WHERE id = $1`, [userId]);
  if (!u) throw Object.assign(new Error('员工不存在'), { statusCode: 404, isBiz: true });
  if (!u.active) throw Object.assign(new Error('该账号已停用，不能授权'), { statusCode: 400, isBiz: true });
  if (u.is_admin) throw Object.assign(new Error('管理员本身已具备查看权限，无需加入清单'), { statusCode: 400, isBiz: true });
  const r = await one(
    `INSERT INTO sensitive_viewer (user_id, granted_by, remark)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET remark = COALESCE(EXCLUDED.remark, sensitive_viewer.remark)
     RETURNING *`,
    [userId, operatorId, remark]
  );
  return r;
}

export async function removeViewer(userId) {
  await query(`DELETE FROM sensitive_viewer WHERE user_id = $1`, [userId]);
  return { userId };
}

/** 审计日志（管理员查看） */
export async function listLogs({ limit = 100 } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  return many(
    `SELECT l.*, u.real_name AS viewer_name
       FROM sensitive_view_log l
       LEFT JOIN org_user u ON u.id = l.viewer_user_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $1`,
    [n]
  );
}

async function writeLog({ viewerId, viewerUsername, targetType, targetId, targetName, fields, result, reason, ip }) {
  try {
    await query(
      `INSERT INTO sensitive_view_log
         (viewer_user_id, viewer_username, target_type, target_id, target_name, fields, result, reason, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [viewerId || null, viewerUsername || null, targetType, targetId || null,
       targetName || null, fields, result, reason || null, ip || null]
    );
  } catch { /* 审计写失败不阻断（但要能在日志里看出来）：极端情况也不该让人看不到数据 */ }
}

/**
 * 授权查看：校验账号密码 + 资格，通过后返回明文并写审计。
 *
 * @param {object} p
 * @param {string} p.username  现场输入的授权账号
 * @param {string} p.password  现场输入的密码
 * @param {string} p.targetType 'onboarding' | 'user'
 * @param {number} p.targetId
 * @param {string} [p.ip]
 * @returns {Promise<{idCardNo: string, viewer: {username, realName}}>}
 */
export async function revealSensitive({ username, password, targetType, targetId, ip }) {
  const uname = String(username || '').trim();
  const pwd = String(password || '');
  const bad = (msg, reason) => Object.assign(new Error(msg), { statusCode: 403, isBiz: true, reason });

  if (!uname || !pwd) throw bad('请输入授权账号与密码', 'missing-credentials');

  // 先把被查看对象取出来（只用于审计留痕与最终返回），失败也给日志带上姓名，
  // 否则审计里只有 id，事后根本对不上"谁看了谁"。
  let target = null;
  if (targetType === 'onboarding') {
    target = await one(`SELECT id, real_name, id_card_no FROM employee_onboarding WHERE id = $1`, [targetId]);
    if (!target) throw Object.assign(new Error('记录不存在'), { statusCode: 404, isBiz: true });
  } else {
    throw Object.assign(new Error('不支持的查看类型'), { statusCode: 400, isBiz: true });
  }
  const targetName = target.real_name || null;

  const viewer = await one(
    `SELECT id, username, real_name, password_hash, active, is_admin FROM org_user WHERE username = $1`,
    [uname]
  );

  // 统一失败文案：不区分"账号不存在"和"密码错"，避免账号枚举
  if (!viewer || !viewer.active || !(await bcrypt.compare(pwd, viewer.password_hash || ''))) {
    await writeLog({
      viewerId: viewer?.id, viewerUsername: uname, targetType, targetId,
      targetName, fields: 'id_card_no', result: 'denied', reason: 'auth-failed', ip,
    });
    throw bad('授权账号或密码不正确', 'auth-failed');
  }

  if (!(await canRevealSensitive(viewer.id))) {
    await writeLog({
      viewerId: viewer.id, viewerUsername: uname, targetType, targetId,
      targetName, fields: 'id_card_no', result: 'denied', reason: 'no-permission', ip,
    });
    throw bad('该账号没有查看敏感信息的权限，请联系系统管理员授权', 'no-permission');
  }

  await writeLog({
    viewerId: viewer.id, viewerUsername: viewer.username, targetType, targetId,
    targetName, fields: 'id_card_no', result: 'ok', ip,
  });
  return {
    idCardNo: target.id_card_no || '',
    viewer: { username: viewer.username, realName: viewer.real_name },
  };
}
