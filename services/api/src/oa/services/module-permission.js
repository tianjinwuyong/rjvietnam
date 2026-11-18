// 模块级权限：浏览 / 操作 / 无权限
// ------------------------------------------------------------
// 设计（2026-10-28 用户确认）：
//   · 默认收紧为「全员统一基线」：我的工资单(浏览)、体系文件(浏览)、
//     Near Miss / 休假 / 签卡(可发起)；其余模块一律无权限，需显式授权。
//   · 电子流按单据类型逐条授权（flow:<flow_definition.code>）。
//   · 「自己是审批节点的电子流」不受模块限制 —— 审批人在实例级始终可见可审，
//     详见 routes/flow.js 的 approveTask 与可见性口径。
//   · admin 角色恒不受限。
//
// 级别语义：
//   none    接口 403 / 菜单隐藏
//   view    只读（GET/HEAD），写操作 403
//   operate 全功能，并把该模块的权限码并入（角色没配也能操作）
import { query } from '../db/index.js';

const MODULE_TTL = 60 * 1000;
const USER_TTL = 60 * 1000;

let modCache = { at: 0, list: [], prefixes: [] };
let userCache = new Map();      // userId -> { at, levels }

/** 只读类权限码（view 级别只保留这些） */
const isReadCode = (c) => /:(view|borrow)$/.test(c);

/**
 * 准入权限码兜底：模块级别为 none 时，持有 enter_perm_codes 中任一权限码即视为 operate。
 *
 * 为什么需要：模块授权按「职级 / 人工」开通，权限码按「角色」发放，两条线天然不同步。
 * 典型翻车：审核人拿到 attend:schedule_approve，但没人给他开 schedule_plan 模块，
 * 结果请求在 checkModuleAccess 就被 403，连路由自己的 requireAnyPermission 都走不到，
 * 表现成「有审核权却打不开页面」。
 */
function levelWithEnterCodes(mod, lv, perms) {
  if (lv !== 'none') return lv;
  const codes = mod.enter_perm_codes || [];
  if (!codes.length || !perms) return lv;
  // 调用方有的传数组（req.user.permissions），有的传 Set（attachModuleProfile 内部），
  // 这里统一适配，别假设类型 —— 混用会让整个登录接口 500。
  const has = typeof perms.has === 'function'
    ? (c) => perms.has(c)
    : (c) => perms.includes(c);
  return codes.some(has) ? 'operate' : lv;
}

async function loadModules() {
  const now = Date.now();
  if (modCache.list.length && now - modCache.at < MODULE_TTL) return modCache;
  const rows = (await query(
    `SELECT code, name, name_vi, grp, kind, sort, baseline_level,
            api_prefixes, fe_paths, perm_codes, enter_perm_codes, active
       FROM sys_module WHERE active = TRUE ORDER BY sort, code`
  )).rows;
  const prefixes = [];
  for (const m of rows) {
    for (const p of (m.api_prefixes || [])) prefixes.push({ prefix: p, module: m });
  }
  // 最长前缀优先：/api/payroll/self 必须压过 /api/payroll
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  modCache = { at: now, list: rows, prefixes };
  return modCache;
}

/** 按请求路径找模块（同步，用缓存；未命中返回 null 表示不拦） */
export function moduleForPath(path) {
  if (!path) return null;
  for (const p of modCache.prefixes) {
    if (path === p.prefix || path.startsWith(p.prefix + '/')) return p.module;
  }
  return null;
}

/** 用户各模块最终级别：显式授权 > 全员基线 > 无权限 */
export async function getUserModuleLevels(userId) {
  const key = Number(userId);
  const hit = userCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < USER_TTL) return hit.levels;

  const { list } = await loadModules();
  const grants = (await query(
    `SELECT module_code, level FROM sys_module_grant WHERE user_id = $1`, [key]
  )).rows;
  const gmap = new Map(grants.map(g => [g.module_code, g.level]));

  const levels = {};
  for (const m of list) {
    const lv = gmap.get(m.code) ?? m.baseline_level ?? 'none';
    levels[m.code] = lv;
  }
  userCache.set(key, { at: now, levels });
  return levels;
}

export function invalidateUser(userId) {
  if (userId === undefined || userId === null) userCache.clear();
  else userCache.delete(Number(userId));
}

export function invalidateModules() {
  modCache = { at: 0, list: [], prefixes: [] };
  userCache.clear();
}

/** 把模块级别折算进权限码，并挂到 profile 上（供 /api/auth/* 与中间件共用） */
export async function attachModuleProfile(user) {
  if (!user) return user;
  if (user.isAdmin || user.isApi || user.isSystem) {
    user.moduleLevels = null;   // null = 不受模块限制
    return user;
  }
  const { list } = await loadModules();
  const levels = await getUserModuleLevels(user.id);
  const perms = new Set(user.permissions || []);

  // ---------- 准入权限码的判定基准 ----------
  // 语义：「准入码 = 你属于这个领域的人」，它是进门的票，不是操作权。
  // 一个码可以有两个来源，两个都算数：
  //   (a) 角色直接发的（如 gm_assistant 的 attend:schedule_approve）；
  //   (b) 别的模块按 operate 级别折算进来的（如 attendance 开 operate → attend:schedule）。
  //
  // 不能直接用 user.permissions：下面按模块 sort 逐条「先删该模块全部码、再按级别回填」，
  // 这个清理会跨模块污染 —— attendance(sort 90) 的 perm_codes 含 attend:schedule，
  // 轮到 schedule_plan(sort 132) 判断时它已被删掉，导致 hr 角色账号被判 none → 整页 403。
  // 而 gm_assistant 当时能过，纯粹因为 attend:schedule_approve 恰好不在 attendance.perm_codes 里
  // —— 同一段代码对两种角色行为相反，说明判定依据错了。
  //
  // 所以先做一遍「只算其他模块按级别授予的码」，再与角色码合并作为判定基准。
  // 注意：这一遍不带准入码（不做链式推导），避免 A 靠 B 的准入码、B 靠 A 的准入码这种环。
  const granted = new Set();
  for (const m of list) {
    const codes = m.perm_codes || [];
    if (!codes.length) continue;
    const lv = levels[m.code] || 'none';
    if (lv === 'operate') for (const c of codes) granted.add(c);
    else if (lv === 'view') for (const c of codes) if (isReadCode(c)) granted.add(c);
  }
  const enterBase = new Set([...perms, ...granted]);

  for (const m of list) {
    // 准入权限码兜底：先把级别修正过来（levels 是本用户独享的缓存对象，可原地改）
    levels[m.code] = levelWithEnterCodes(m, levels[m.code] || 'none', enterBase);

    const codes = m.perm_codes || [];
    if (!codes.length) continue;
    const lv = levels[m.code] || 'none';
    // 先清掉该模块的全部码，再按级别回填，保证「无权限」真的无效
    for (const c of codes) perms.delete(c);
    if (lv === 'operate') for (const c of codes) perms.add(c);
    else if (lv === 'view') for (const c of codes) if (isReadCode(c)) perms.add(c);
  }

  user.permissions = [...perms];
  user.moduleLevels = levels;
  return user;
}

/**
 * 请求级闸门。返回 null 表示放行，否则 { status, msg }。
 * 未登记为模块的路径一律放行（避免误伤登录/上传/待办等公共接口）。
 */
export async function checkModuleAccess(req) {
  const user = req.user;
  if (!user || user.isAdmin || user.isApi || user.isSystem) return null;

  const url = String(req.url || '');
  const path = url.split('?')[0];
  if (!path.startsWith('/api/')) return null;

  await loadModules();          // 保证前缀表已就绪（有缓存，代价可忽略）
  const mod = moduleForPath(path);
  if (!mod) return null;

  const levels = user.moduleLevels || await getUserModuleLevels(user.id);
  // 有 moduleLevels：准入码已在 attachModuleProfile 里用「原始角色权限快照」修正过，直接用；
  // 没有（未经过 profile 组装的少见路径）：此时 user.permissions 本身就是原始角色权限，可就地补判。
  // 绝不能拿已清理的 user.permissions 重判 —— 那会把 hr 这类角色判成 none（详见 attachModuleProfile 注释）。
  const lv = user.moduleLevels
    ? (levels[mod.code] || 'none')
    : levelWithEnterCodes(mod, levels[mod.code] || 'none', user.permissions || []);
  if (lv === 'none') {
    return { status: 403, msg: `没有「${mod.name}」的访问权限，请联系管理员开通` };
  }
  const method = String(req.method || 'GET').toUpperCase();
  const readOnly = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  if (!readOnly && lv === 'view') {
    return { status: 403, msg: `只有「${mod.name}」的浏览权限，不能进行操作` };
  }
  return null;
}

/** 单个模块的级别（给 flow 路由判断单据类型用） */
export function levelOf(user, moduleCode) {
  if (!user) return 'none';
  if (user.isAdmin || user.isApi || user.isSystem) return 'operate';
  const levels = user.moduleLevels;
  if (!levels) return 'none';
  return levels[moduleCode] || 'none';
}

export const flowModuleCode = (defCode) => `flow:${defCode}`;

export async function listModules() {
  const { list } = await loadModules();
  return list;
}
