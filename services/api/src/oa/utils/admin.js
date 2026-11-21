// ============================================================
// 管理员真值（单一来源）
// ------------------------------------------------------------
// 历史上"是否管理员"有两个真值来源：
//   a) org_user.is_admin 布尔列
//   b) sys_user_role ⋈ sys_role.code='admin'（角色表）
// 二者若分叉会出现「前端显示按钮、点击 403」等诡异问题。
//
// 本模块把真值**统一到角色表**（全项目只此一处判定），并提供：
//   - hasAdminRole(roleCodes)   纯函数规则（供已取到角色码的场景复用）
//   - isAdminUser(userId)       单一真值：查角色表
//   - isDeptManagerOrAbove(userId)  「部门经理及以上」判定（手机号等敏感字段可见性）
//   - listAdminUserIds()        列出管理员（发通知用）
//   - grantAdminRole / revokeAdminRole  写角色并回写标志列，保持两源一致
//   - reconcileAdminFlag(userId)        依据角色表回写标志列
//   - auditAdminConsistency()           启动期一致性校验（只诊断不改数据）
//
// 说明：本模块只依赖 db，无循环依赖。
// ============================================================
import { many, one, query } from '../db/index.js';

/** 管理员角色编码 */
export const ADMIN_ROLE_CODE = 'admin';

/** 部门负责人角色编码 */
export const DEPT_LEADER_ROLE_CODE = 'dept_leader';

/** 「高层」岗位编码：总经理 / 分管副总（含在"部门经理及以上"口径内） */
export const TOP_POSITION_CODES = ['gm', 'vp'];

/** 「部门经理」岗位编码（岗位字典 dict_type='position'） */
export const DEPT_MANAGER_POSITION_CODE = 'dept_mgr';

/**
 * 纯函数：角色码列表是否含管理员角色（唯一判定规则，便于对已取到的角色复用）。
 * @param {string[]} roleCodes
 * @returns {boolean}
 */
export function hasAdminRole(roleCodes) {
  return Array.isArray(roleCodes) && roleCodes.includes(ADMIN_ROLE_CODE);
}

/**
 * 单一真值：某用户是否为管理员（依据角色表，不读 org_user.is_admin 列）。
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
export async function isAdminUser(userId) {
  if (!userId) return false;
  const row = await one(
    `SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND r.code = $2 LIMIT 1`,
    [userId, ADMIN_ROLE_CODE]
  );
  return row != null;
}

/**
 * 列出全部管理员用户 id（发通知等场景用）。
 * @returns {Promise<number[]>}
 */
export async function listAdminUserIds() {
  const rows = await many(
    `SELECT u.id FROM sys_user_role ur
       JOIN sys_role r ON r.id = ur.role_id
       JOIN org_user u ON u.id = ur.user_id
      WHERE r.code = $1`,
    [ADMIN_ROLE_CODE]
  );
  return rows.map(r => Number(r.id));
}

/**
 * 「部门经理及以上」判定 —— 用于手机号等敏感字段的可见性控制。
 *
 * 用户口径（2026-10-12）：`phone` 需要校验权限（部门经理及以上）。
 *
 * 采用**多来源取并集**，满足任一即为真（任一来源单独都不够全，实测有洞）：
 *   1) 管理员                     —— sys_user_role⋈sys_role.code='admin'
 *   2) 部门负责人角色             —— sys_user_role⋈sys_role.code='dept_leader'
 *   3) 所辖部门负责人             —— org_department.leader_id = 本人
 *   4) 总经理 / 分管副总          —— org_user.position_code IN ('gm','vp')
 *   5) 部门经理岗位               —— org_user.position_code = 'dept_mgr'
 *
 * 为什么不用单一来源（2026-10-12 全量实测 33 人的结论）：
 *   · 只用 position_code：5 人为 NULL（如 zhaoliu 生产部负责人）→ 漏判
 *   · 只用 dept_leader 角色：hr_mgr（人事经理）未授该角色 → 漏判
 *   · 只用 leader_id：hr_mgr 未被任何部门引用为负责人 → 漏判
 *   故取并集：管理员 ∪ dept_leader ∪ leader_id ∪ gm/vp ∪ dept_mgr。
 *
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
export async function isDeptManagerOrAbove(userId) {
  if (!userId) return false;
  const row = await one(
    `SELECT 1
       FROM org_user u
      WHERE u.id = $1
        AND (
          -- 1) 管理员
          EXISTS (
            SELECT 1 FROM sys_user_role ur
              JOIN sys_role r ON r.id = ur.role_id
             WHERE ur.user_id = u.id AND r.code = $2)
          -- 2) 部门负责人角色
          OR EXISTS (
            SELECT 1 FROM sys_user_role ur
              JOIN sys_role r ON r.id = ur.role_id
             WHERE ur.user_id = u.id AND r.code = $3)
          -- 3) 所辖部门负责人
          OR EXISTS (
            SELECT 1 FROM org_department d WHERE d.leader_id = u.id)
          -- 4) 总经理 / 分管副总
          OR u.position_code = ANY($4::text[])
          -- 5) 部门经理岗位
          OR u.position_code = $5
        )
      LIMIT 1`,
    [userId, ADMIN_ROLE_CODE, DEPT_LEADER_ROLE_CODE, TOP_POSITION_CODES, DEPT_MANAGER_POSITION_CODE]
  );
  return row != null;
}

/**
 * 授予管理员角色，并回写 org_user.is_admin=TRUE，保证两源一致（幂等）。
 * @param {number} userId
 */
export async function grantAdminRole(userId) {
  await query(
    `INSERT INTO sys_user_role (user_id, role_id)
     SELECT $1, id FROM sys_role WHERE code = $2
     ON CONFLICT DO NOTHING`,
    [userId, ADMIN_ROLE_CODE]
  );
  await query(`UPDATE org_user SET is_admin = TRUE, updated_at = now() WHERE id = $1`, [userId]);
}

/**
 * 撤销管理员角色，并回写 org_user.is_admin=FALSE，保证两源一致（幂等）。
 * @param {number} userId
 */
export async function revokeAdminRole(userId) {
  await query(
    `DELETE FROM sys_user_role
      WHERE user_id = $1 AND role_id = (SELECT id FROM sys_role WHERE code = $2)`,
    [userId, ADMIN_ROLE_CODE]
  );
  await query(`UPDATE org_user SET is_admin = FALSE, updated_at = now() WHERE id = $1`, [userId]);
}

/**
 * 依据角色表回写 org_user.is_admin 标志列（列 ← 角色真值），消除分叉。
 * @param {number} userId
 */
export async function reconcileAdminFlag(userId) {
  const isAdmin = await isAdminUser(userId);
  await query(
    `UPDATE org_user SET is_admin = $2, updated_at = now() WHERE id = $1`,
    [userId, isAdmin]
  );
}

/**
 * 启动期一致性校验：返回两个方向的分叉账号（只诊断，不改数据）。
 * @returns {Promise<{flagOnly:Array, roleOnly:Array}>}
 *   flagOnly: is_admin=true 但无 admin 角色
 *   roleOnly: 有 admin 角色但 is_admin=false
 */
export async function auditAdminConsistency() {
  const flagOnly = await many(
    `SELECT u.id, u.username FROM org_user u
      WHERE u.is_admin = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM sys_user_role ur
            JOIN sys_role r ON r.id = ur.role_id
           WHERE ur.user_id = u.id AND r.code = $1)`,
    [ADMIN_ROLE_CODE]
  );
  const roleOnly = await many(
    `SELECT u.id, u.username FROM org_user u
       JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id AND r.code = $1
      WHERE u.is_admin = FALSE`,
    [ADMIN_ROLE_CODE]
  );
  return { flagOnly, roleOnly };
}
