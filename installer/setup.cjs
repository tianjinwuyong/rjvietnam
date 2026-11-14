#!/usr/bin/env node
/**
 * WMS 一键部署引导（免安装包专用）
 * ------------------------------------------------------------------
 * 由安装程序在文件复制完成后以管理员身份执行，完成全部环境自举：
 *   1. 检查管理员权限 / 端口占用
 *   2. 生成 .env（随机数据库口令 + 随机 JWT 密钥），已存在则保留不动
 *   3. 便携版 PostgreSQL：initdb 建实例（如未建）
 *   4. 注册 PostgreSQL 服务（nssm，NetworkService 账户）并启动
 *   5. 建空库 wms
 *   6. 用结构基线建表 + 初始化角色/管理员/系统参数（不含任何物料业务数据）
 *   7. 注册应用服务（nssm）并启动
 *   8. 放行防火墙端口
 *
 * 幂等：重复执行只会补缺，不会重建数据、不会覆盖 .env。
 * 只做"空库初始化"，绝不导入任何业务数据。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const P = (...s) => path.join(ROOT, ...s);

const PG_PORT = 5433;
const HTTP_PORT = 3000;
const HTTPS_PORT = 3443;
const DB_NAME = 'wms';
const DB_USER = 'postgres';
const PG_SERVICE = 'WMS-PostgreSQL';
const APP_SERVICE = 'WMS-App';

const PGBIN = P('pgsql', 'bin');
const PGDATA = P('pgdata');
const NODE_EXE = P('node', 'node.exe');
const NSSM = P('scripts', 'nssm.exe');
const ENV_FILE = P('.env');

const log = (msg) => console.log(msg);
const step = (n, total, msg) => console.log(`\n[${n}/${total}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 便携模式：不注册 Windows 服务，用 pg_ctl + 直接起 node（无需管理员） */
const MANUAL = process.argv.includes('--manual');

function fail(msg) {
  console.error(`\n[失败] ${msg}`);
  process.exit(1);
}

function run(exe, args, opts = {}) {
  const r = spawnSync(exe, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 300_000,
    env: { ...process.env, ...(opts.env || {}) },
    windowsHide: true,
  });
  if (r.error) throw new Error(`${path.basename(exe)} 执行失败：${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    const detail = (r.stderr || r.stdout || '').trim().split('\n').slice(-6).join('\n');
    throw new Error(`${path.basename(exe)} 退出码 ${r.status}\n${detail}`);
  }
  return r;
}

function isAdmin() {
  const r = spawnSync('net', ['session'], { windowsHide: true });
  return r.status === 0;
}

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 1200 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}

async function waitPort(port, seconds, label) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await portBusy(port)) return true;
    await sleep(1500);
  }
  return false;
}

function readEnvValue(key) {
  if (!fs.existsSync(ENV_FILE)) return '';
  const line = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}

/** 生成 .env（已存在则复用其中的口令/密钥，避免升级后连不上老库） */
function ensureEnv() {
  const existingDbPass = readEnvValue('DB_PASSWORD');
  const existingJwt = readEnvValue('JWT_SECRET');
  if (fs.existsSync(ENV_FILE) && existingDbPass && existingJwt) {
    log('  - 已存在 .env，保留原有数据库口令与 JWT 密钥');
    return { dbPassword: existingDbPass, jwt: existingJwt, reused: true };
  }

  const dbPassword = crypto.randomBytes(24).toString('hex');
  const jwt = crypto.randomBytes(32).toString('hex');
  const content = [
    'NODE_ENV=production',
    'SERVER_HOST=0.0.0.0',
    `SERVER_PORT=${HTTP_PORT}`,
    `HTTPS_PORT=${HTTPS_PORT}`,
    '# 数据库（本机便携版实例，仅回环监听）',
    'DB_HOST=127.0.0.1',
    `DB_PORT=${PG_PORT}`,
    `DB_USER=${DB_USER}`,
    `DB_PASSWORD=${dbPassword}`,
    `DB_NAME=${DB_NAME}`,
    `JWT_SECRET=${jwt}`,
    'LOG_DIR=logs',
    '',
  ].join('\r\n');
  fs.writeFileSync(ENV_FILE, content, 'utf8');
  log('  - 已生成 .env（随机数据库口令 + 随机 JWT 密钥）');
  return { dbPassword, jwt, reused: false };
}

function initInstance(dbPassword) {
  if (fs.existsSync(path.join(PGDATA, 'PG_VERSION'))) {
    log('  - 数据目录已存在，跳过初始化');
    return false;
  }
  const pwFile = path.join(os.tmpdir(), `wms-pw-${Date.now()}.txt`);
  fs.writeFileSync(pwFile, dbPassword, 'utf8');
  try {
    run(path.join(PGBIN, 'initdb.exe'), [
      '-D', PGDATA,
      '-U', DB_USER,
      '-A', 'scram-sha-256',
      `--pwfile=${pwFile}`,
      '-E', 'UTF8',
      '--locale=C',
    ]);
  } finally {
    try { fs.unlinkSync(pwFile); } catch { /* ignore */ }
  }
  const conf = path.join(PGDATA, 'postgresql.conf');
  fs.appendFileSync(conf, [
    '',
    '# ===== WMS 部署配置（安装程序写入）=====',
    `port = ${PG_PORT}`,
    "listen_addresses = '127.0.0.1'",
    'max_connections = 200',
    'shared_buffers = 256MB',
    'log_min_messages = warning',
    '',
  ].join('\n'), 'utf8');
  log('  ✓ 已初始化 PostgreSQL 数据目录');
  return true;
}

function serviceExists(name) {
  const r = run('sc', ['query', name], { allowFail: true });
  return r.status === 0;
}

function installPgService() {
  // Service 以 NetworkService 运行：PostgreSQL 拒绝以管理员身份直接运行
  run('icacls', [PGDATA, '/grant', '*S-1-5-20:(OI)(CI)F', '/T', '/Q'], { allowFail: true });
  if (serviceExists(PG_SERVICE)) {
    log('  - PostgreSQL 服务已存在');
  } else {
    run(NSSM, ['install', PG_SERVICE, path.join(PGBIN, 'pg_ctl.exe'), 'runservice', '-N', PG_SERVICE, '-D', PGDATA]);
    run(NSSM, ['set', PG_SERVICE, 'ObjectName', 'NT AUTHORITY\\NetworkService']);
  }
  run(NSSM, ['set', PG_SERVICE, 'DisplayName', 'WMS PostgreSQL 18']);
  run(NSSM, ['set', PG_SERVICE, 'Description', 'WMS 专用 PostgreSQL 实例（端口 ' + PG_PORT + '，仅本机访问）']);
  run(NSSM, ['set', PG_SERVICE, 'Start', 'SERVICE_AUTO_START']);
  run(NSSM, ['set', PG_SERVICE, 'AppDirectory', ROOT]);
  run(NSSM, ['set', PG_SERVICE, 'AppStdout', P('logs', 'postgres-out.log')]);
  run(NSSM, ['set', PG_SERVICE, 'AppStderr', P('logs', 'postgres-err.log')]);
  run(NSSM, ['set', PG_SERVICE, 'AppRotateFiles', '1']);
  run(NSSM, ['set', PG_SERVICE, 'AppRotateBytes', '10485760']);
  run(NSSM, ['set', PG_SERVICE, 'AppExit', 'Default', 'Restart']);
  run(NSSM, ['start', PG_SERVICE], { allowFail: true });
}

/** 便携模式：直接拉起 postgres.exe（不注册服务、不经过 pg_ctl） */
async function startPgManual() {
  if (await portBusy(PG_PORT)) {
    log('  - PostgreSQL 已在运行');
    return;
  }
  const logFile = P('logs', 'postgres.log');
  const out = fs.openSync(logFile, 'a');
  const child = spawn(path.join(PGBIN, 'postgres.exe'), ['-D', PGDATA], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  if (!(await waitPort(PG_PORT, 120))) {
    const detail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').slice(-15).join('\n') : '';
    throw new Error(`PostgreSQL 启动失败\n${detail}`);
  }
  log('  ✓ PostgreSQL 已启动（便携模式，进程号 ' + child.pid + '）');
}

/** 等数据库真正可接受连接（端口通了不代表实例就绪，冷启动会有 starting up 阶段） */
async function waitPgReady(dbPassword, seconds) {
  const psql = path.join(PGBIN, 'psql.exe');
  const deadline = Date.now() + seconds * 1000;
  let last = '';
  while (Date.now() < deadline) {
    const r = run(psql, [
      '-h', '127.0.0.1', '-p', String(PG_PORT), '-U', DB_USER, '-d', 'postgres',
      '-t', '-A', '-c', 'select 1',
    ], { env: { PGPASSWORD: dbPassword }, allowFail: true });
    if (r.status === 0 && String(r.stdout).trim() === '1') return true;
    last = String(r.stderr || '').trim();
    await sleep(1500);
  }
  throw new Error(`数据库在 ${seconds} 秒内未就绪：${last}`);
}

function createDatabase(dbPassword) {
  const env = { PGPASSWORD: dbPassword };
  const psql = path.join(PGBIN, 'psql.exe');
  const has = run(psql, [
    '-h', '127.0.0.1', '-p', String(PG_PORT), '-U', DB_USER, '-d', 'postgres',
    '-t', '-A', '-c', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`,
  ], { env });
  if (String(has.stdout).trim() === '1') {
    log(`  - 数据库 ${DB_NAME} 已存在`);
    return;
  }
  run(psql, [
    '-h', '127.0.0.1', '-p', String(PG_PORT), '-U', DB_USER, '-d', 'postgres',
    '-c', `CREATE DATABASE ${DB_NAME} ENCODING 'UTF8'`,
  ], { env });
  log(`  ✓ 已创建数据库 ${DB_NAME}`);
}

function initSchema(dbPassword) {
  const r = run(NODE_EXE, [P('dist', 'scripts', 'init-db.js')], {
    env: {
      DB_HOST: '127.0.0.1',
      DB_PORT: String(PG_PORT),
      DB_USER,
      DB_PASSWORD: dbPassword,
      DB_NAME,
    },
    timeout: 600_000,
  });
  const tail = (r.stdout || '').trim().split('\n');
  log(tail.slice(-6).map((l) => '  ' + l).join('\n'));

  loadSeedData(dbPassword);
}

/**
 * 导入预置数据（IQC 检验模板 + 系统用户 / 角色 / 系统参数）
 *
 * 为什么要先清空再导入：
 *   init-db 第 4/5 步会建默认 `admin` 账号、`admin` 角色与一套系统参数，
 *   而预置数据里同样含 `admin`（原系统管理员），account / role_code /
 *   param_key 上的唯一键会冲突导致 pg_restore 中断。先清空这几张表，
 *   让预置数据完整替换默认初始化结果，管理员密码也沿用原系统的。
 *
 * 为什么用自定义格式 dump：
 *   PG18 的纯文本 dump 头部带 \restrict / \unrestrict 元命令，psql 恢复会
 *   报 42601；-Fc 自定义格式由 pg_restore 直接读取，完全绕开该问题。
 */
function loadSeedData(dbPassword) {
  const seed = P('scripts', 'seed-data.dump');
  if (!fs.existsSync(seed)) {
    log('  - 未提供预置数据（seed-data.dump 不存在），按空库部署');
    return;
  }

  const env = { PGPASSWORD: dbPassword };
  const conn = ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', DB_USER, '-d', DB_NAME];
  const psql = path.join(PGBIN, 'psql.exe');
  const pgRestore = path.join(PGBIN, 'pg_restore.exe');

  log('  - 清除默认初始化数据，准备写入预置账号与 IQC 模板...');
  run(psql, [...conn, '-v', 'ON_ERROR_STOP=1', '-c',
    'DELETE FROM role_user; ' +
    'DELETE FROM iqc_template; ' +
    'DELETE FROM iqc_standard_item; ' +
    'DELETE FROM sys_account; ' +
    'DELETE FROM sys_role; ' +
    'DELETE FROM sys_param;',
  ], { env });

  log('  - 导入预置数据（系统用户 / 角色 / 参数 / IQC 检验模板）...');
  const r = run(pgRestore, [...conn, '--no-owner', '--no-privileges', '--data-only', seed], {
    env,
    allowFail: true,
  });
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').trim().split('\n').slice(-6).join('\n');
    throw new Error(`预置数据导入失败（退出码 ${r.status}）\n${detail}`);
  }

  const count = (table) => {
    const q = run(psql, [...conn, '-t', '-A', '-c', `SELECT count(*) FROM ${table}`], {
      env,
      allowFail: true,
    });
    return String(q.stdout || '').trim();
  };
  log(
    `  ✓ 预置数据就绪：账号 ${count('sys_account')} 个 / 角色 ${count('sys_role')} 个 / ` +
    `系统参数 ${count('sys_param')} 项 / IQC 模板 ${count('iqc_template')} 个（检验项目 ${count('iqc_template_item')} 项）`,
  );
}

function installAppService() {
  if (serviceExists(APP_SERVICE)) {
    log('  - 应用服务已存在');
  } else {
    run(NSSM, ['install', APP_SERVICE, NODE_EXE, 'dist\\main.js']);
  }
  run(NSSM, ['set', APP_SERVICE, 'DisplayName', 'WMS 仓库管理系统']);
  run(NSSM, ['set', APP_SERVICE, 'Description', 'WMS 主服务（HTTP ' + HTTP_PORT + ' / HTTPS ' + HTTPS_PORT + '）']);
  run(NSSM, ['set', APP_SERVICE, 'Start', 'SERVICE_AUTO_START']);
  run(NSSM, ['set', APP_SERVICE, 'AppDirectory', ROOT]);
  run(NSSM, ['set', APP_SERVICE, 'AppStdout', P('logs', 'app-out.log')]);
  run(NSSM, ['set', APP_SERVICE, 'AppStderr', P('logs', 'app-err.log')]);
  run(NSSM, ['set', APP_SERVICE, 'AppRotateFiles', '1']);
  run(NSSM, ['set', APP_SERVICE, 'AppRotateBytes', '10485760']);
  run(NSSM, ['set', APP_SERVICE, 'AppExit', 'Default', 'Restart']);
  run(NSSM, ['set', APP_SERVICE, 'AppRestartDelay', '5000']);
  run(NSSM, ['start', APP_SERVICE], { allowFail: true });
}

/** 便携模式：直接以子进程方式起 node（不注册服务） */
function startAppManual() {
  const out = fs.openSync(P('logs', 'app-out.log'), 'a');
  const child = spawn(NODE_EXE, [path.join('dist', 'main.js')], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  log('  ✓ WMS 已启动（便携模式，进程号 ' + child.pid + '）');
}

function openFirewall() {
  for (const [name, port] of [['WMS HTTP 3000', HTTP_PORT], ['WMS HTTPS 3443', HTTPS_PORT]]) {
    const q = run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], { allowFail: true });
    if (q.status === 0) continue;
    run('netsh', [
      'advfirewall', 'firewall', 'add', 'rule', `name=${name}`,
      'dir=in', 'action=allow', 'protocol=TCP', `localport=${port}`,
    ], { allowFail: true });
  }
  log('  ✓ 防火墙已放行 ' + HTTP_PORT + ' / ' + HTTPS_PORT);
}

function writeInstallInfo() {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  const lines = [
    'WMS 仓库管理系统 1.0 —— 部署信息',
    '='.repeat(46),
    `安装目录：${ROOT}`,
    `数据目录：${PGDATA}（数据库文件，请纳入备份）`,
    '',
    '访问地址：',
    ...lan.map((ip) => `  http://${ip}:${HTTP_PORT}`),
    ...lan.map((ip) => `  https://${ip}:${HTTPS_PORT}   （手机/PDA 扫码需走 HTTPS）`),
    `  本机：http://127.0.0.1:${HTTP_PORT}`,
    '',
    '初始账号：admin / admin（首次登录后请立即改密）',
    '数据库：由本机便携实例提供，仅监听 127.0.0.1，不对局域网开放',
    '',
    '服务（Windows 服务，开机自启）：',
    `  ${PG_SERVICE}   PostgreSQL 18`,
    `  ${APP_SERVICE}   WMS 应用`,
    '',
    '常用操作：',
    '  停止：scripts\\stop-wms.cmd',
    '  启动：scripts\\start-wms.cmd',
    '  查看状态：scripts\\status-wms.cmd',
    '',
    '本安装包不包含任何物料/库存业务数据，数据库为空库结构 + 基础配置。',
    '',
  ].join('\r\n');
  fs.writeFileSync(P('install-info.txt'), lines, 'utf8');
}

(async function main() {
  log('==============================================');
  log('  WMS 仓库管理系统 1.0 —— 一键部署');
  log('==============================================');

  if (process.platform !== 'win32') fail('本安装程序仅支持 Windows');
  if (!MANUAL && !isAdmin()) fail('请以管理员身份运行安装程序（右键 → 以管理员身份运行）');
  if (MANUAL) log('  · 便携模式：不注册 Windows 服务，当前用户直接运行');
  if (!fs.existsSync(NODE_EXE)) fail(`缺少运行环境：${NODE_EXE}`);
  if (!fs.existsSync(path.join(PGBIN, 'initdb.exe'))) fail(`缺少 PostgreSQL：${PGBIN}`);

  const isFresh = !fs.existsSync(path.join(PGDATA, 'PG_VERSION'));
  if (isFresh) {
    for (const port of [PG_PORT, HTTP_PORT, HTTPS_PORT]) {
      if (await portBusy(port)) {
        fail(`端口 ${port} 已被占用。请先关闭占用该端口的程序，或修改安装参数后重试。`);
      }
    }
  }

  step(1, 8, '生成运行配置');
  // 安装器会建这两个目录；便携模式/手动复制场景下补齐，缺目录会导致 PG 日志写不进去
  for (const d of ['logs', 'ssl']) fs.mkdirSync(P(d), { recursive: true });
  const { dbPassword } = ensureEnv();

  step(2, 8, '初始化数据库实例');
  initInstance(dbPassword);

  step(3, 8, '启动 PostgreSQL');
  if (MANUAL) {
    await startPgManual();
  } else {
    installPgService();
    if (!(await waitPort(PG_PORT, 120))) {
      // 服务起不来（常见于受限网络/策略环境）就退回便携方式，不让安装整体失败
      const errLog = P('logs', 'postgres-err.log');
      const detail = fs.existsSync(errLog) ? fs.readFileSync(errLog, 'utf8').split('\n').slice(-10).join('\n') : '';
      log('  ! 服务方式未能启动，回退为便携方式');
      if (detail) log('    服务日志：' + detail.replace(/\n/g, ' '));
      await startPgManual();
    }
  }
  log('  ✓ PostgreSQL 已就绪（127.0.0.1:' + PG_PORT + '）');

  step(4, 8, '创建数据库');
  await waitPgReady(dbPassword, 180);
  createDatabase(dbPassword);

  step(5, 8, '初始化表结构与基础数据');
  initSchema(dbPassword);

  step(6, 8, MANUAL ? '启动应用' : '注册并启动应用服务');
  if (MANUAL) {
    startAppManual();
  } else {
    installAppService();
    if (!(await waitPort(HTTP_PORT, 90))) {
      log('  ! 服务方式未能启动应用，回退为便携方式');
      startAppManual();
    }
  }
  if (!(await waitPort(HTTP_PORT, 180))) {
    const errLog = P('logs', 'app-err.log');
    const detail = fs.existsSync(errLog) ? fs.readFileSync(errLog, 'utf8').split('\n').slice(-20).join('\n') : '';
    fail(`WMS 应用未能在 180 秒内启动。\n${detail}`);
  }
  log('  ✓ WMS 已就绪（http://127.0.0.1:' + HTTP_PORT + '）');

  step(7, 8, '配置 Windows 防火墙');
  if (MANUAL) {
    log('  - 便携模式跳过（如需局域网访问，请手动放行 ' + HTTP_PORT + ' / ' + HTTPS_PORT + '）');
  } else {
    openFirewall();
  }

  step(8, 8, '生成部署信息');
  writeInstallInfo();
  log('  ✓ 已生成 install-info.txt');

  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  log('\n==============================================');
  log('  部署完成');
  log('----------------------------------------------');
  lan.forEach((ip) => log(`  访问：http://${ip}:${HTTP_PORT}`));
  lan.forEach((ip) => log(`  安全：https://${ip}:${HTTPS_PORT}`));
  log('  账号：admin / admin（首次登录后请修改）');
  log('  数据：空库结构 + 基础配置，未包含任何业务数据');
  log('==============================================\n');
})().catch((e) => fail(e && e.message ? e.message : String(e)));
