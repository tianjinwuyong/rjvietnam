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

/**
 * 启动断言：连接必须落在整合库 + 单一业务 schema，否则立刻失败。
 *
 * 2026-11-09：单 schema 合并后旧库（wms / smt_factory / oa_system / rjvn_mgmt）仍留在实例上，
 * 而**写错库不会报错**：READ 200 / WRITE 201 都过，数据只是静默写进旧库。
 * 因此建连时立刻核对 current_database() / current_schema() / search_path：
 * 不符合预期就 fail fast，绝不带病启动。
 *
 * 逃生口：`ALLOW_DB_MISMATCH=1` 时只打 warn 不抛（仅供一次性排查或临时本地库）。
 */
const EXPECTED_DATABASE = process.env.EXPECT_DB_NAME || 'factory';

function parseSearchPath(searchPath: string | null | undefined): string[] {
  return (searchPath || '')
    .split(',')
    .map((part) => part.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

async function assertConsolidatedDatabase(queryClient: postgres.Sql): Promise<void> {
  const rows = await queryClient<{ database: string; schema: string | null; search_path: string }[]>`
    select current_database() as database,
           current_schema() as schema,
           current_setting('search_path') as search_path
  `;
  const row = rows[0];
  const searchPath = parseSearchPath(row?.search_path);
  const problems: string[] = [];

  if (row?.database !== EXPECTED_DATABASE) {
    problems.push(`current_database()=${row?.database ?? '(未知)'}，期望 ${EXPECTED_DATABASE}`);
  }
  if (!searchPath.includes(DB_SCHEMA)) {
    problems.push(`search_path=${row?.search_path ?? '(未知)'}，未包含 ${DB_SCHEMA}`);
  }

  if (problems.length === 0) {
    return;
  }

  const detail = problems.join('；');
  if (process.env.ALLOW_DB_MISMATCH === '1') {
    console.warn(`[db] 启动断言未通过但已放行（ALLOW_DB_MISMATCH=1）：${detail}`);
    return;
  }

  throw new Error(
    `[db] 启动断言失败：${detail}。` +
      `应用必须连接整合库 ${EXPECTED_DATABASE} 且 search_path 包含 ${DB_SCHEMA}；` +
      `写错库不会报错，只会静默把数据写进旧库。` +
      `（确需临时指向别的库时设置 ALLOW_DB_MISMATCH=1，仅打警告不阻断。）`,
  );
}

export const databaseProvider: Provider = {
  provide: DRIZZLE_DATABASE,
  useFactory: async () => {
    const baseConnectionString =
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'factory'}`;

    const connectionString = withSearchPath(baseConnectionString, DB_SCHEMA);

    const queryClient = postgres(connectionString, { max: 10 });
    await assertConsolidatedDatabase(queryClient);
    const db = drizzle(queryClient, { schema });
    return db;
  },
};
