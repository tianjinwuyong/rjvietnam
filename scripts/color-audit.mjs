#!/usr/bin/env node
/**
 * 硬编码颜色审计（3.3）
 * ---------------------------------------------------------------------------
 * 方案里 3.3 的原文是「脚本出建议、人工 accept」——因为灰阶类换成语义色
 * 会改变视觉（同一个 gray-500 在浅色下是"次要文字"、在深色下可能是"禁用"），
 * 自动替换会把语义改错。所以本脚本只**出清单**，不改代码。
 *
 * 用法：
 *   node scripts/color-audit.mjs            → 控制台汇总
 *   node scripts/color-audit.mjs --csv      → 输出 CSV（便于逐条 accept/reject）
 *
 * 判定依据：优先用仓库里已有的语义 token（--foreground / --muted-foreground /
 * --border / --muted / --card …），这些在 7 套主题里都有定义，换肤自动跟随。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'client', 'src');

/** 灰阶 → 语义 token 的建议映射（按 Tailwind 灰阶的一般用法推断） */
const GRAY_MAP = {
  50: 'muted', 100: 'muted', 200: 'border', 300: 'border',
  400: 'muted-foreground', 500: 'muted-foreground', 600: 'muted-foreground',
  700: 'foreground', 800: 'foreground', 900: 'foreground',
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

/**
 * 豁免：这两处本身就是"颜色的定义处"，出现十六进制色值是本职，不是债务。
 *   theme/palettes.ts       —— 7 套主题的调色板
 *   theme/ThemeProvider.tsx —— 图表取色的兜底值
 * 不排除它们，统计会被放大 3 倍（实测 530 处里有 355 处在这里）。
 */
const EXEMPT = ['theme\\palettes.ts', 'theme\\ThemeProvider.tsx'];

const rows = [];
const grayCount = {};
const hexCount = {};

for (const f of walk(SRC)) {
  if (EXEMPT.some((e) => f.replace(/\//g, '\\').endsWith(e))) continue;
  const text = readFileSync(f, 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    // 灰阶类：text-gray-500 / bg-gray-100 / border-gray-200
    for (const m of line.matchAll(/\b(text|bg|border|divide|ring)-gray-(\d{2,3})\b/g)) {
      const [all, kind, shade] = m;
      const token = GRAY_MAP[shade];
      rows.push({
        file: relative(ROOT, f), line: i + 1, kind: 'gray',
        found: all,
        suggest: token ? `${kind}-[var(--${token})]` : '(无对应 token，需人工判断)',
        note: token ? '' : '灰阶超出常用范围',
      });
      grayCount[shade] = (grayCount[shade] || 0) + 1;
    }
    // 明确色值：className 或 style 里的 #rrggbb
    for (const m of line.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
      rows.push({
        file: relative(ROOT, f), line: i + 1, kind: 'hex',
        found: `#${m[1]}`, suggest: '(需人工判断：装饰色可保留，语义色换 var(--x))', note: '硬编码色值',
      });
      hexCount[m[1].toLowerCase()] = (hexCount[m[1].toLowerCase()] || 0) + 1;
    }
  });
}

const grayTotal = Object.values(grayCount).reduce((a, b) => a + b, 0);
const hexTotal = Object.values(hexCount).reduce((a, b) => a + b, 0);

console.log('=== 硬编码颜色审计 ===');
console.log(`灰阶工具类: ${grayTotal} 处`);
for (const k of Object.keys(grayCount).sort((a, b) => grayCount[b] - grayCount[a])) {
  console.log(`  gray-${k}: ${grayCount[k]}  →  建议 var(--${GRAY_MAP[k] ?? '?'})`);
}
console.log(`\n硬编码色值: ${hexTotal} 处（去重 ${Object.keys(hexCount).length} 种）`);
const topHex = Object.entries(hexCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [hex, n] of topHex) console.log(`  #${hex}: ${n} 次`);

if (process.argv.includes('--csv')) {
  const out = join(ROOT, 'color-audit.csv');
  const csv = ['file,line,kind,found,suggest,note']
    .concat(rows.map((r) => `${r.file},${r.line},${r.kind},${r.found},"${r.suggest}",${r.note}`))
    .join('\n');
  writeFileSync(out, '\ufeff' + csv, 'utf8');
  console.log(`\n已导出 ${rows.length} 条到 color-audit.csv（可用 Excel 逐条 accept/reject）`);
}

console.log('\n注意：本脚本只出建议，不改代码。灰阶换语义色会改变视觉，');
console.log('      必须在 7 套主题下逐条确认后才可 accept（方案 3.3 原文要求）。');
