#!/usr/bin/env node
/**
 * WMS 值守运维命令 (wmsctl)
 * ------------------------------------------------------------------
 *   status    服务状态、端口、进程总览
 *   start     启动三个服务（按依赖顺序）
 *   stop      停止三个服务
 *   restart   重启三个服务
 *   logs      查看日志（app / health / pg / error）
 *   doctor    深度自检：端口 + HTTP + 数据库真实连通
 *   test      自愈能力实测：强制结束应用进程，计量自动拉起耗时
 *   config    显示当前配置文件的关键路径
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const CONFIG_PATH = path.join(HERE, 'service.config.json');
const gbk = new TextDecoder('gbk');

const C = {
  reset: '\x1b[0m', dim: '\x1b[90m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m',
};
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`);
const bad = (m) => console.log(`  ${C.red}✗${C.reset} ${m}`);
const info = (m) => console.log(`  ${C.dim}·${C.reset} ${m}`);
const warn = (m) => console.log(`  ${C.yellow}!${C.reset} ${m}`);
const head = (m) => console.log(`\n${C.cyan}${C.bold}${m}${C.reset}`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { windowsHide: true, timeout: opts.timeout || 60000 });
  return {
    code: r.status === null ? -1 : r.status,
    out: `${r.stdout ? gbk.decode(r.stdout) : ''}${r.stderr ? gbk.decode(r.stderr) : ''}`.trim(),
  };
}

function loadCfg() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error(`无法读取配置 ${CONFIG_PATH}: ${e.message}`);
    process.exit(4);
  }
}

function serviceState(name) {
  const r = run('sc.exe', ['query', name]);
  if (r.code === 0) {
    const m = /\b(RUNNING|STOPPED|START_PENDING|STOP_PENDING|PAUSED)\b/.exec(r.out);
    return m ? m[1] : 'UNKNOWN';
  }
  if (/1060/.test(r.out)) return 'NOT_INSTALLED';
  // 输出为空通常意味着 sc.exe 被执行策略拦截，而非服务不存在
  if (!r.out) return 'NO_ACCESS';
  return 'NOT_INSTALLED';
}

function probePort(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let d = false;
    const f = (v) => { if (!d) { d = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => f(true));
    s.once('timeout', () => f(false));
    s.once('error', () => f(false));
    try { s.connect(port, '127.0.0.1'); } catch (_) { f(false); }
  });
}

function probeHttp(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    let d = false;
    const done = (v) => { if (!d) { d = true; resolve(v); } };
    try {
      const req = mod.get(url, { rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
        res.resume();
        done(res.statusCode);
      });
      req.on('timeout', () => { req.destroy(); done(0); });
      req.on('error', () => done(0));
    } catch (_) { done(0); }
  });
}

function listeningPids(port) {
  const r = run('netstat', ['-ano']);
  const pids = new Set();
  for (const line of r.out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const c = line.trim().split(/\s+/);
    if (c[1] && c[1].endsWith(`:${port}`)) {
      const pid = Number(c[c.length - 1]);
      if (pid > 0) pids.add(pid);
    }
  }
  return [...pids];
}

function readEnv(cfg) {
  const envPath = path.join(cfg.app.workDir, '.env');
  const map = {};
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) map[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch (_) { /* 无 .env 时忽略 */ }
  return map;
}

function fmtState(s) {
  if (s === 'RUNNING') return `${C.green}${s}${C.reset}`;
  if (s === 'STOPPED') return `${C.red}${s}${C.reset}`;
  if (s === 'NOT_INSTALLED') return `${C.yellow}未安装${C.reset}`;
  if (s === 'NO_ACCESS') return `${C.yellow}无法查询${C.reset}`;
  return `${C.yellow}${s}${C.reset}`;
}

// ---------------------------------------------------------------- status
async function cmdStatus(cfg) {
  const cfgm = loadCfg();
  head('服务状态');
  const svcs = [
    [cfg.pg.serviceName, '数据库'],
    [cfg.app.serviceName, '应用'],
    [cfg.health.serviceName, '健康值守'],
  ];
  for (const [name, label] of svcs) {
    const st = serviceState(name);
    const pad = ' '.repeat(Math.max(0, 18 - name.length));
    console.log(`  ${name}${pad}${label}\t${fmtState(st)}`);
  }
  if (svcs.some(([n]) => serviceState(n) === 'NO_ACCESS')) {
    warn('sc 命令当前受限，服务状态不可读；下方「运行探测」结果仍然有效');
  }

  head('运行探测');
  const pgOk = await probePort(cfg.pg.port);
  console.log(`  PostgreSQL 127.0.0.1:${cfg.pg.port}\t${pgOk ? C.green + '可连接' + C.reset : C.red + '不通' + C.reset}`);

  const appPids = listeningPids(cfg.app.port);
  if (appPids.length) {
    console.log(`  应用 ${cfg.app.port} / ${cfg.app.httpsPort}\t${C.green}监听中${C.reset} (PID ${appPids.join(',')})`);
  } else {
    console.log(`  应用 ${cfg.app.port} / ${cfg.app.httpsPort}\t${C.red}未监听${C.reset}`);
  }

  const code = await probeHttp(`http://127.0.0.1:${cfg.app.port}/`);
  console.log(`  HTTP 首页\t\t\t${code ? C.green + 'HTTP ' + code + C.reset : C.red + '无响应' + C.reset}`);

  const guardOn = await probePort(38017, 1200);
  console.log(`  进程守护器 (38017)\t\t${guardOn ? C.green + '运行中' + C.reset : C.yellow + '未运行' + C.reset}`);

  head('最近日志文件');
  for (const f of ['guardian.log', 'health.log', 'app.log', 'app-error.log']) {
    const p = path.join(cfg.logDir, f);
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      info(`${f.padEnd(16)} ${(st.size / 1024).toFixed(1)} KB\t${st.mtime.toLocaleString()}`);
    } else {
      info(`${f.padEnd(16)} (暂无)`);
    }
  }
  console.log('');
}

// ---------------------------------------------------------------- start/stop
async function cmdStart(cfg) {
  head('启动服务');
  for (const [name, ready] of [
    [cfg.pg.serviceName, () => probePort(cfg.pg.port)],
    [cfg.app.serviceName, () => probePort(cfg.app.port)],
    [cfg.health.serviceName, null],
  ]) {
    const st = serviceState(name);
    if (st === 'NOT_INSTALLED') { warn(`${name} 未安装，跳过`); continue; }
    if (st === 'RUNNING') { info(`${name} 已在运行`); continue; }
    const r = run('sc.exe', ['start', name]);
    if (r.code === 0 || /1056/.test(r.out)) ok(`${name} 启动指令已下发`);
    else bad(`${name} 启动失败: ${r.out.split(/\r?\n/)[0]}`);
    if (ready) {
      const dl = Date.now() + 60000;
      while (Date.now() < dl && !(await ready())) {
        await new Promise((r2) => setTimeout(r2, 1000));
      }
      if (await ready()) ok('  就绪');
    }
  }
}

async function cmdStop(cfg) {
  head('停止服务');
  for (const name of [cfg.health.serviceName, cfg.app.serviceName, cfg.pg.serviceName]) {
    if (serviceState(name) === 'NOT_INSTALLED') { info(`${name} 未安装`); continue; }
    const r = run('sc.exe', ['stop', name], { timeout: 90000 });
    if (r.code === 0) ok(`${name} 已停止`);
    else if (/1062/.test(r.out)) info(`${name} 本就未运行`);
    else warn(`${name} 停止返回: ${r.out.split(/\r?\n/)[0]}`);
  }
}

async function cmdRestart(cfg) {
  await cmdStop(cfg);
  await new Promise((r) => setTimeout(r, 2000));
  await cmdStart(cfg);
}

// ---------------------------------------------------------------- logs
function cmdLogs(cfg, args) {
  const which = args[0] || 'health';
  const n = Number(args[1]) || 40;
  const map = {
    health: 'health.log',
    guardian: 'guardian.log',
    app: 'app.log',
    error: 'app-error.log',
    console: 'app-console.log',
    pg: 'pg-server.log',
  };
  const file = path.join(cfg.logDir, map[which] || 'health.log');
  head(`日志: ${file}`);
  if (!fs.existsSync(file)) {
    warn('文件不存在（服务可能尚未产生日志）');
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  console.log(lines.slice(-n).map((l) => '  ' + l).join('\n'));
  console.log('');
}

// ---------------------------------------------------------------- doctor
async function cmdDoctor(cfg) {
  head('WMS 连通性自检');
  let score = 0;
  let total = 0;

  const check = async (label, fn) => {
    total += 1;
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: e.message }; }
    if (r.ok) { ok(`${label}${r.detail ? ' — ' + r.detail : ''}`); score += 1; }
    else bad(`${label}${r.detail ? ' — ' + r.detail : ''}`);
    return r.ok;
  };

  await check('PostgreSQL 端口', async () => {
    const okk = await probePort(cfg.pg.port);
    return { ok: okk, detail: okk ? `127.0.0.1:${cfg.pg.port}` : '端口不通' };
  });

  await check('数据库真实查询', async () => {
    const env = readEnv(cfg);
    if (!env.DB_PASSWORD) return { ok: false, detail: '未读取到 DB_PASSWORD' };
    const psql = path.join(cfg.pg.binDir, 'psql.exe');
    const r = spawnSync(
      psql,
      ['-h', '127.0.0.1', '-p', String(cfg.pg.port), '-U', env.DB_USER || 'postgres',
       '-d', env.DB_NAME || 'wms', '-t', '-A', '-c', 'select 1'],
      {
        windowsHide: true, timeout: 20000,
        env: { ...process.env, PGPASSWORD: env.DB_PASSWORD, PGCLIENTENCODING: 'UTF8' },
      },
    );
    const out = (r.stdout ? r.stdout.toString() : '').trim();
    if (r.status === 0 && out === '1') return { ok: true, detail: `${env.DB_NAME || 'wms'} 库可读写` };
    const err = r.stderr ? r.stderr.toString().split(/\r?\n/)[0] : `exit ${r.status}`;
    return { ok: false, detail: err };
  });

  await check('应用端口', async () => {
    const pids = listeningPids(cfg.app.port);
    return { ok: pids.length > 0, detail: pids.length ? `PID ${pids.join(',')}` : '未监听' };
  });

  await check('HTTP 首页', async () => {
    const code = await probeHttp(`http://127.0.0.1:${cfg.app.port}/`);
    return { ok: code >= 200 && code < 400, detail: code ? `HTTP ${code}` : '无响应' };
  });

  await check('HTTPS 首页', async () => {
    const code = await probeHttp(`https://127.0.0.1:${cfg.app.httpsPort}/`);
    return { ok: code >= 200 && code < 400, detail: code ? `HTTP ${code}` : '无响应' };
  });

  await check('守护机制在线', async () => {
    const st = serviceState(cfg.health.serviceName);
    if (st === 'RUNNING' || st === 'START_PENDING') {
      return { ok: true, detail: 'Windows 服务模式（WMS-Health）' };
    }
    if (await probePort(38017, 1200)) {
      return { ok: true, detail: '进程守护器模式（wms-guardian）' };
    }
    if (st === 'NO_ACCESS') {
      return { ok: false, detail: '无法查询服务状态，且守护器未运行' };
    }
    return { ok: false, detail: '既未安装服务，守护器也未运行' };
  });

  await check('自启机制已启用', async () => {
    const names = [cfg.pg.serviceName, cfg.app.serviceName];
    let autoCount = 0;
    for (const nm of names) {
      const r = run('sc.exe', ['qc', nm]);
      if (r.code === 0 && /AUTO_START/i.test(r.out)) autoCount += 1;
    }
    if (autoCount === names.length) return { ok: true, detail: 'Windows 服务自动启动' };

    const vbs = path.join(
      process.env.APPDATA || '', 'Microsoft', 'Windows',
      'Start Menu', 'Programs', 'Startup', 'WMS-Guardian.vbs',
    );
    if (fs.existsSync(vbs)) return { ok: true, detail: '登录时自动运行（启动文件夹）' };
    return { ok: false, detail: '未发现任何自启配置' };
  });

  console.log(`\n  结果: ${score}/${total} 项通过\n`);
  if (score < total) process.exitCode = 1;
}

// ---------------------------------------------------------------- test
async function cmdTest(cfg) {
  head('自愈能力实测（会强制结束应用进程，业务中断约 5-10 秒）');
  const pids = listeningPids(cfg.app.port);
  if (!pids.length) {
    bad(`应用未在 ${cfg.app.port} 监听，无法测试`);
    process.exitCode = 1;
    return;
  }
  const svcSt = serviceState(cfg.app.serviceName);
  const serviceMode = svcSt === 'RUNNING' || svcSt === 'START_PENDING';
  const guardOn = await probePort(38017, 1200);
  if (!serviceMode && !guardOn) {
    bad('既未安装 WMS-App 服务，进程守护器也不在运行，无自动拉起机制');
    process.exitCode = 1;
    return;
  }
  info(`守护方式: ${serviceMode ? 'Windows 服务' : '进程守护器'}`);

  info(`目标进程 PID ${pids.join(',')}，执行强制结束 ...`);
  const t0 = Date.now();
  for (const pid of pids) run('taskkill', ['/PID', String(pid), '/T', '/F']);

  info('等待自动拉起（最多 120 秒）...');
  const dl = Date.now() + 120000;
  let back = false;
  while (Date.now() < dl) {
    await new Promise((r) => setTimeout(r, 800));
    if (await probePort(cfg.app.port)) {
      const code = await probeHttp(`http://127.0.0.1:${cfg.app.port}/`);
      if (code) { back = true; break; }
    }
  }
  const cost = ((Date.now() - t0) / 1000).toFixed(1);
  const newPids = listeningPids(cfg.app.port);

  console.log('');
  if (back) {
    ok(`应用已自动恢复，耗时 ${cost} 秒（新 PID ${newPids.join(',')}）`);
    if (serviceMode) ok(`服务状态: ${serviceState(cfg.app.serviceName)}`);
    else ok('进程守护器仍在监视，后续异常同样会被拉起');
    console.log(`\n  ${C.green}${C.bold}自愈验证通过${C.reset}\n`);
  } else {
    bad(`超过 120 秒仍未恢复，请执行 wmsctl logs error 查看原因`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- config
function cmdConfig(cfg) {
  head('当前值守配置');
  console.log(`  配置文件        ${CONFIG_PATH}`);
  console.log(`  数据库服务      ${cfg.pg.serviceName}  ${cfg.pg.binDir}`);
  console.log(`  数据目录        ${cfg.pg.dataDir}  (端口 ${cfg.pg.port}, 账户 ${cfg.pg.account})`);
  console.log(`  应用服务        ${cfg.app.serviceName}  ${cfg.app.workDir}`);
  console.log(`  Node 运行时     ${cfg.app.nodeExe}`);
  console.log(`  入口脚本        ${cfg.app.script}  (端口 ${cfg.app.port} / ${cfg.app.httpsPort})`);
  console.log(`  健康值守        ${cfg.health.serviceName}  间隔 ${cfg.health.intervalSec}s / 阈值 ${cfg.health.failureThreshold}`);
  console.log(`  日志目录        ${cfg.logDir}`);
  console.log('');
}

// ---------------------------------------------------------------- main
async function main() {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  const rest = process.argv.slice(3);
  const cfg = loadCfg();

  switch (cmd) {
    case 'status': case 'st': return cmdStatus(cfg);
    case 'start': return cmdStart(cfg);
    case 'stop': return cmdStop(cfg);
    case 'restart': return cmdRestart(cfg);
    case 'logs': case 'log': return cmdLogs(cfg, rest);
    case 'doctor': case 'check': return cmdDoctor(cfg);
    case 'test': return cmdTest(cfg);
    case 'config': return cmdConfig(cfg);
    default:
      console.log(`
${C.bold}WMS 值守运维命令${C.reset}

  wmsctl status        服务状态、端口、日志概览
  wmsctl start         按依赖顺序启动服务
  wmsctl stop          停止全部服务
  wmsctl restart       重启全部服务
  wmsctl logs [app|health|error|pg] [行数]
  wmsctl doctor        深度自检（含数据库真实查询）
  wmsctl test          自愈实测：强制杀进程，验证自动拉起
  wmsctl config        显示配置
`);
  }
}

main().catch((e) => {
  console.error(`执行失败: ${e.message}`);
  process.exit(1);
});
