// 认证中间件与统一响应工具
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { resolveUserByUsername } from '../services/auth.js';
import { checkModuleAccess } from '../services/module-permission.js';
import { query } from '../db/index.js';

/**
 * 合并模式唯一令牌：校验 SMT 登录 JWT 并映射到 OA 用户。
 * · 签名密钥与 SMT 侧完全一致（process.env.JWT_SECRET，server.js 启动时已校验非占位值）。
 * · 只认 username：OA 侧权限/角色以 oa.org_user 为准，不采信 SMT token 里的
 *   permissions/roleKey（两套权限模型语义不同，混用会越权）。
 * · 无 JWT_SECRET 或验签失败/用户不存在 → null（走原生 401 文案）。
 */
async function resolveSmtJwtUser(token) {
  const secret = String(process.env.JWT_SECRET ?? '').trim();
  if (!secret || !token) return null;
  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch {
    return null;
  }
  const username = String(payload?.username || '').trim();
  if (!username) return null;
  try {
    return await resolveUserByUsername(username);
  } catch (err) {
    console.error('[oa-auth] SMT JWT 用户映射失败:', err.message);
    return null;
  }
}

export function ok(reply, data = null, msg = 'ok') {
  return { code: 0, msg, data };
}

export function fail(reply, code, msg) {
  reply.code(code);
  return { code: 1, msg };
}

export async function authenticate(req, reply) {
  // 外部系统（如 WMS）用 API Key 调用：不建 session，直接以服务身份执行
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const hash = crypto.createHash('sha256').update(String(apiKey)).digest('hex');
    const keyRow = (await query(
      `SELECT * FROM sys_api_key WHERE key_hash=$1 AND active=TRUE`, [hash]
    )).rows[0];
    if (!keyRow) return reply.code(401).send({ code: 1, msg: 'API Key 无效' });
    // 服务身份必须是非管理员，避免 API Key 借 admin 绕过业务权限（最小权限）
    // 推荐用专用的机器人账号（OA_SERVICE_USER_ID 指定），不要借用真人账号：
    // 借用真人会导致「认领/审批/记录归属」出现幽灵操作人与自审冲突（安全审计 #4）。
    // 服务身份：优先该 Key 绑定的 service_user_id，其次 OA_SERVICE_USER_ID，最后回退首个非管理员
    const svcId = keyRow.service_user_id || Number(process.env.OA_SERVICE_USER_ID) || null;
    const svc = svcId
      ? (await query(
        `SELECT * FROM org_user WHERE id = $1 AND is_admin = FALSE AND active = TRUE`,
        [Number(svcId)]
      )).rows[0]
      : (await query(
        // 兜底优先取「系统账号」（wms_bot 这类），否则会按 id 顺序抓到一个真人，
        // 让外部系统的操作全都记在那个真人头上。
        `SELECT * FROM org_user WHERE is_admin=FALSE AND active=TRUE
          ORDER BY (NOT COALESCE(is_system,FALSE)), id LIMIT 1`
      )).rows[0];
    if (!svc) return reply.code(500).send({ code: 1, msg: '未配置外部系统服务账号（需要一个非管理员账号）' });
    req.user = {
      ...svc,
      permissions: keyRow.permissions || [],
      // 🔒 服务身份绝不能因为 API Key 带了某个权限码就成为管理员：
      // 曾经是 `isAdmin: permissions.includes('flow:config')`，等于把「配置流程」这一条
      // 权限放大成「全站管理员」（可越过 requirePermission、可访问所有单据）。
      isAdmin: false,
      isApi: true,
    };
    return;
  }

  const auth = req.headers.authorization || '';
  // 支持三种传 token 方式：Authorization 头 / x-token 头 / query 参数（文件下载新窗口场景）
  let token = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-token'];
  if (!token && req.query && req.query.token) token = req.query.token;
  // 合并模式单一令牌：只认 SMT 登录签发的 JWT。
  // · SMT 前端 apiClient 与内嵌 OA 前端（iframe ?token= 注入）都用同一个 JWT；
  //   不再签发/校验 OA 自有 sys_session 会话（登录统一走 SMT 的 /api/auth/login）。
  // · 校验签名 → 按用户名映射 oa.org_user → 权限/模块档案与原会话用户同构。
  // · 无 JWT_SECRET 或验签失败/用户不存在 → 401（与原会话失效文案一致）。
  const smtUser = await resolveSmtJwtUser(token);
  if (!smtUser) {
    return reply.code(401).send({ code: 1, msg: '登录已失效，请重新登录' });
  }
  req.user = smtUser;
  req.token = token;

  // 模块级闸门（浏览/操作/无权限）：认证完成后按路径前缀判定，
  // 未登记为模块的路径放行，避免误伤登录、上传、待办等公共接口。
  const denied = await checkModuleAccess(req);
  if (denied) return reply.code(denied.status).send({ code: 1, msg: denied.msg });
}

/** 权限校验：在路由上声明需要的权限码 */
export function requirePermission(permCode) {
  return async (req, reply) => {
    if (req.user.isAdmin) return;
    if (!req.user.permissions.includes(permCode)) {
      return reply.code(403).send({ code: 1, msg: '没有该操作的权限' });
    }
  };
}

/**
 * 权限校验（任一命中即可）：同一份数据被多个岗位共用时使用，
 * 例如卡点列表对考勤管理 / 排班 / 卡点查看三个角色开放。
 */
export function requireAnyPermission(...permCodes) {
  return async (req, reply) => {
    if (req.user.isAdmin) return;
    const perms = req.user.permissions || [];
    if (!permCodes.some(code => perms.includes(code))) {
      return reply.code(403).send({ code: 1, msg: '没有该操作的权限' });
    }
  };
}

/** 通用系统错误文案（对外统一，绝不回显 SQL/表名/列名/驱动原文） */
const GENERIC_500 = '服务器内部错误';

/**
 * PostgreSQL SQLSTATE → 安全响应映射。
 * 对应错误码含义见 PG 官方文档；此处只对外暴露「用户可理解」的文案。
 */
const PG_ERROR_MAP = {
  '22P02': { status: 400, msg: '请求参数格式不正确' },   // invalid_text_representation
  '22003': { status: 400, msg: '请求参数格式不正确' },   // numeric_value_out_of_range
  '22001': { status: 400, msg: '请求参数格式不正确' },   // string_data_right_truncation（值过长）
  '42703': { status: 400, msg: '请求参数格式不正确' },   // undefined_column
  '42804': { status: 400, msg: '请求参数格式不正确' },   // datatype_mismatch
  '23505': { status: 409, msg: '数据已存在，请勿重复提交' }, // unique_violation
  '23503': { status: 400, msg: '关联数据不存在' },        // foreign_key_violation
  '23502': { status: 400, msg: '缺少必填字段' },          // not_null_violation
  '42P01': { status: 500, msg: GENERIC_500 },            // undefined_table
};

/**
 * 是否为数据库/驱动层错误（携带 5 位 SQLSTATE code）。
 * 这类错误的 message 常含 SQL/表名/列名/驱动原文，必须脱敏。
 */
function isDbError(err) {
  return !!(err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code));
}

/** 是否为编程/系统级异常（非业务校验，不应透传内部信息） */
function isSystemError(err) {
  return err instanceof TypeError || err instanceof ReferenceError
    || err instanceof SyntaxError || err instanceof RangeError;
}

/**
 * 统一错误出口归一化：把任意异常映射为「安全」的 { status, msg }。
 *
 * 规则（优先级从高到低）：
 *   1) 数据库/驱动错误 → 命中 PG_ERROR_MAP 则用映射；否则一律通用 500（不回显原文）；
 *   2) 明确的业务错误（`err.isBiz === true` 或 `statusCode` 为 4xx）→ 透传其消息；
 *   3) 显式 5xx（`statusCode >= 500`）→ 通用文案；
 *   4) 编程/系统异常（TypeError 等）→ 通用 500；
 *   5) 其余普通异常（服务层普遍以 `new Error('中文业务提示')` 抛出）→ 400 透传受控文案。
 *
 * @param {Error|*} err
 * @returns {{ status:number, msg:string }}
 */
export function resolveErrorResponse(err) {
  if (isDbError(err)) {
    return PG_ERROR_MAP[err.code] || { status: 500, msg: GENERIC_500 };
  }
  const sc = Number(err?.statusCode);
  if (err?.isBiz === true || (Number.isInteger(sc) && sc >= 400 && sc < 500)) {
    return { status: Number.isInteger(sc) ? sc : 400, msg: err?.message || '操作失败' };
  }
  if (Number.isInteger(sc) && sc >= 500) {
    return { status: sc, msg: GENERIC_500 };
  }
  if (isSystemError(err)) {
    return { status: 500, msg: GENERIC_500 };
  }
  const msg = typeof err?.message === 'string' && err.message.trim() ? err.message.trim() : '操作失败';
  return { status: 400, msg };
}

/** 包装异步路由，统一异常出口（脱敏：DB/系统异常不回显原文） */
export function wrap(fn) {
  return async (req, reply) => {
    try {
      const result = await fn(req, reply);
      if (result !== undefined && !reply.sent) return reply.send(result);
    } catch (err) {
      req.log.error({ err }, '接口异常');
      if (!reply.sent) {
        const { status, msg } = resolveErrorResponse(err);
        reply.code(status);
        return reply.send({ code: 1, msg });
      }
    }
  };
}