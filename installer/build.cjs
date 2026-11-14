#!/usr/bin/env node
/**
 * 组装安装包载荷（build/payload）并调用 ISCC 编译安装程序。
 *
 * 用法：
 *   node installer/build.cjs            # 只组装载荷
 *   node installer/build.cjs --compile  # 组装后直接编译 exe
 *
 * 载荷内容：
 *   dist/           前后端构建产物（构建产物里已含 server/database 的 SQL）
 *   node/node.exe   Node 运行时
 *   node_modules/   生产依赖（npm ls --omit=dev 的实际路径，去掉前端构建期依赖）
 *   pgsql/          便携版 PostgreSQL（bin/lib/share）
 *   scripts/        部署脚本（setup/uninstall/启停/证书生成/nssm）
 *   package.json / README-DEPLOY.txt
 *
 * 不含：pgdata、.env、ssl、logs —— 这些由安装时生成。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const BUILD = path.join(REPO, 'build');
const PAYLOAD = path.join(BUILD, 'payload');
const INSTALLER = __dirname;

const NODE_EXE_CANDIDATES = [
  process.env.WMS_NODE_EXE,
  path.join(path.dirname(process.execPath), 'node.exe'),
  'C:\\Program Files\\nodejs\\node.exe',
].filter(Boolean);

const PG_SRC_CANDIDATES = [
  process.env.WMS_PG_DIR,
  'C:\\Program Files\\PostgreSQL\\18',
  'C:\\Program Files\\PostgreSQL\\17',
  'C:\\Program Files\\PostgreSQL\\16',
].filter(Boolean);

function die(msg) {
  console.error(`[build] ${msg}`);
  process.exit(1);
}

function log(msg) {
  console.log(`[build] ${msg}`);
}

function firstExisting(list, extra) {
  for (const p of list) {
    if (p && fs.existsSync(p)) return p;
  }
  die(`找不到 ${extra}，可用环境变量指定`);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: false });
}

function run(exe, args, opts = {}) {
  const r = spawnSync(exe, args, {
    encoding: 'utf8',
    cwd: opts.cwd || REPO,
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) die(`${path.basename(exe)} 失败：${(r.stderr || r.stdout || '').slice(0, 800)}`);
  return r.stdout || '';
}

// ---------------------------------------------------------------- 0. 前置检查
if (!fs.existsSync(path.join(REPO, 'dist', 'main.js'))) {
  die('缺少 dist/main.js，请先执行 npm run build');
}
if (!fs.existsSync(path.join(REPO, 'dist', 'client', 'index.html'))) {
  die('缺少 dist/client/index.html，请先执行 npm run build:client');
}
if (!fs.existsSync(path.join(REPO, 'dist', 'scripts', 'init-db.js'))) {
  die('缺少 dist/scripts/init-db.js，请先执行 npm run build:server');
}
if (!fs.existsSync(path.join(REPO, 'dist', 'database', 'baseline-schema.sql'))) {
  die('缺少 dist/database/baseline-schema.sql（空库建表基线），请重新 build:server');
}

// ---------------------------------------------------------------- 1. 清空载荷目录
log('清理 build/payload ...');
rmrf(PAYLOAD);
fs.mkdirSync(PAYLOAD, { recursive: true });

// ---------------------------------------------------------------- 2. dist / 文档
log('复制 dist ...');
copyDir(path.join(REPO, 'dist'), path.join(PAYLOAD, 'dist'));
fs.copyFileSync(path.join(REPO, 'package.json'), path.join(PAYLOAD, 'package.json'));
fs.copyFileSync(path.join(INSTALLER, 'README-DEPLOY.txt'), path.join(PAYLOAD, 'README-DEPLOY.txt'));

// ---------------------------------------------------------------- 3. Node 运行时
const nodeSrc = firstExisting(NODE_EXE_CANDIDATES, 'node.exe（设置 WMS_NODE_EXE）');
log(`Node: ${nodeSrc}`);
fs.mkdirSync(path.join(PAYLOAD, 'node'), { recursive: true });
fs.copyFileSync(nodeSrc, path.join(PAYLOAD, 'node', 'node.exe'));

// ---------------------------------------------------------------- 4. 便携 PostgreSQL
const pgSrc = firstExisting(PG_SRC_CANDIDATES, 'PostgreSQL 安装目录（设置 WMS_PG_DIR）');
log(`PostgreSQL: ${pgSrc}`);
fs.mkdirSync(path.join(PAYLOAD, 'pgsql'), { recursive: true });
for (const sub of ['bin', 'lib', 'share']) {
  const from = path.join(pgSrc, sub);
  if (!fs.existsSync(from)) die(`PostgreSQL 缺少 ${sub} 目录：${from}`);
  log(`  复制 pgsql/${sub} ...`);
  copyDir(from, path.join(PAYLOAD, 'pgsql', sub));
}

// ---------------------------------------------------------------- 5. 生产依赖
log('解析生产依赖 ...');
const raw = run('npm', ['ls', '--omit=dev', '--all', '--parseable']);
const nmRoot = path.join(REPO, 'node_modules');
const rels = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((l) => l.startsWith(nmRoot))
  .map((l) => path.relative(nmRoot, l))
  .filter((r) => r && !r.startsWith('..'));
log(`  生产依赖 ${rels.length} 个`);

const destNm = path.join(PAYLOAD, 'node_modules');
for (const rel of rels) {
  const from = path.join(nmRoot, rel);
  const to = path.join(destNm, rel);
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.cpSync(from, to, { recursive: true, dereference: false });
  } catch (e) {
    log(`  ! 跳过 ${rel}: ${e.message}`);
  }
}

// ---------------------------------------------------------------- 6. 脚本
log('复制部署脚本 ...');
const scriptsDest = path.join(PAYLOAD, 'scripts');
fs.mkdirSync(scriptsDest, { recursive: true });
fs.copyFileSync(path.join(REPO, 'scripts', 'gen-ssl-cert.ps1'), path.join(scriptsDest, 'gen-ssl-cert.ps1'));
fs.copyFileSync(path.join(INSTALLER, 'setup.cjs'), path.join(scriptsDest, 'setup.cjs'));
fs.copyFileSync(path.join(INSTALLER, 'uninstall.cjs'), path.join(scriptsDest, 'uninstall.cjs'));
for (const f of ['start-wms.cmd', 'stop-wms.cmd', 'status-wms.cmd']) {
  fs.copyFileSync(path.join(INSTALLER, f), path.join(scriptsDest, f));
}
fs.copyFileSync(path.join(INSTALLER, 'vendor', 'nssm.exe'), path.join(scriptsDest, 'nssm.exe'));

// 预置数据：系统用户 / 角色 / 参数 / IQC 检验模板（pg_dump -Fc 自定义格式）
const seedSrc = path.join(INSTALLER, 'seed-data.dump');
if (fs.existsSync(seedSrc)) {
  fs.copyFileSync(seedSrc, path.join(scriptsDest, 'seed-data.dump'));
  log(`  已包含预置数据 seed-data.dump（${(fs.statSync(seedSrc).size / 1024).toFixed(0)} KB）`);
} else {
  log('  ! 未找到 seed-data.dump，将按空库部署');
}

// ---------------------------------------------------------------- 7. 体积汇总
function dirSize(p) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(p);
  return total;
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
log(`载荷总大小：${mb(dirSize(PAYLOAD))}`);
for (const sub of ['dist', 'node', 'node_modules', 'pgsql', 'scripts']) {
  log(`  ${sub.padEnd(14)} ${mb(dirSize(path.join(PAYLOAD, sub)))}`);
}

// ---------------------------------------------------------------- 8. 编译安装包
if (process.argv.includes('--compile')) {
  const iscc = [
    process.env.WMS_ISCC,
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ].filter(Boolean).find((p) => fs.existsSync(p));
  if (!iscc) die('找不到 ISCC.exe（Inno Setup 6），可设置 WMS_ISCC');
  log(`编译安装包：${iscc}`);
  const r = spawnSync(iscc, [path.join(INSTALLER, 'wms-setup.iss')], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) die('ISCC 编译失败');
  const out = path.join(BUILD, 'out', 'WMS-Setup-1.0.exe');
  if (!fs.existsSync(out)) die('未生成安装包');
  log(`完成：${out}（${mb(fs.statSync(out).size)}）`);
}
