/**
 * 执行 MRB v2 迁移（server/database/mrb-v2-20261018.sql）
 *
 * 用法：node scripts/apply-mrb-v2.cjs
 * 特性：幂等；全部语句执行后回读字段做校验；任一语句失败即中止。
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

function loadEnv() {
  const file = path.resolve(__dirname, '..', '.env');
  const raw = fs.readFileSync(file, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

(async () => {
  const env = loadEnv();
  const sql = postgres({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    max: 1,
    onnotice: () => {},
  });

  const file = path.resolve(__dirname, '..', 'server', 'database', 'mrb-v2-20261018.sql');
  const content = fs.readFileSync(file, 'utf8');

  // 去掉整行注释后按分号拆分
  const body = content
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements = body
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let applied = 0;
  for (const stmt of statements) {
    try {
      await sql.unsafe(stmt);
      applied++;
    } catch (e) {
      console.error('✗ 执行失败：', stmt.slice(0, 120).replace(/\s+/g, ' '));
      console.error('  ', e.message);
      await sql.end();
      process.exit(1);
    }
  }

  const reviewCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'mrb_review'
      AND column_name IN ('completeness_result','completeness_by','completeness_time','completeness_remark','is_urgent','urgent_reason')
    ORDER BY column_name`;
  const dispCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'mrb_disposition'
      AND column_name IN ('ref_no','hold_until')
    ORDER BY column_name`;

  console.log(`✓ 已执行 ${applied} 条语句`);
  console.log('✓ mrb_review 新字段：', reviewCols.map((c) => c.column_name).join(', ') || '(空)');
  console.log('✓ mrb_disposition 新字段：', dispCols.map((c) => c.column_name).join(', ') || '(空)');

  await sql.end();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
