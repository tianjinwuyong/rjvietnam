/**
 * 修复/校验数据：把 msl_level 里被 shell 编码搞坏的 '???' 改回「不管控」，
 * 顺带全表扫一遍是否还有 '???' 之类的坏值。
 * 注意：中文必须由 Node 进程写入（postgres 驱动 UTF-8），不要用 psql 命令行传中文。
 */
const postgres = require('postgres');
require('dotenv').config();

const sql = postgres({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'wms',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  onnotice: () => {},
});

(async () => {
  const bad = await sql`select material_code, msl_level from material where msl_level in ('???', '?', '??')`;
  console.log('待修复行：', bad.length);

  const fixed = await sql`
    update material set msl_level = ${'不管控'}
    where msl_level in ('???', '?', '??')
    returning material_code, msl_level`;
  console.log('已修复：', fixed.length, JSON.stringify(fixed));

  // 其他表/列里是否残留 '???'（典型的编码坏值）
  const checks = [
    ['material', 'material_type'],
    ['material', 'grade'],
    ['material', 'material_name'],
    ['supplier', 'supplier_name'],
  ];
  for (const [table, col] of checks) {
    const rows = await sql.unsafe(
      `select count(*)::int as n from ${table} where ${col} like '%?%'`,
    );
    console.log(`  ${table}.${col} 含? 的行数：`, rows[0].n);
  }

  const dist = await sql`
    select msl_level, count(*)::int as n,
           encode(convert_to(msl_level, 'UTF8'), 'hex') as hex
    from material group by msl_level order by n desc`;
  console.log('MSL 分布：', JSON.stringify(dist, null, 0));

  await sql.end();
})().catch(async (e) => {
  console.error('失败：', e.message);
  try { await sql.end(); } catch {}
  process.exit(1);
});
