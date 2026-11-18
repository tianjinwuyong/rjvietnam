// 模块权限管理 API
// ------------------------------------------------------------
// 读：模块清单 / 用户×模块矩阵 / 我的级别
// 写：整人覆盖、批量、复制、重置、按角色权限回填
// 权限：admin 或 system:manage；/api/permissions/my 仅需登录（供菜单隐藏）
import { authenticate, ok, wrap, requirePermission } from '../middleware/index.js';
import { toId } from '../utils/params.js';
import { many, one, query, transaction } from '../db/index.js';
import {
  listModules, getUserModuleLevels, invalidateUser, invalidateModules,
} from '../services/module-permission.js';

const LEVELS = new Set(['none', 'view', 'operate']);

function normLevel(v) {
  const s = String(v || '').toLowerCase();
  if (!LEVELS.has(s)) throw Object.assign(new Error('权限级别只能是 none / view / operate'), { isBiz: true, statusCode: 400 });
  return s;
}

/** 写授权日志（旧级别、新级别、操作人） */
async function logGrants(entries, operatorId) {
  if (!entries.length) return;
  const vals = [];
  const params = [];
  let i = 1;
  for (const e of entries) {
    vals.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(e.userId, e.moduleCode, e.oldLevel, e.newLevel, operatorId);
  }
  await query(
    `INSERT INTO sys_module_grant_log (user_id, module_code, old_level, new_level, operator_id)
     VALUES ${vals.join(',')}`, params
  );
}

export default async function permissionRoutes(app) {
  app.addHook('preHandler', authenticate);

  /* ---------- 我的模块级别（前端菜单/门禁用） ---------- */
  app.get('/api/permissions/my', wrap(async (req, reply) => {
    const modules = await listModules();
    const levels = req.user.isAdmin || req.user.isApi || req.user.isSystem
      ? Object.fromEntries(modules.map(m => [m.code, 'operate']))
      : await getUserModuleLevels(req.user.id);
    return ok(reply, {
      isAdmin: !!req.user.isAdmin,
      levels,
      modules: modules.map(m => ({ code: m.code, name: m.name, fe_paths: m.fe_paths, kind: m.kind })),
    });
  }));

  /* ---------- 模块清单 ---------- */
  app.get('/api/permissions/modules', { preHandler: requirePermission('system:manage') }, wrap(async (req, reply) => {
    const modules = await listModules();
    return ok(reply, modules.map(m => ({
      code: m.code, name: m.name, name_vi: m.name_vi, grp: m.grp, kind: m.kind,
      sort: m.sort, baseline_level: m.baseline_level,
      api_prefixes: m.api_prefixes, fe_paths: m.fe_paths, perm_codes: m.perm_codes, note: m.note,
    })));
  }));

  /* ---------- 用户 × 模块矩阵 ---------- */
  // 只回显「显式配置」，未配置的由前端用 baseline_level 兜底 —— 省一半流量
  app.get('/api/permissions/matrix', { preHandler: requirePermission('system:manage') }, wrap(async (req, reply) => {
    const { deptId, keyword, includeSystem } = req.query || {};
    const params = [];
    let where = 'u.active = TRUE';
    if (!includeSystem) where += ` AND NOT COALESCE(u.is_system, FALSE)`;
    if (deptId) where += ` AND u.department_id = $${params.push(Number(deptId))}`;
    if (keyword) {
      where += ` AND (u.real_name ILIKE $${params.push('%' + keyword + '%')}
                   OR u.username ILIKE $${params.length}
                   OR u.employee_no ILIKE $${params.length})`;
    }
    const users = await many(
      `SELECT u.id, u.username, u.real_name, u.employee_no, u.position,
              d.name AS dept_name, d.name_en AS dept_name_en
         FROM org_user u
         LEFT JOIN org_department d ON d.id = u.department_id
        WHERE ${where}
        ORDER BY COALESCE(d.name, ''), u.employee_no, u.id`, params
    );
    const ids = users.map(u => Number(u.id));
    const grants = ids.length
      ? await many(
        `SELECT user_id, module_code, level FROM sys_module_grant WHERE user_id = ANY($1::bigint[])`, [ids])
      : [];
    const byUser = {};
    for (const g of grants) {
      byUser[g.user_id] = byUser[g.user_id] || {};
      byUser[g.user_id][g.module_code] = g.level;
    }
    const modules = await listModules();
    return ok(reply, {
      modules: modules.map(m => ({
        code: m.code, name: m.name, name_vi: m.name_vi, grp: m.grp, kind: m.kind,
        sort: m.sort, baseline_level: m.baseline_level, note: m.note,
      })),
      users,
      grants: byUser,
    });
  }));

  /* ---------- 整人覆盖 ---------- */
  app.put('/api/permissions/users/:id', { preHandler: requirePermission('system:manage') }, wrap(async (req, reply) => {
    const userId = toId(req.params.id);
    if (!userId) return reply.code(400).send({ code: 1, msg: '用户不存在' });
    const user = await one(`SELECT id, real_name, is_admin, COALESCE(is_system, FALSE) AS is_system FROM org_user WHERE id = $1`, [userId]);
    if (!user) return reply.code(404).send({ code: 1, msg: '用户不存在' });
    // 系统管理账户（admin 角色 / is_system）恒全权，不允许被收窄 —— 改了也不生效，直接挡住避免误导
    if (user.is_admin || user.is_system) {
      return reply.code(400).send({ code: 1, msg: '系统管理账户恒具备全部权限，无需设置' });
    }

    const incoming = req.body?.levels || {};
    const modules = new Set((await listModules()).map(m => m.code));
    const old = (await many(`SELECT module_code, level FROM sys_module_grant WHERE user_id = $1`, [userId]));
    const oldMap = new Map(old.map(r => [r.module_code, r.level]));
    const entries = [];

    await transaction(async (client) => {
      const keep = [];
      for (const [code, raw] of Object.entries(incoming)) {
        if (!modules.has(code)) continue;             // 未知模块直接忽略，避免脏数据
        const level = normLevel(raw);
        keep.push(code);
        if (oldMap.get(code) !== level) {
          await client.query(
            `INSERT INTO sys_module_grant (user_id, module_code, level, updated_by)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (user_id, module_code)
             DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [userId, code, level, req.user.id]
          );
          entries.push({ userId, moduleCode: code, oldLevel: oldMap.get(code) || null, newLevel: level });
        }
      }
      // 前端传了空对象 = 清空全部；传了部分键 = 只覆盖这些键（其余保留）
      if (req.body?.replaceAll === true) {
        const drop = old.filter(r => !keep.includes(r.module_code)).map(r => r.module_code);
        if (drop.length) {
          await client.query(
            `DELETE FROM sys_module_grant WHERE user_id = $1 AND module_code = ANY($2::text[])`, [userId, drop]);
          for (const code of drop) entries.push({ userId, moduleCode: code, oldLevel: oldMap.get(code), newLevel: null });
        }
      }
    });

    invalidateUser(userId);
    await logGrants(entries, req.user.id);
    return ok(reply, { changed: entries.length }, entries.length ? `已更新 ${entries.length} 项` : '没有变化');
  }));

  /* ---------- 批量设置（多人 × 多模块） ---------- */
  app.post('/api/permissions/bulk', { preHandler: requirePermission('system:manage') }, wrap(async (req, reply) => {
    const { userIds, moduleCodes, level, deptId, positionCode } = req.body || {};
    const lv = normLevel(level);
    const modules = new Set((await listModules()).map(m => m.code));
    const codes = (moduleCodes || []).filter(c => modules.has(c));
    if (!codes.length) return reply.code(400).send({ code: 1, msg: '请选择要设置的模块' });

    let ids = (userIds || []).map(Number).filter(Boolean);
    if (!ids.length && (deptId || positionCode)) {
      const params = [];
      let where = 'active = TRUE AND NOT COALESCE(is_system, FALSE)';
      if (deptId) where += ` AND department_id = $${params.push(Number(deptId))}`;
      if (positionCode) where += ` AND position = $${params.push(positionCode)}`;
      ids = (await many(`SELECT id FROM org_user WHERE ${where}`, params)).map(r => Number(r.id));
    }
    if (!ids.length) return reply.code(400).send({ code: 1, msg: '请选择要设置的人员' });

    // 系统管理账户不参与批量授权（admin / is_system 恒全权）
    const blocked = new Set((await many(
      `SELECT id FROM org_user
        WHERE id = ANY($1::bigint[]) AND (is_admin OR COALESCE(is_system, FALSE))`, [ids]
    )).map(r => Number(r.id)));
    if (blocked.size) ids = ids.filter(id => !blocked.has(id));
    if (!ids.length) return reply.code(400).send({ code: 1, msg: '所选账号均为系统管理账户，无需设置' });

    const entries = [];
    await transaction(async client => {
      for (const uid of ids) {
        const old = await client.query(
          `SELECT module_code, level FROM sys_module_grant WHERE user_id = $1 AND module_code = ANY($2::text[])`,
          [uid, codes]
        );
        const oldMap = new Map(old.rows.map(r => [r.module_code, r.level]));
        for (const code of codes) {
          if (oldMap.get(code) === lv) continue;
          await client.query(
            `INSERT INTO sys_module_grant (user_id, module_code, level, updated_by)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (user_id, module_code)
             DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [uid, code, lv, req.user.id]
          );
          entries.push({ userId: uid, moduleCode: code, oldLevel: oldMap.get(code) || null, newLevel: lv });
        }
      }
    });
    for (const uid of ids) invalidateUser(uid);
    await logGrants(entries, req.user.id);
    return ok(reply, { users: ids.length, modules: codes.length, changed: entries.length },
      `已为 ${ids.length} 人设置 ${codes.length} 个模块`);
  }));

  /* ---------- 复制某人的权限 ---------- */
  app.post('/api/permissions/copy', { preHandler: requirePermission('system:manage') }, wrap(async (req, reply) => {
    const from = toId(req.body?.fromUserId);
    const tos = (req.body?.toUserIds || []).map(Number).filter(Boolean);
    if (!from || !tos.length) return reply.code(400).send({ code: 1, msg: '请选择来源用户和目标用户' });
    const src = await many(`SELECT module_code, level FROM sys_module_grant WHERE user_id = $1`, [from]);
    if (!src.length) return reply.code(400).send({ code: 1, msg: '来源用户没有任何显式配置' });
    const entries = [];
    await transaction(async client => {
      for (const uid of tos) {
        await client.query(`DELETE FROM sys_module_grant WHERE user_id = $1`, [uid]);
        for (const r of src) {
          await client.query(
            `INSERT INTO sys_module_grant (user_id, module_code, level, updated_by) VALUES ($1,$2,$3,$4)`,
            [uid, r.module_code, r.level, req.user.id]
          );
          entries.push({ userId: uid, moduleCode: r.module_code, oldLevel: null, newLevel: r.level });
        }
      }
    });
    for (const uid of tos) invalidateUser(uid);
    await logGrants(entries, req.user.id);
    return ok(reply, { copied: entries.length }, `已复制到 ${tos.length} 人`);
  }));

  /* ---------- 重置某人（回到全员基线） ---------- */
  app.delete('/api/permissions/users/:id', { preHandler: requirePermission('system:manage') }, wrap(async (req, reply) => {
    const userId = toId(req.params.id);
    if (!userId) return reply.code(400).send({ code: 1, msg: '用户不存在' });
    const target = await one(`SELECT id, is_admin, COALESCE(is_system, FALSE) AS is_system FROM org_user WHERE id = $1`, [userId]);
    if (!target) return reply.code(404).send({ code: 1, msg: '用户不存在' });
    if (target.is_admin || target.is_system) {
      return reply.code(400).send({ code: 1, msg: '系统管理账户恒具备全部权限，无需重置' });
    }
    const old = await many(`SELECT module_code, level FROM sys_module_grant WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM sys_module_grant WHERE user_id = $1`, [userId]);
    invalidateUser(userId);
    await logGrants(old.map(r => ({ userId, moduleCode: r.module_code, oldLevel: r.level, newLevel: null })), req.user.id);
    return ok(reply, { removed: old.length }, `已重置 ${old.length} 项，回到全员基线`);
  }));

  /* ---------- 按现有角色权限一次性生成初始配置 ---------- */
  // 用途：切换「全员统一基线」后，主管/HR 等会失去原有能力；
  // 管理员点一次即可把「角色已授权的模块」写成 operate，之后逐人微调。
  app.post('/api/permissions/seed-from-roles', { preHandler: requirePermission('system:manage') }, wrap(async (req, reply) => {
    const modules = await listModules();
    // 角色已有权限码 → 能命中的模块
    const rows = await many(
      `SELECT ur.user_id, p.code AS perm
         FROM sys_user_role ur
         JOIN sys_role_permission rp ON rp.role_id = ur.role_id
         JOIN sys_permission p ON p.id = rp.permission_id`
    );
    const byUser = new Map();
    for (const r of rows) {
      if (!byUser.has(Number(r.user_id))) byUser.set(Number(r.user_id), new Set());
      byUser.get(Number(r.user_id)).add(r.perm);
    }
    const entries = [];
    await transaction(async client => {
      for (const [uid, perms] of byUser) {
        for (const m of modules) {
          if (m.kind !== 'biz' || !m.perm_codes?.length) continue;
          const hit = m.perm_codes.some(c => perms.has(c));
          if (!hit) continue;
          await client.query(
            `INSERT INTO sys_module_grant (user_id, module_code, level, updated_by)
             VALUES ($1,$2,'operate',$3)
             ON CONFLICT (user_id, module_code) DO NOTHING`,
            [uid, m.code, req.user.id]
          );
          entries.push({ userId: uid, moduleCode: m.code, oldLevel: null, newLevel: 'operate' });
        }
      }
    });
    invalidateUser();
    await logGrants(entries, req.user.id);
    return ok(reply, { changed: entries.length }, `已按角色权限回填 ${entries.length} 条`);
  }));

  /* ---------- 变更日志 ---------- */
  app.get('/api/permissions/audit', { preHandler: requirePermission('system:manage') }, wrap(async (req, reply) => {
    const limit = Math.min(Number(req.query?.limit) || 100, 500);
    const rows = await many(
      `SELECT l.*, u.real_name, m.name AS module_name, o.real_name AS operator_name
         FROM sys_module_grant_log l
         LEFT JOIN org_user u ON u.id = l.user_id
         LEFT JOIN sys_module m ON m.code = l.module_code
         LEFT JOIN org_user o ON o.id = l.operator_id
        ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit}`
    );
    return ok(reply, rows);
  }));

  /** 模块变更后让前缀缓存失效（供后续扩展模块管理用） */
  app.post('/api/permissions/refresh', { preHandler: requirePermission('system:manage') }, wrap(async (req, reply) => {
    invalidateModules();
    return ok(reply, null, '缓存已刷新');
  }));
}
