// 启动断言的运行期实证：直接调用构建产物的 provider factory
// 1) 正确 DSN（factory + search_path=rjvn,public）→ 必须成功
// 2) 错误 DSN（指向旧库 wms，且不带 search_path）→ 必须抛错（fail fast）
// 3) 错误 DSN + 逃生口 ALLOW_DB_MISMATCH=1 → 必须放行（只打警告）
//
// 用法：先 `npm run build:server`，再 `node scripts/check-db-assertion.cjs`
const path = require('path');

const providerPath = path.join(__dirname, '..', 'dist', 'database', 'database.provider.js');

async function run(label, env, expectThrow) {
  Object.keys(env).forEach((k) => {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  });
  const { databaseProvider } = require(providerPath);
  const factory = databaseProvider.useFactory;
  let outcome = 'RESOLVED';
  let detail = 'provider 返回 drizzle 实例';
  try {
    const db = await factory();
    void db;
  } catch (err) {
    outcome = 'THREW';
    detail = String(err.message).split('\n')[0].slice(0, 220);
  }
  const ok = expectThrow ? outcome === 'THREW' : outcome === 'RESOLVED';
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}: ${outcome} — ${detail}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  await run(
    '正确 DSN → 应当放行',
    {
      DATABASE_URL: undefined,
      DB_HOST: '127.0.0.1',
      DB_PORT: '5432',
      DB_USER: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_NAME: 'factory',
      ALLOW_DB_MISMATCH: undefined,
    },
    false,
  );

  await run(
    '错误 DSN（旧库 wms）→ 应当 fail fast',
    {
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/wms',
      ALLOW_DB_MISMATCH: undefined,
    },
    true,
  );

  await run(
    '错误 DSN + ALLOW_DB_MISMATCH=1 → 应当放行',
    {
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/wms',
      ALLOW_DB_MISMATCH: '1',
    },
    false,
  );

  process.exit(process.exitCode || 0);
})();
