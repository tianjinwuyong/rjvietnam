#!/usr/bin/env node
/**
 * WMS 升级补丁包生成器
 * ------------------------------------------------------------------
 * 用法：
 *   node scripts/gen-upgrade-patch.cjs <补丁目录>
 * 例：
 *   node scripts/gen-upgrade-patch.cjs "F:/WMS升级补丁_20261015"
 *
 * 前置：补丁目录里必须已经放好 dist\（用 bash 的 cp -r 复制，见下方「注意」）
 *
 * 本脚本做三件事：
 *   1. 把 scripts/patch-src/ 下的文本源转码写进补丁目录
 *        - 一键升级.bat   → GBK / CRLF / 无 BOM（配合 chcp 936）
 *        - 升级说明.txt   → UTF-8 BOM / CRLF（记事本友好）
 *   2. 采集 dist 关键文件 SHA-256，生成 校验清单.txt
 *   3. 自检（编码 + .bat 结构），任一不通过则退出码非 0
 *
 * 注意（工程踩过的坑，见 MEMORY.md 环境陷阱）：
 *   - 目录复制一律用 bash `cp -r`；Node 的 fs.cpSync 在非 ASCII 路径下
 *     会把内容写进乱码目录并在正确路径留空目录，且 existsSync 返回 false。
 *   - .bat 的括号块内绝不能出现半角括号（含引号内与 echo 文案）。
 *
 * 说明：校验清单.txt 内嵌生成时间，因此每次生成 md5/sha 都不同属正常现象。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let iconv;
try {
  iconv = require('iconv-lite');
} catch (e) {
  console.error('缺少 iconv-lite，请先在本工程 node_modules 下确认该依赖存在。');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(__dirname, 'patch-src');
const PATCH = process.argv[2];

if (!PATCH) {
  console.error('用法：node scripts/gen-upgrade-patch.cjs <补丁目录>');
  process.exit(2);
}
if (!fs.existsSync(PATCH)) {
  console.error('补丁目录不存在：' + PATCH);
  process.exit(2);
}
if (!fs.existsSync(path.join(PATCH, 'dist'))) {
  console.error('补丁目录下没有 dist\\ —— 请先用 bash cp -r 复制构建产物。');
  process.exit(2);
}

const toCRLF = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const readUtf8 = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const countByte = (buf, b) => { let n = 0; for (const x of buf) if (x === b) n++; return n; };

let fail = 0;
const ok = (s) => console.log('  OK   ' + s);
const bad = (s) => { fail++; console.log('  FAIL ' + s); };

// ---------------- 读取文本源，解析补丁元信息 ----------------
const txtRaw = readUtf8(path.join(SRC_DIR, '升级说明.txt'));
const grab = (label) => {
  const m = txtRaw.match(new RegExp('^' + label + '：(.*)$', 'm'));
  return m ? m[1].trim() : '';
};
const patchNo = grab('补丁编号') || 'WMS-PATCH-UNKNOWN';
const patchDate = grab('补丁日期') || '';

// ---------------- 1) 一键升级.bat ----------------
const batText = toCRLF(readUtf8(path.join(SRC_DIR, '一键升级.bat')));
const batBuf = iconv.encode(batText, 'gbk');
fs.writeFileSync(path.join(PATCH, '一键升级.bat'), batBuf);
console.log('写入 一键升级.bat   ' + batBuf.length + ' 字节');

// ---------------- 2) 升级说明.txt ----------------
const txtText = toCRLF(txtRaw);
const txtBuf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(txtText, 'utf8')]);
fs.writeFileSync(path.join(PATCH, '升级说明.txt'), txtBuf);
console.log('写入 升级说明.txt   ' + txtBuf.length + ' 字节');

// ---------------- 3) 采集 dist 指纹 → 校验清单.txt ----------------
const distDir = path.join(PATCH, 'dist');
const assetsDir = path.join(distDir, 'client/assets');
const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).sort() : [];
const jsEntry = assets.find((f) => /^index-.*\.js$/.test(f));
const cssEntry = assets.find((f) => /^index-.*\.css$/.test(f));
const countFiles = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
};
const distFileCount = countFiles(distDir);

const targets = [
  ['dist\\main.js', path.join(distDir, 'main.js')],
  ['dist\\client\\index.html', path.join(distDir, 'client/index.html')],
  ['dist\\client\\assets\\' + (jsEntry || '(缺失)'), jsEntry ? path.join(assetsDir, jsEntry) : null],
  ['dist\\client\\assets\\' + (cssEntry || '(缺失)'), cssEntry ? path.join(assetsDir, cssEntry) : null],
  ['dist\\modules\\system\\system.controller.js', path.join(distDir, 'modules/system/system.controller.js')],
  ['dist\\common\\interceptors\\operation-log.interceptor.js', path.join(distDir, 'common/interceptors/operation-log.interceptor.js')],
  ['dist\\common\\interceptors\\operation-log.rules.js', path.join(distDir, 'common/interceptors/operation-log.rules.js')],
  ['一键升级.bat', path.join(PATCH, '一键升级.bat')],
  ['升级说明.txt', path.join(PATCH, '升级说明.txt')],
];
const missing = targets.filter(([, p]) => !p || !fs.existsSync(p)).map(([n]) => n);
if (missing.length) {
  console.error('关键文件缺失，中止：' + missing.join(' / '));
  process.exit(3);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
  ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

const L = [];
const P = (s) => L.push(s);
P('========================================================================');
P('  WMS 仓库管理系统 · 版本升级补丁 · 校验清单');
P('========================================================================');
P('补丁编号：' + patchNo);
P('补丁日期：' + patchDate);
P('生成时间：' + stamp);
P('生成环境：Windows · Node.js');
P('算法：SHA-256');
P('');
P('------------------------------------------------------------------------');
P('一、关键文件指纹');
P('------------------------------------------------------------------------');
for (const [name, p] of targets) P(sha256(p) + '  ' + name);
P('');
P('------------------------------------------------------------------------');
P('二、构建标识');
P('------------------------------------------------------------------------');
P('后端主文件：dist\\main.js');
P('前端入口 JS：' + (jsEntry || '(缺失)'));
P('前端入口 CSS：' + (cssEntry || '(缺失)'));
P('构建产物文件总数：' + distFileCount);
P('前端资源目录文件：' + assets.join(' , '));
P('');
P('------------------------------------------------------------------------');
P('三、怎么用');
P('------------------------------------------------------------------------');
P('在服务器上替换完 dist 之后，可对 dist\\main.js 计算 SHA-256，');
P('与上面第一节里的值比对。一致说明文件复制完整、未被损坏。');
P('');
P('  命令行（在 WMS 安装目录下执行）：');
P('      certutil -hashfile dist\\main.js SHA256');
P('');
P('  也可以直接与上面「前端入口 JS」核对：');
P('  打开浏览器控制台，看加载的 assets 文件名是否与上面一致。');
P('');
P('========================================================================');
const manifest = '\uFEFF' + toCRLF(L.join('\n') + '\n');
fs.writeFileSync(path.join(PATCH, '校验清单.txt'), manifest, 'utf8');
console.log('写入 校验清单.txt   ' + Buffer.byteLength(manifest, 'utf8') + ' 字节');
console.log('');

// ---------------- 4) 自检 ----------------
console.log('=== 自检：编码 ===');
for (const name of ['一键升级.bat', '升级说明.txt', '校验清单.txt']) {
  const p = path.join(PATCH, name);
  const buf = fs.readFileSync(p);
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const cr = countByte(buf, 0x0d);
  const lf = countByte(buf, 0x0a);
  if (cr !== lf) bad(name + ' 换行不统一 CR=' + cr + ' LF=' + lf);
  else ok(name + ' 全 CRLF (' + cr + ' 行)');
  if (name.endsWith('.bat')) {
    if (hasBom) bad('.bat 不应带 UTF-8 BOM'); else ok('.bat 无 BOM');
    const dec = iconv.decode(buf, 'gbk');
    if (dec.includes('\uFFFD')) bad('.bat GBK 解码异常'); else ok('.bat GBK 解码正常');
    if (!/chcp 936/i.test(dec)) bad('.bat 缺少 chcp 936'); else ok('.bat 含 chcp 936');
  } else {
    if (!hasBom) bad(name + ' 缺少 UTF-8 BOM'); else ok(name + ' 含 UTF-8 BOM');
    if (buf.subarray(3).toString('utf8').includes('\uFFFD')) bad(name + ' UTF-8 解码异常');
    else ok(name + ' UTF-8 解码正常');
  }
}

console.log('');
console.log('=== 自检：.bat 结构 ===');
{
  const dec = iconv.decode(fs.readFileSync(path.join(PATCH, '一键升级.bat')), 'gbk');
  const lines = dec.replace(/\r\n/g, '\n').split('\n');
  let depth = 0, maxDepth = 0;
  const problems = [];
  lines.forEach((raw, i) => {
    const no = i + 1;
    const line = raw.trim();
    if (!line) return;
    if (/^(::|rem |REM )/.test(line)) return;
    if (depth > 0 && line === ')') { depth--; return; }
    if (depth > 0) {
      let scan = line;
      if (/\(\s*$/.test(scan)) scan = scan.replace(/\(\s*$/, '');
      const hits = [scan.includes('(') ? '(' : '', scan.includes(')') ? ')' : ''].filter(Boolean);
      if (hits.length) problems.push('L' + no + ' 块内半角括号[' + hits.join('') + ']: ' + line.slice(0, 60));
    }
    if (/\(\s*$/.test(line)) { depth++; maxDepth = Math.max(maxDepth, depth); }
  });
  if (depth !== 0) bad('.bat 括号块未配平，最终 depth=' + depth); else ok('.bat 括号块配平');
  console.log('       最大嵌套深度 ' + maxDepth);
  if (problems.length) problems.forEach(bad); else ok('.bat 块内无半角括号');
  const need = [
    ['备份（move）', /move "!WMSDIR!\\dist"/],
    ['复制（xcopy）', /xcopy "%~dp0dist"/],
    ['校验 main.js', /dist\\main\.js/],
    ['校验 client\\index.html', /dist\\client\\index\.html/],
    ['校验 system.controller.js', /dist\\modules\\system\\system\.controller\.js/],
    ['回滚', /move "!BAK!" "!WMSDIR!\\dist"/],
    ['setlocal enabledelayedexpansion', /setlocal enabledelayedexpansion/],
  ];
  for (const [label, re] of need) {
    if (re.test(dec)) ok('含 ' + label); else bad('缺少 ' + label);
  }
}

console.log('');
console.log('=== 结果 ===');
console.log('  dist 文件总数：' + distFileCount);
console.log('  前端入口：' + jsEntry + ' / ' + cssEntry);
console.log('  main.js SHA-256：' + sha256(path.join(distDir, 'main.js')));
console.log(fail === 0 ? '  自检全部通过' : ('  自检不通过项：' + fail));
process.exit(fail === 0 ? 0 : 1);
