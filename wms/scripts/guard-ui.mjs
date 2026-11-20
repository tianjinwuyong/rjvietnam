#!/usr/bin/env node
/**
 * UI 尺寸护栏（零依赖）
 * ---------------------------------------------------------------------------
 * 替代 ESLint：本项目 node_modules 里没有 eslint / typescript-eslint /
 * @lark-apaas/fullstack-presets（eslint.config.js 引用了它们但从未安装），
 * 装齐需新增约 40MB 依赖，而 node_modules 是随绿色包拷给客户的，
 * 违反"不新增依赖"的交付约束。故选零依赖脚本，只守真正会退化的几条。
 *
 * 用法：node scripts/guard-ui.mjs     （npm run guard）
 * 失败时 exit 1，可直接挂到 CI / 提交前钩子。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CLIENT_SRC = join(ROOT, 'client', 'src');

/** 去掉块注释与行注释，避免"注释里提到的写法"被误判为实际代码 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** 打印文档的 padding 是纸张排版，不属于屏幕密度，豁免 */
const isPrintDoc = (f) => /[\\/]print[\\/]/.test(f);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(css|tsx?|jsx?)$/.test(name)) acc.push(full);
  }
  return acc;
}

const files = walk(CLIENT_SRC);
const cssFiles = files.filter((f) => f.endsWith('.css'));
const codeFiles = files.filter((f) => /\.(tsx?|jsx?)$/.test(f));

const fails = [];
const notes = [];

/* ---- 1. 尺寸判定必须单一来源：CSS 不得再用 @media (pointer: coarse) ---- */
for (const f of cssFiles) {
  const code = stripComments(readFileSync(f, 'utf8'));
  if (/pointer\s*:\s*coarse/.test(code)) {
    fails.push(
      `${relative(ROOT, f)} 仍在使用 @media (pointer: coarse)。` +
        `尺寸判定必须只读 html[data-input]（由 client/src/index.tsx 写入），` +
        `CSS 再判断一次就会出现两个判定者。`,
    );
  }
}

/* ---- 2. 根字号写入点必须集中：只允许 tailwind-theme.css ---- */
const FONT_SIZE_ALLOWED = new Set(['tailwind-theme.css']);
// 只认「选择器本身就是 html / html[attr] / :root / body」的写入；
// html[data-input="coarse"] input { font-size: 16px } 是控件字号，不算根字号。
const IS_ROOT_SELECTOR = /^(?:html|:root|body)(?:\[[^\]]*\])?$/;
for (const f of cssFiles) {
  const code = stripComments(readFileSync(f, 'utf8'));
  const writers = [...code.matchAll(/(?:^|\})\s*([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /(?:^|[;\s])font-size\s*:/.test(m[2]))
    .map((m) => m[1].trim().replace(/\s+/g, ' '))
    .filter((sel) => sel.split(',').some((s) => IS_ROOT_SELECTOR.test(s.trim())));
  if (writers.length > 0 && !FONT_SIZE_ALLOWED.has(f.split(/[\\/]/).pop())) {
    fails.push(
      `${relative(ROOT, f)} 在写根字号（${writers.join(' / ')}）。` +
        `全局基准只允许在 tailwind-theme.css 定义，否则"改了一处不生效"。`,
    );
  }
}

/* ---- 3. 表格单元格内边距不得写死（否则 token 改不动密度） ---- */
for (const f of codeFiles) {
  if (isPrintDoc(f)) continue;
  const code = stripComments(readFileSync(f, 'utf8'));
  if (/padding\s*:\s*\d+px[^;`]*!important/.test(code)) {
    fails.push(
      `${relative(ROOT, f)} 用 !important 写死了 padding。` +
        `表格密度必须由 app.tsx 的 Table token（cellPaddingBlock / cellPaddingInline）控制。`,
    );
  }
}

/* ---- 4. 组件内不得注入全局样式块（除白名单） ---- */
const STYLE_TAG_ALLOWED = new Set(['resizable-table.tsx']);
for (const f of codeFiles) {
  const code = readFileSync(f, 'utf8');
  if (/<style>\s*\{/.test(code) && !STYLE_TAG_ALLOWED.has(f.split(/[\\/]/).pop())) {
    notes.push(`${relative(ROOT, f)} 内联注入 <style>（不在白名单，请确认是否必要）`);
  }
}

/* ---- 5. 统计量（只报告，不判定） ---- */
const stat = (label, re, scope) => {
  let n = 0;
  for (const f of scope) n += (stripComments(readFileSync(f, 'utf8')).match(re) || []).length;
  notes.push(`${label}: ${n}`);
};

stat('CSS 中 !important 总数', /!important/g, cssFiles);
stat('CSS 中 font-size 声明数', /font-size\s*:/g, cssFiles);

console.log('=== UI 护栏检查 ===');
for (const n of notes) console.log('  ·', n);

if (fails.length === 0) {
  console.log('\n✓ 全部通过');
  process.exit(0);
}

console.error('\n✗ 发现 %d 处退化：', fails.length);
for (const f of fails) console.error('  -', f);
process.exit(1);
