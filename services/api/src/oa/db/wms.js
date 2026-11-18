// ============================================================
// wms —— WMS（仓储系统）只读连接池
//
// 配置来源：integration-config（数据库配置优先，.env 兜底）。
//   · 管理员在「对接配置」页保存后无需重启：连接池会被重置并按新配置重建。
//   · 只读：这里只允许 SELECT，绝不写 WMS 业务表。
//   · 懒连接 + 失败降级：未配置/连不上时 wmsPing()=false，页面正常降级。
// ============================================================
import pg from 'pg';
import { getWmsDbConfig, ensureIntegrationLoaded } from '../services/integration-config.js';

const { Pool } = pg;

let pool = null;

/** 取连接池（首次调用或配置变更后创建）；未配置密码则视为未接入 */
export function wmsPool() {
  const c = getWmsDbConfig();
  if (!c.password) return null;
  if (!pool) {
    pool = new Pool({
      host: c.host,
      port: Number(c.port || 5432),
      database: c.database,
      user: c.user,
      password: c.password,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    // 空闲连接报错不应该让进程崩掉（WMS 重启时常见）
    pool.on('error', () => {});
  }
  return pool;
}

/** 配置变更后重建连接池（保存配置时调用） */
export function resetWmsPool() {
  if (pool) {
    pool.end().catch(() => {});
    pool = null;
  }
}

/** 只读查询；连接不可用或 SQL 出错 → 抛错，由调用方降级处理 */
export async function wmsQuery(text, params = []) {
  await ensureIntegrationLoaded();
  const p = wmsPool();
  if (!p) throw new Error('WMS 数据库未配置（请在「对接配置」中填写数据库密码）');
  const res = await p.query(text, params);
  return res.rows;
}

/** 连通性探测（页面用来决定是否显示"WMS 未接入"提示） */
export async function wmsPing() {
  try {
    await wmsQuery('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}
