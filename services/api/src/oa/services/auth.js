import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { one, query } from '../db/index.js';
import { config } from '../config/index.js';
import { hasAdminRole } from '../utils/admin.js';
import { attachModuleProfile } from './module-permission.js';

// 登录失败计数落库（F-06）：进程内 Map 重启即清零、多实例各算各的，
// 无法真正防爆破；改存 auth_fail_counter 表（sql/45_auth_fail_counter.sql）。
function failKey(username) {
  // 归一：大小写/首尾空白不产生独立计数，避免 "Admin " 绕过 "admin" 的锁定
  return String(username || '').trim().toLowerCase().slice(0, 255);
}

// 开关：MAX_LOGIN_FAIL <= 0 表示彻底关闭「失败次数锁定」（2026-11-04 用户口径：
// 连续输错就被锁 15 分钟太扰民，不要这个限制）。
// 关闭后既不检查 locked_until，也不再累计 fail_count（表保留，便于随时恢复）。
function lockEnabled() {
  return Number(config.security.maxLoginFail) > 0;
}

async function checkLock(username) {
  if (!lockEnabled()) return;
  const row = await one(
    `SELECT locked_until FROM auth_fail_counter
      WHERE username = $1 AND locked_until > now()`,
    [failKey(username)]
  );
  if (row?.locked_until) {
    const left = Math.max(1, Math.ceil((new Date(row.locked_until) - Date.now()) / 60000));
    throw new Error(`登录失败次数过多，请 ${left} 分钟后再试`);
  }
}

async function recordFail(username) {
  if (!lockEnabled()) return;
  // 单条 UPSERT 原子累计：并发失败请求不会因 check-then-set 丢计数
  await query(
    `INSERT INTO auth_fail_counter (username, fail_count, locked_until, updated_at)
     VALUES ($1, 1, NULL, now())
     ON CONFLICT (username) DO UPDATE SET
       fail_count = CASE WHEN auth_fail_counter.fail_count + 1 >= $2
                         THEN 0 ELSE auth_fail_counter.fail_count + 1 END,
       locked_until = CASE WHEN auth_fail_counter.fail_count + 1 >= $2
                           THEN now() + make_interval(mins => $3)
                           ELSE auth_fail_counter.locked_until END,
       updated_at = now()`,
    [failKey(username), config.security.maxLoginFail, config.security.lockMinutes]
  );
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, config.security.bcryptRounds);
}

export async function verifyPassword(plain, hash) {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** 用户名密码登录 */
export async function login({ username, password, ip, userAgent }) {
  await checkLock(username);

  const user = await one(
    `SELECT id, username, password_hash, real_name, active FROM org_user WHERE username = $1 OR email = $1 OR employee_no = $1`,
    [username]
  );
  if (!user || !user.active) {
    await recordFail(username);
    throw new Error('用户名或密码错误');
  }
  if (!await verifyPassword(password, user.password_hash)) {
    await recordFail(username);
    throw new Error('用户名或密码错误');
  }
  await query(`DELETE FROM auth_fail_counter WHERE username = $1`, [failKey(username)]);

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.security.sessionHours * 3600 * 1000);
  await query(
    `INSERT INTO sys_session (token, user_id, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [token, user.id, ip || null, (userAgent || '').slice(0, 500), expires]
  );
  await query(`UPDATE org_user SET last_login_at = now() WHERE id = $1`, [user.id]);

  return { token, expires, user: await getUserProfile(user.id) };
}

/** 飞书免登：用 code 换取用户身份，查到本地账号则直接登录 */
export async function loginByFeishuCode(code) {
  if (!config.feishu.enabled) throw new Error('飞书登录未启用');

  const tokenRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
  });
  const tk = await tokenRes.json();
  if (tk.code !== 0) throw new Error(tk.msg || '飞书授权失败');

  const infoRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { Authorization: `Bearer ${tk.access_token}` },
  });
  const info = await infoRes.json();
  if (info.code !== 0) throw new Error(info.msg || '获取用户信息失败');

  const openId = info.data?.open_id;
  if (!openId) throw new Error('未获取到飞书用户标识');

  let user = await one(`SELECT id, active FROM org_user WHERE feishu_open_id = $1`, [openId]);
  if (!user) {
    // 首次登录：用飞书邮箱匹配本地账号并绑定
    if (info.data?.email) {
      user = await one(
        `SELECT id, active FROM org_user WHERE email = $1`, [info.data.email]
      );
      if (user) {
        await query(`UPDATE org_user SET feishu_open_id=$2, feishu_user_id=$3 WHERE id=$1`,
          [user.id, openId, info.data.user_id]);
      }
    }
  }
  if (!user) throw new Error('该飞书账号未在 OA 中建立用户，请联系管理员');
  if (!user.active) throw new Error('账号已停用');

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.security.sessionHours * 3600 * 1000);
  await query(
    `INSERT INTO sys_session (token, user_id, ip, user_agent, expires_at) VALUES ($1,$2,NULL,$3,$5)`,
    [token, user.id, 'feishu-oauth', expires]
  );
  return { token, expires, user: await getUserProfile(user.id) };
}

// F-09：原实现每请求 4 次池查询（session + user + roles + perms），
// 高并发下是连接池耗尽放大器；此处合并为单条查询（角色/权限用 json 子查询聚合），
// 管理员的全量权限也在同一条 SQL 内 CASE 展开，认证链路只剩 1 次池占用。
const PROFILE_SELECT = `
  SELECT u.id, u.username, u.real_name, u.email, u.phone, u.position,
         u.organization, u.is_admin, u.is_external,
         COALESCE(u.is_system, FALSE) AS is_system,
         COALESCE(u.must_change_pwd, FALSE) AS must_change_pwd,
         u.pwd_changed_at,
         COALESCE(u.language, 'zh') AS language,
         d.id AS dept_id, d.name AS dept_name, d.name_en AS dept_name_en, d.organization AS dept_org,
         COALESCE((
           SELECT json_agg(json_build_object('code', r.code, 'name', r.name) ORDER BY r.id)
             FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
            WHERE ur.user_id = u.id), '[]'::json) AS roles_json,
         CASE WHEN EXISTS (
                SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND r.code = 'admin')
              THEN (SELECT COALESCE(json_agg(code), '[]'::json) FROM sys_permission)
              ELSE COALESCE((
                SELECT json_agg(DISTINCT p.code)
                  FROM sys_user_role ur
                  JOIN sys_role_permission rp ON rp.role_id = ur.role_id
                  JOIN sys_permission p ON p.id = rp.permission_id
                 WHERE ur.user_id = u.id), '[]'::json)
         END AS perms_json
    FROM org_user u
    LEFT JOIN org_department d ON d.id = u.department_id`;

/** 行 → 对外用户资料（保持原字段与语义不变） */
function mapProfile(row) {
  if (!row) return null;
  const roles = row.roles_json || [];
  const perms = row.perms_json || [];
  const isAdmin = hasAdminRole(roles.map(r => r.code));
  const out = { ...row };
  delete out.roles_json;
  delete out.perms_json;
  return {
    ...out,
    is_admin: isAdmin,          // 标志列归一到角色真值（对外单一口径）
    roles: roles.map(r => r.code),
    roleNames: roles.map(r => r.name),
    permissions: perms.map(p => (typeof p === 'string' ? p : p.code)),
    isAdmin,
    // 系统管理账户（admin / wms_bot 等）：不参与模块权限收敛，恒全放行
    isSystem: !!row.is_system,
    mustChangePwd: !!row.must_change_pwd,
  };
}

export async function getUserProfile(userId) {
  const row = await one(`${PROFILE_SELECT} WHERE u.id = $1`, [userId]);
  return attachModuleProfile(mapProfile(row));
}

/**
 * 合并模式桥接：按用户名解析 OA 用户资料（SMT JWT → OA 用户）。
 * SMT 登录签发的 JWT 携带 username；用同一用户名在 oa.org_user 里找
 * 活动用户，返回与 resolveSession 完全同构的资料（角色/权限/模块档案）。
 * 找不到对应 OA 用户时返回 null —— 由调用方决定 401。
 */
export async function resolveUserByUsername(username) {
  if (!username) return null;
  const row = await one(
    `${PROFILE_SELECT} WHERE u.username = $1 AND u.active = TRUE`,
    [String(username)]
  );
  return attachModuleProfile(mapProfile(row));
}

/** 会话校验（session + 资料合并为同一条查询，认证链路 1 次池查询） */
export async function resolveSession(token) {
  if (!token) return null;
  const row = await one(
    `${PROFILE_SELECT}
       JOIN sys_session s ON s.user_id = u.id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return attachModuleProfile(mapProfile(row));
}

export async function logout(token) {
  if (token) await query(`DELETE FROM sys_session WHERE token = $1`, [token]);
}

export function checkPasswordStrength(pwd) {
  if (!pwd || pwd.length < config.security.minPasswordLength) {
    throw new Error(`密码长度至少 ${config.security.minPasswordLength} 位`);
  }
  return true;
}

/**
 * 生成下一个工号：前缀 'DT' + 4 位全局递增序号（续当前最大 DT 号之后）。
 * 与 08_s2_account.sql 回填口径一致（统一 DT 前缀、全局递增、按数值取 max）。
 * @returns {Promise<string>} 如 'DT0034'
 */
export async function nextEmployeeNo() {
  const row = await one(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_no, '[^0-9]', '', 'g'), '')::int), 0) AS max_no
       FROM org_user
      WHERE employee_no ~ '^DT[0-9]+$'`
  );
  const next = Number(row?.max_no || 0) + 1;
  return `DT${String(next).padStart(4, '0')}`;
}
