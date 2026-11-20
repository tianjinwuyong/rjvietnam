/**
 * 系统初始化时间基点（单位：秒）。
 *
 * 为什么需要它：
 *   JWT 是无状态的，签发后在有效期内（7 天）无法单独撤销。
 *   「系统初始化」会把除 admin 外的全部账号删掉，若不作废旧令牌，
 *   被删账号手里的令牌在过期前仍然能正常调用接口 —— 相当于初始化白做。
 *
 * 做法：
 *   初始化时把「初始化时刻」写进 sys_param（key = system.init_epoch），
 *   同时更新本模块的内存值；鉴权守卫比对令牌的签发时间 iat，
 *   早于该基点的令牌一律判定为失效，要求重新登录。
 *
 * 性能：
 *   内存值在服务启动时从数据库载入一次，此后每个请求只做一次数值比较，
 *   不产生任何数据库查询。
 */

let systemEpochSeconds = 0;

/** 当前生效的初始化时间基点（秒）；0 表示从未初始化过 */
export function getSystemEpoch(): number {
  return systemEpochSeconds;
}

/** 更新初始化时间基点（初始化成功后立即调用） */
export function setSystemEpoch(seconds: unknown): void {
  const n = Number(seconds);
  systemEpochSeconds = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 令牌是否早于初始化基点。
 *
 * 令牌没有 `iat` 时返回 false（放行）—— 本项目签发的令牌一律带 iat，
 * 这里不放行会造成「偶发全体掉线」，代价大于收益。
 */
export function isTokenBeforeEpoch(iat?: number): boolean {
  if (!systemEpochSeconds) return false;
  if (!iat || !Number.isFinite(iat)) return false;
  return iat < systemEpochSeconds;
}
