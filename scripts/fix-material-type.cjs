/**
 * 物料类型清洗：把库里的非标准写法折成标准 9 类。
 * 目前已知：other(11 条) → 其他，electronic(3 条) → 电子通用件。
 * 原则：只做同义归一，不做业务归类；认不出来的值原样保留并打印出来供人工确认。
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

const STANDARD = ['塑胶件', '五金件', '磁性器件', '电子通用件', '辅料', '包材', 'PCB', '线材', '其他'];
const ALIASES = {
  其他: '其他',
  其它: '其他',
  other: '其他',
  others: '其他',
  未分类: '其他',
  塑胶件: '塑胶件',
  塑胶: '塑胶件',
  plastic: '塑胶件',
  五金件: '五金件',
  五金: '五金件',
  metal: '五金件',
  磁性器件: '磁性器件',
  磁性: '磁性器件',
  magnetic: '磁性器件',
  电子通用件: '电子通用件',
  电子: '电子通用件',
  electronic: '电子通用件',
  辅料: '辅料',
  耗材: '辅料',
  包材: '包材',
  包装: '包材',
  包装材料: '包材',
  pcb: 'PCB',
  线材: '线材',
  线缆: '线材',
};

(async () => {
  const before = await sql`select material_type t, count(*)::int n from material group by 1 order by n desc`;
  console.log('清洗前：', before.map((r) => `${r.t ?? '(空)'}=${r.n}`).join('  '));

  let changed = 0;
  for (const row of before) {
    const raw = (row.t || '').trim();
    if (!raw) continue;
    const target = ALIASES[raw.toLowerCase()];
    if (target && target !== raw) {
      const res = await sql`update material set material_type = ${target} where material_type = ${row.t} returning material_code`;
      changed += res.length;
      console.log(`  ${row.t} → ${target}：${res.length} 条`);
    } else if (!STANDARD.includes(raw)) {
      console.log(`  ⚠ 未识别的类型「${raw}」${row.n} 条，已保留（请人工确认应归入哪一类）`);
    }
  }

  const after = await sql`select material_type t, count(*)::int n from material group by 1 order by n desc`;
  console.log('清洗后：', after.map((r) => `${r.t ?? '(空)'}=${r.n}`).join('  '));
  console.log(`共修改 ${changed} 条`);
  await sql.end();
})().catch(async (e) => {
  console.error('失败：', e.message);
  try { await sql.end(); } catch {}
  process.exit(1);
});
