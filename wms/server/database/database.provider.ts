import { Provider } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DRIZZLE_DATABASE = 'DRIZZLE_DATABASE';
export type PostgresJsDatabase = ReturnType<typeof drizzle<typeof schema>>;

/**
 * 数据库 schema。
 *
 * 2026-11-08：工厂各系统已合并到 PostgreSQL 的单一 schema `rjvn`
 * （原 wms / oa / smt / mgmt / mes 均已 DROP）。应用侧所有 SQL 都用
 * 不带 schema 前缀的表名（drizzle schema 定义里也是裸表名），
 * 因此连接必须把 search_path 指到 `rjvn`，否则一律报
 * `42P01 relation "xxx" does not exist`（public 下已无业务表）。
 *
 * 覆盖方式（优先级从高到低）：
 *   1. `DATABASE_URL` 自带 `?options=-csearch_path%3Drjvn`（URL 编码，`,` 编码为 %2C）
 *   2. `DB_SCHEMA` 环境变量（默认 `rjvn`）
 */
const DB_SCHEMA = process.env.DB_SCHEMA || 'rjvn';

/**
 * 在连接串上追加 search_path。
 *
 * libpq 的 options 形如 `-csearch_path=rjvn,public`；
 * 放进 URL 时 `=` 编码为 %3D、`,` 编码为 %2C（URLSearchParams 会自动编码）。
 * 用户若已在 DATABASE_URL 里显式指定了 search_path，则保留用户设置不覆盖。
 */
function withSearchPath(connectionString: string, schemaName: string): string {
  const option = `-csearch_path=${schemaName},public`;

  const url = new URL(connectionString);
  const existing = url.searchParams.get('options');
  if (existing) {
    if (existing.includes('search_path')) {
      // 用户已显式指定 search_path，保留用户的设置
      return connectionString;
    }
    url.searchParams.set('options', `${existing} ${option}`);
  } else {
    url.searchParams.set('options', option);
  }
  return url.toString();
}

export const databaseProvider: Provider = {
  provide: DRIZZLE_DATABASE,
  useFactory: () => {
    const baseConnectionString =
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'wms'}`;

    const connectionString = withSearchPath(baseConnectionString, DB_SCHEMA);

    const queryClient = postgres(connectionString, { max: 10 });
    const db = drizzle(queryClient, { schema });
    return db;
  },
};
