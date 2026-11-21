// ============================================================
// org-transfer-service —— 员工调岗（部门/岗位变更）留痕
//
// 为什么要有它：调部门此前是"直接改字段"，改完查不到任何痕迹。
// 人事对账、审计、"这个月部门人头怎么算"都需要一条可追溯的变更记录。
//
// 纪律：
//   1) 只记**真实变更**：before/after 一致就什么都不写（避免每次保存都刷一条）；
//   2) 部门名/岗位名**存快照**：部门改名或删除后，历史记录仍然读得懂；
//   3) 写记录失败**绝不影响主流程**（调用方 catch 掉即可）——留痕是旁路，不是业务前置条件。
// ============================================================
import { many, one, query } from '../db/index.js';

/** 批量取部门名（id → name），忽略空/非法 id */
async function deptNames(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String).map(Number).filter(n => Number.isFinite(n) && n > 0))];
  if (!list.length) return new Map();
  const rows = await many(`SELECT id, name FROM org_department WHERE id = ANY($1::bigint[])`, [list]);
  return new Map(rows.map(r => [String(r.id), r.name]));
}

/** 批量取岗位名（code → name_zh），忽略空 code */
async function positionNames(codes) {
  const list = [...new Set(codes.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const rows = await many(
    `SELECT code, name_zh FROM sys_i18n_dict WHERE dict_type = 'position' AND code = ANY($1::text[])`,
    [list]
  );
  return new Map(rows.map(r => [String(r.code), r.name_zh]));
}

/**
 * 记录一次员工调动（部门/岗位变化）。
 *
 * @param {object} p
 * @param {number} p.userId       被调动员工
 * @param {{deptId?, positionCode?, positionName?}} p.before 变更前
 * @param {{deptId?, positionCode?, positionName?}} p.after  变更后
 * @param {number} [p.operatorId] 操作人（管理员/人事）
 * @param {string} [p.reason]     调动原因（可选）
 * @param {'manual'|'import'} [p.source] 来源
 * @returns {Promise<object|null>} 写入的记录；无变化返回 null
 */
export async function recordTransfer({ userId, before = {}, after = {}, operatorId = null, reason = null, source = 'manual' }) {
  const bDept = before.deptId ?? null;
  const aDept = after.deptId ?? null;
  const bPos = before.positionCode || null;
  const aPos = after.positionCode || null;

  const deptChanged = String(bDept ?? '') !== String(aDept ?? '');
  const posChanged = String(bPos ?? '') !== String(aPos ?? '');
  if (!deptChanged && !posChanged) return null;

  const changeType = deptChanged && posChanged ? 'both' : (deptChanged ? 'dept' : 'position');

  const dNames = await deptNames([bDept, aDept]);
  const pNames = await positionNames([bPos, aPos]);

  return await one(
    `INSERT INTO org_transfer_log
       (user_id, change_type, from_dept_id, to_dept_id, from_dept_name, to_dept_name,
        from_position, to_position, from_position_code, to_position_code,
        reason, source, operator_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      userId, changeType, bDept, aDept,
      dNames.get(String(bDept)) || (deptChanged ? before.deptName || null : null),
      dNames.get(String(aDept)) || (deptChanged ? after.deptName || null : null),
      before.positionName || pNames.get(String(bPos)) || bPos,
      after.positionName || pNames.get(String(aPos)) || aPos,
      bPos, aPos, reason, source, operatorId,
    ]
  );
}

/** 某员工的调岗历史（时间倒序） */
export async function listTransfers(userId, { limit = 100 } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  return await many(
    `SELECT t.*, op.real_name AS operator_name
       FROM org_transfer_log t
       LEFT JOIN org_user op ON op.id = t.operator_id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $2`,
    [userId, n]
  );
}
