#!/usr/bin/env node
/**
 * WMS 自启动值守 —— 服务安装器
 * ------------------------------------------------------------------
 * 安装三个 Windows 服务，实现「开机自启 + 异常终止自动拉起」：
 *
 *   WMS-PostgreSQL  数据库（pg_ctl register 注册，NetworkService 账户）
 *   WMS-App         应用（NSSM 托管 node dist/main.js，崩溃 5s 后自动重启）
 *   WMS-Health      健康值守（NSSM 托管 wms-health.cjs，处理假死/服务停止）
 *
 * 用法（必须管理员）：
 *   install-autostart.cmd             正常安装
 *   node service-install.cjs --dry-run  只做检查不落盘
 *
 * 设计要点：
 *   - NSSM 放在 C:\ProgramData\WMS\bin（无空格路径），服务 binPath 无需转义；
 *   - PostgreSQL 拒绝以管理员权限运行，故必须用 NetworkService 账户；
 *   - 失败时自动回滚到「手动拉起」方式，避免安装过程中断服务。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const CONFIG_PATH = path.join(HERE, 'service.config.json');
const NSSM_SRC = path.join(HERE, '..', 'vendor', 'nssm.exe');
const NSSM_DIR = 'C:\\ProgramData\\WMS\\bin';
const NSSM = path.join(NSSM_DIR, 'nssm.exe');
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_HEALTH = process.argv.includes('--no-health');

const gbk = new TextDecoder('gbk');

// ---------------------------------------------------------------- 输出
const C = {
  reset: '\x1b[0m', dim: '\x1b[90m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m',
};
let stepNo = 0;

function title(msg) {
  stepNo += 1;
  console.log(`\n${C.cyan}${C.bold}[${stepNo}] ${msg}${C.reset}`);
}
function ok(msg) { console.log(`    ${C.green}✓${C.reset} ${msg}`); }
function info(msg) { console.log(`    ${C.dim}·${C.reset} ${msg}`); }
function warn(msg) { console.log(`    ${C.yellow}!${C.reset} ${msg}`); }
function fail(msg) { console.log(`    ${C.red}✗${C.reset} ${msg}`); }

// ---------------------------------------------------------------- 执行
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    windowsHide: true,
    timeout: opts.timeout || 120000,
    cwd: opts.cwd,
    env: process.env,
    input: opts.input,
  });
  const out = `${r.stdout ? gbk.decode(r.stdout) : ''}${r.stderr ? gbk.decode(r.stderr) : ''}`.trim();
  return { code: r.status === null ? -1 : r.status, out, error: r.error };
}

function sh(cmd, args, opts) {
  if (DRY_RUN && !/^(sc|netstat|tasklist|query)$/i.test(path.basename(cmd, '.exe'))) {
    info(`[dry-run] ${path.basename(cmd)} ${args.join(' ')}`);
    return { code: 0, out: '' };
  }
  const r = run(cmd, args, opts);
  if (r.error) throw new Error(`执行 ${cmd} 失败: ${r.error.message}`);
  return r;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 反复执行直到 fn 返回真值或超时 */
async function waitFor(desc, fn, timeoutMs = 60000, intervalMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return true;
    await sleep(intervalMs);
  }
  warn(`${desc} 等待超时 (${timeoutMs / 1000}s)`);
  return false;
}

// ---------------------------------------------------------------- 探测
function probePort(port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const net = require('net');
    const sock = new net.Socket();
    let done = false;
    const fin = (v) => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => fin(true));
    sock.once('timeout', () => fin(false));
    sock.once('error', () => fin(false));
    try { sock.connect(port, '127.0.0.1'); } catch (_) { fin(false); }
  });
}

function listeningPids(port) {
  const r = run('netstat', ['-ano']);
  const pids = new Set();
  for (const line of r.out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    if (!cols[1] || !cols[1].endsWith(`:${port}`)) continue;
    const pid = Number(cols[cols.length - 1]);
    if (pid > 0) pids.add(pid);
  }
  return [...pids];
}

function serviceState(name) {
  const r = run('sc.exe', ['query', name]);
  if (r.code === 1060 || /1060/.test(r.out)) return 'NOT_INSTALLED';
  const m = /\b(RUNNING|STOPPED|START_PENDING|STOP_PENDING|PAUSED)\b/.exec(r.out);
  if (!m) return r.code === 0 ? 'UNKNOWN' : 'NOT_INSTALLED';
  return m[1];
}

function taskkill(pid) {
  const r = run('taskkill', ['/PID', String(pid), '/T', '/F']);
  return r.code === 0;
}

// ---------------------------------------------------------------- 准备
function assertAdmin() {
  title('检查管理员权限');
  const r = run('net', ['session']);
  if (r.code !== 0) {
    fail('当前不是管理员权限，无法注册 Windows 服务。');
    console.log(`\n${C.yellow}请右键「安装自启动.cmd」选择「以管理员身份运行」，或双击后点「是」。${C.reset}\n`);
    process.exit(3);
  }
  ok('已具备管理员权限');
}

function loadConfig() {
  title('读取并校验配置');
  if (!fs.existsSync(CONFIG_PATH)) {
    fail(`配置文件不存在: ${CONFIG_PATH}`);
    process.exit(4);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  ok(`配置文件: ${CONFIG_PATH}`);

  const checks = [
    ['PostgreSQL 程序目录', path.join(cfg.pg.binDir, 'postgres.exe')],
    ['PostgreSQL 启动工具', path.join(cfg.pg.binDir, 'pg_ctl.exe')],
    ['PostgreSQL 数据目录', path.join(cfg.pg.dataDir, 'PG_VERSION')],
    ['Node 运行时', cfg.app.nodeExe],
    ['应用入口', path.join(cfg.app.workDir, cfg.app.script)],
    ['应用目录', cfg.app.workDir],
  ];
  let bad = 0;
  for (const [label, p] of checks) {
    if (fs.existsSync(p)) {
      info(`${label}: ${p}`);
    } else {
      fail(`${label} 不存在: ${p}`);
      bad += 1;
    }
  }
  if (bad > 0) {
    console.log(`\n${C.red}配置校验失败（${bad} 项）。请修正 service.config.json 后重试。${C.reset}\n`);
    process.exit(5);
  }

  fs.mkdirSync(cfg.logDir, { recursive: true });
  ok(`日志目录: ${cfg.logDir}`);
  return cfg;
}

function stageNssm() {
  title('部署 NSSM 服务封装器');
  if (!fs.existsSync(NSSM_SRC)) {
    fail(`缺少 nssm.exe: ${NSSM_SRC}`);
    process.exit(6);
  }
  if (!DRY_RUN) {
    fs.mkdirSync(NSSM_DIR, { recursive: true });
    fs.copyFileSync(NSSM_SRC, NSSM);
  }
  ok(`${NSSM} （无空格路径，规避服务 binPath 引号问题）`);
  const v = run(NSSM, ['version']);
  if (v.out) info(`nssm 版本: ${v.out.split(/\r?\n/)[0]}`);
}

// ---------------------------------------------------------------- 停旧
async function stopLegacyProcesses(cfg) {
  title('停止当前以进程方式运行的服务');

  const pgPids = listeningPids(cfg.pg.port);
  if (pgPids.length > 0) {
    info(`端口 ${cfg.pg.port} 由进程 ${pgPids.join(',')} 占用，执行优雅关闭`);
    const pgCtl = path.join(cfg.pg.binDir, 'pg_ctl.exe');
    const r = sh(pgCtl, ['stop', '-D', cfg.pg.dataDir, '-m', 'fast', '-w', '-t', '60']);
    if (r.code === 0) {
      ok('PostgreSQL 已优雅停止');
    } else {
      warn(`pg_ctl stop 返回 ${r.code}，改按进程号结束`);
      pgPids.forEach((pid) => taskkill(pid));
    }
    await waitFor('PostgreSQL 端口释放', async () => (await probePort(cfg.pg.port)) === false, 30000);
  } else {
    info(`端口 ${cfg.pg.port} 未被占用，跳过`);
  }

  const appPids = listeningPids(cfg.app.port);
  if (appPids.length > 0) {
    info(`端口 ${cfg.app.port} 由进程 ${appPids.join(',')} 占用，结束应用进程`);
    appPids.forEach((pid) => taskkill(pid));
    await waitFor('应用端口释放', async () => (await probePort(cfg.app.port)) === false, 20000);
    ok('应用进程已结束');
  } else {
    info(`端口 ${cfg.app.port} 未被占用，跳过`);
  }
}

// ---------------------------------------------------------------- 删除旧服务
function removeService(name) {
  const st = serviceState(name);
  if (st === 'NOT_INSTALLED') {
    info(`服务 ${name} 不存在，跳过`);
    return;
  }
  run('sc.exe', ['stop', name]);
  run('nssm', ['remove', name, 'confirm']);
  const r = run('sc.exe', ['delete', name]);
  if (r.code === 0) ok(`已删除旧服务 ${name}`);
  else warn(`删除 ${name} 返回 ${r.code}: ${r.out.split(/\r?\n/)[0]}`);
}

// ---------------------------------------------------------------- 注册
function createService(name, binPath, displayName) {
  removeService(name);
  const r = sh('sc.exe', ['create', name, 'binPath=', binPath, 'start=', 'auto', 'DisplayName=', displayName]);
  if (r.code !== 0) {
    throw new Error(`创建服务 ${name} 失败 (${r.code}): ${r.out}`);
  }
  ok(`已创建服务 ${name}`);
}

function registerPg(cfg) {
  title(`注册数据库服务 ${cfg.pg.serviceName}`);
  removeService(cfg.pg.serviceName);

  const pgCtl = path.join(cfg.pg.binDir, 'pg_ctl.exe');
  const args = [
    'register',
    '-N', cfg.pg.serviceName,
    '-D', cfg.pg.dataDir,
    '-S', 'auto',
    '-U', cfg.pg.account,
  ];
  const r = run(pgCtl, args, { timeout: 180000 });
  if (r.code === 0) {
    ok('pg_ctl register 注册成功');
  } else {
    warn(`pg_ctl register 失败 (${r.code}): ${r.out}`);
    warn('回退到 sc create 手工注册');
    const pgExe = path.join(cfg.pg.binDir, 'postgres.exe');
    const binPath = `"${pgExe}" -D "${cfg.pg.dataDir}"`;
    createService(cfg.pg.serviceName, binPath, cfg.pg.displayName);
    const c = sh('sc.exe', ['config', cfg.pg.serviceName, 'obj=', cfg.pg.account]);
    if (c.code !== 0) warn(`设置服务账户失败: ${c.out}`);
    else ok(`服务账户设为 ${cfg.pg.account}`);
  }

  // 数据目录授权：NetworkService 需要读写数据目录（等价于 Authenticated Users 已具备的权限，
  // 这里显式授予，避免目录被改过 ACL 后数据库起不来）
  const dataDir = cfg.pg.dataDir;
  if (dataDir && fs.existsSync(dataDir)) {
    const g = sh('icacls', [dataDir, '/grant', '*S-1-5-20:(OI)(CI)M', '/T', '/C', '/Q'], { timeout: 180000 });
    if (g.code === 0) ok('数据目录已授予 NETWORK SERVICE 修改权限');
    else warn(`icacls 授权返回 ${g.code}（通常不影响，权限可能已继承）`);
  }

  sh('sc.exe', ['config', cfg.pg.serviceName, 'start=', 'auto']);
  ok('启动类型：自动（开机自启）');
}

function registerApp(cfg) {
  title(`注册应用服务 ${cfg.app.serviceName}`);
  createService(
    cfg.app.serviceName,
    `"${NSSM}" ${cfg.app.serviceName}`,
    cfg.app.displayName,
  );

  const logDir = cfg.logDir;
  const sets = [
    ['Application', cfg.app.nodeExe],
    ['AppParameters', cfg.app.script],
    ['AppDirectory', cfg.app.workDir],
    ['AppStdout', path.join(logDir, 'app.log')],
    ['AppStderr', path.join(logDir, 'app-error.log')],
    ['AppRotateFiles', '1'],
    ['AppRotateOnline', '1'],
    ['AppRotateBytes', String(20 * 1024 * 1024)],
    ['AppExit', 'Default', 'Restart'],
    ['AppRestartDelay', '5000'],
    ['AppThrottle', '15000'],
    ['AppStopMethodConsole', '15000'],
    ['AppStopMethodWindow', '5000'],
    ['AppStopMethodThreads', '15000'],
    ['AppNoConsole', '0'],
    ['Start', 'SERVICE_AUTO_START'],
  ];
  for (const s of sets) {
    const r = sh(NSSM, ['set', cfg.app.serviceName, ...s]);
    if (r.code !== 0) warn(`nssm set ${s[0]} 失败 (${r.code})`);
  }
  ok(`启动命令: ${path.basename(cfg.app.nodeExe)} ${cfg.app.script}`);
  ok(`工作目录: ${cfg.app.workDir}`);
  ok('退出策略: 异常退出后 5 秒自动重启');
  ok('输出日志: ' + path.join(logDir, 'app.log'));
}

function registerHealth(cfg) {
  title(`注册健康值守服务 ${cfg.health.serviceName}`);
  createService(
    cfg.health.serviceName,
    `"${NSSM}" ${cfg.health.serviceName}`,
    cfg.health.displayName,
  );
  const logDir = cfg.logDir;
  const sets = [
    ['Application', cfg.app.nodeExe],
    ['AppParameters', `"${path.join(HERE, 'wms-health.cjs')}" --config "${CONFIG_PATH}"`],
    ['AppDirectory', HERE],
    ['AppStdout', path.join(logDir, 'health-stdout.log')],
    ['AppStderr', path.join(logDir, 'health-stderr.log')],
    ['AppRotateFiles', '1'],
    ['AppRotateOnline', '1'],
    ['AppRotateBytes', String(10 * 1024 * 1024)],
    ['AppExit', 'Default', 'Restart'],
    ['AppRestartDelay', '5000'],
    ['AppThrottle', '15000'],
    ['Start', 'SERVICE_AUTO_START'],
  ];
  for (const s of sets) {
    const r = sh(NSSM, ['set', cfg.health.serviceName, ...s]);
    if (r.code !== 0) warn(`nssm set ${s[0]} 失败 (${r.code})`);
  }
  ok(`探测间隔 ${cfg.health.intervalSec}s，连续失败 ${cfg.health.failureThreshold} 次触发重启`);
}

function setDependenciesAndRecovery(cfg) {
  title('设置依赖顺序与失败恢复策略');

  // 依赖：应用等数据库，健康值守最后
  let r = sh('sc.exe', ['config', cfg.app.serviceName, 'depend=', cfg.pg.serviceName]);
  if (r.code !== 0) warn(`设置应用依赖失败: ${r.out.split(/\r?\n/)[0]}`);
  else ok(`应用依赖 ${cfg.pg.serviceName}`);

  if (!SKIP_HEALTH) {
    r = sh('sc.exe', ['config', cfg.health.serviceName, 'depend=', `${cfg.pg.serviceName}/${cfg.app.serviceName}`]);
    if (r.code !== 0) warn(`设置值守依赖失败: ${r.out.split(/\r?\n/)[0]}`);
    else ok(`值守依赖 数据库 + 应用`);
  }

  // SCM 级失败恢复（NSSM 之外的第二层保险）
  const targets = [cfg.pg.serviceName, cfg.app.serviceName];
  if (!SKIP_HEALTH) targets.push(cfg.health.serviceName);
  for (const t of targets) {
    const f = sh('sc.exe', [
      'failure', t, 'reset=', '86400',
      'actions=', 'restart/5000/restart/15000/restart/60000',
    ]);
    if (f.code === 0) ok(`${t} 失败恢复: 5s → 15s → 60s 重启`);
    else warn(`${t} 失败恢复策略设置返回 ${f.code}`);
  }
}

// ---------------------------------------------------------------- 启动与验证
async function startAndVerify(cfg) {
  title('启动服务并验证');

  info(`启动 ${cfg.pg.serviceName} ...`);
  sh('sc.exe', ['start', cfg.pg.serviceName]);
  const pgOk = await waitFor(`PostgreSQL:${cfg.pg.port}`, () => probePort(cfg.pg.port), 90000);
  if (pgOk) ok(`PostgreSQL 已监听 127.0.0.1:${cfg.pg.port}`);
  else fail('PostgreSQL 未能启动，请查看事件查看器 / 数据目录日志');

  if (!pgOk) return false;

  info(`启动 ${cfg.app.serviceName} ...`);
  sh('sc.exe', ['start', cfg.app.serviceName]);
  const appOk = await waitFor(`WMS 应用:${cfg.app.port}`, () => probePort(cfg.app.port), 120000);
  if (appOk) ok(`WMS 应用已监听 ${cfg.app.port} / ${cfg.app.httpsPort}`);
  else fail('WMS 应用未能启动，请查看 runtime\\logs\\app-error.log');

  if (appOk && !SKIP_HEALTH) {
    info(`启动 ${cfg.health.serviceName} ...`);
    sh('sc.exe', ['start', cfg.health.serviceName]);
    await sleep(2500);
    const st = serviceState(cfg.health.serviceName);
    if (st === 'RUNNING') ok('健康值守已运行');
    else warn(`健康值守状态: ${st}`);
  }

  return pgOk && appOk;
}

async function rollback(cfg) {
  title('安装失败，回滚到手动运行方式');
  warn('服务未能正常启动，尝试以原有方式临时拉起，保证业务可用');
  const pgCtl = path.join(cfg.pg.binDir, 'pg_ctl.exe');
  if (!(await probePort(cfg.pg.port))) {
    const r = run(pgCtl, ['start', '-D', cfg.pg.dataDir, '-l', path.join(cfg.logDir, 'pg-manual.log'), '-w', '-t', '60']);
    info(`PostgreSQL 手动启动: ${r.code === 0 ? '成功' : '失败 ' + r.out.split(/\r?\n/)[0]}`);
  }
  if (!(await probePort(cfg.app.port))) {
    const { spawn } = require('child_process');
    const fd = fs.openSync(path.join(cfg.logDir, 'app-manual.log'), 'a');
    const child = spawn(cfg.app.nodeExe, [cfg.app.script], {
      cwd: cfg.app.workDir, detached: true, stdio: ['ignore', fd, fd],
    });
    child.unref();
    info(`应用手动启动: PID ${child.pid}`);
  }
  console.log(`\n${C.yellow}请把上面的报错信息（含日志路径）反馈给维护人员。${C.reset}`);
}

// ---------------------------------------------------------------- 互斥
/**
 * 服务模式下不再需要「登录自启 + 进程守护」这套免管理员方案，
 * 两者同时存在会争抢同一端口，故安装成功后主动停用。
 */
function disableStartupFallback(cfg) {
  title('停用免管理员登录自启（避免两套守护冲突）');

  const startupDir = path.join(
    process.env.APPDATA || '',
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
  );
  const vbs = path.join(startupDir, 'WMS-Guardian.vbs');
  const guardianCfg = path.join(process.env.LOCALAPPDATA || '', 'WMS', 'guardian.txt');

  let removed = 0;
  for (const p of [vbs, guardianCfg]) {
    if (p && fs.existsSync(p)) {
      try { fs.unlinkSync(p); removed += 1; } catch (_) { /* 占用时忽略 */ }
    }
  }
  if (removed > 0) ok(`已移除 ${removed} 个登录自启文件`);
  else info('未部署登录自启，无需清理');

  // 结束可能正在运行的守护器（锁端口 38017 的 node 进程）
  const r = run('netstat', ['-ano']);
  const pids = new Set();
  for (const line of r.out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const c = line.trim().split(/\s+/);
    if (c[1] && c[1].endsWith(':38017')) {
      const pid = Number(c[c.length - 1]);
      if (pid > 0) pids.add(pid);
    }
  }
  for (const pid of pids) {
    if (taskkill(pid)) ok(`已结束运行中的守护器进程 PID ${pid}`);
  }

  // 写入服务模式标记，守护器启动时据此自动退出
  const flag = path.join(cfg.app.workDir, 'runtime', 'service-mode.flag');
  try {
    fs.mkdirSync(path.dirname(flag), { recursive: true });
    fs.writeFileSync(
      flag,
      `Windows 服务模式已于 ${new Date().toISOString()} 启用\n` +
      `删除本文件后，登录自启的守护器将重新接管。\n`,
    );
    ok(`已启用服务模式标记 ${flag}`);
  } catch (e) {
    warn(`写入服务模式标记失败: ${e.message}`);
  }
}

// ---------------------------------------------------------------- 主流程
async function main() {
  console.log(`${C.bold}========================================${C.reset}`);
  console.log(`${C.bold} WMS 自启动值守 · 服务安装${C.reset}`);
  console.log(`${C.bold}========================================${C.reset}`);
  if (DRY_RUN) console.log(`${C.yellow}  [dry-run 模式：仅检查，不修改系统]${C.reset}`);

  assertAdmin();
  const cfg = loadConfig();
  stageNssm();

  if (DRY_RUN) {
    title('dry-run 结束');
    ok('配置与依赖检查通过，可正式安装');
    return;
  }

  await stopLegacyProcesses(cfg);
  registerPg(cfg);
  registerApp(cfg);
  if (!SKIP_HEALTH) registerHealth(cfg);
  setDependenciesAndRecovery(cfg);

  const okAll = await startAndVerify(cfg);
  if (!okAll) {
    await rollback(cfg);
    process.exit(1);
  }

  disableStartupFallback(cfg);

  title('安装完成');
  console.log(`
  ${C.green}${C.bold}开机自启与自动恢复已生效${C.reset}

  服务清单：
    ${cfg.pg.serviceName.padEnd(16)} 自动启动 · 崩溃后由 SCM 重启
    ${cfg.app.serviceName.padEnd(16)} 自动启动 · 崩溃后 5 秒自动拉起
    ${cfg.health.serviceName.padEnd(16)} 每 ${cfg.health.intervalSec}s 探活，连续 ${cfg.health.failureThreshold} 次失败自动重启对应服务

  访问地址：
    http://<本机IP>:${cfg.app.port}
    https://<本机IP>:${cfg.app.httpsPort}

  运维命令：
    wmsctl.cmd status     查看状态
    wmsctl.cmd logs       查看日志
    wmsctl.cmd doctor     连通性自检

  提示：断电重启后服务会自动恢复；若整机未通电自启，
        请在 BIOS 中把「AC Power Loss / 断电恢复」设为 Power On。
`);
}

main().catch((e) => {
  console.error(`\n${C.red}安装异常中止: ${e.message}${C.reset}\n`);
  process.exit(1);
});
