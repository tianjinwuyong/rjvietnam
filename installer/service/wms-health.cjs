#!/usr/bin/env node
/**
 * WMS 健康值守 (Health Watchdog)
 * ------------------------------------------------------------------
 * 职责：进程级守护之外的第二道防线。
 *   1. 定时探测 PostgreSQL(5433) 与 WMS 应用(3000/3443) 是否真正可用；
 *   2. 连续失败达到阈值后，重启对应的 Windows 服务；
 *   3. 服务被意外置为 STOPPED 时重新拉起；
 *   4. 全过程写日志，便于事后追溯。
 *
 * 说明：进程被直接杀掉这一场景由 NSSM(pg_ctl register) 的 AppExit Restart
 *      在秒级覆盖；本程序处理的是「服务停了」「进程活着但端口不通」等
 *      进程级守护发现不了的情况。
 *
 * 用法：node wms-health.cjs [--config <path>]
 * 由 Windows 服务 WMS-Health 托管，无需手动运行。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');

// ---------------------------------------------------------------- 配置
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

const CONFIG_PATH =
  argValue('--config') || path.join(__dirname, 'service.config.json');

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  console.error(`[FATAL] 无法读取配置 ${CONFIG_PATH}: ${e.message}`);
  process.exit(2);
}

const LOG_DIR = cfg.logDir || path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'health.log');
const MAX_LOG_BYTES = 8 * 1024 * 1024;

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {
  console.error(`[FATAL] 无法创建日志目录 ${LOG_DIR}: ${e.message}`);
  process.exit(2);
}

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level.padEnd(5)}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_LOG_BYTES) {
      const bak = LOG_FILE + '.1';
      try { fs.unlinkSync(bak); } catch (_) { /* 忽略 */ }
      fs.renameSync(LOG_FILE, bak);
    }
  } catch (_) { /* 日志失败不影响值守 */ }
}

// ---------------------------------------------------------------- 探针
function probePort(port, host = '127.0.0.1', timeoutMs = 4000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    try {
      sock.connect(port, host);
    } catch (_) {
      finish(false);
    }
  });
}

function probeHttp(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const req = mod.get(
        url,
        { rejectUnauthorized: false, timeout: timeoutMs },
        (res) => {
          res.resume();
          done(res.statusCode >= 200 && res.statusCode < 500);
        },
      );
      req.on('timeout', () => { req.destroy(); done(false); });
      req.on('error', () => done(false));
    } catch (_) {
      done(false);
    }
  });
}

// ---------------------------------------------------------------- 服务控制
// sc.exe 在中文系统上标签会本地化，但状态常量始终是英文，故只匹配状态值。
const STATE_RE =
  /\b(RUNNING|STOPPED|START_PENDING|STOP_PENDING|PAUSED_PENDING|PAUSED|CONTINUE_PENDING)\b/g;

function scQuery(serviceName) {
  return new Promise((resolve) => {
    execFile(
      'sc.exe',
      ['query', serviceName],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve({ exists: false, state: 'NOT_INSTALLED' });
        const matches = [...String(stdout).matchAll(STATE_RE)].map((m) => m[1]);
        resolve({ exists: true, state: matches[0] || 'UNKNOWN' });
      },
    );
  });
}

function scAction(action, serviceName) {
  return new Promise((resolve) => {
    execFile(
      'sc.exe',
      [action, serviceName],
      { windowsHide: true, timeout: 120000 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() });
      },
    );
  });
}

// ---------------------------------------------------------------- 状态跟踪
const track = {
  pg: { fails: 0, lastRestartAt: 0, everOk: false },
  app: { fails: 0, lastRestartAt: 0, everOk: false },
};

const THRESHOLD = Number(cfg.health.failureThreshold) || 3;
const COOLDOWN_MS = (Number(cfg.health.restartCooldownSec) || 120) * 1000;
const INTERVAL_MS = (Number(cfg.health.intervalSec) || 20) * 1000;

async function ensureRunning(trackKey, serviceName) {
  const { state } = await scQuery(serviceName);
  if (state === 'NOT_INSTALLED') {
    log('WARN', `服务 ${serviceName} 未安装，跳过自愈`);
    return false;
  }
  if (state === 'RUNNING') return true;
  if (state === 'START_PENDING' || state === 'STOP_PENDING') {
    log('INFO', `服务 ${serviceName} 正在 ${state}，等待其完成`);
    return true;
  }
  log('WARN', `服务 ${serviceName} 状态为 ${state}，尝试拉起`);
  const r = await scAction('start', serviceName);
  log(r.ok ? 'INFO' : 'ERROR', `sc start ${serviceName} -> ${r.ok ? '成功' : r.out}`);
  track[trackKey].lastRestartAt = Date.now();
  return r.ok;
}

async function checkPg() {
  if (!cfg.pg.enabled) return;
  const t = track.pg;
  const ok = await probePort(cfg.pg.port);

  if (ok) {
    if (t.fails > 0) log('INFO', `PostgreSQL:${cfg.pg.port} 已恢复`);
    t.fails = 0;
    t.everOk = true;
    return;
  }

  t.fails += 1;
  log('WARN', `PostgreSQL:${cfg.pg.port} 探测失败 (${t.fails}/${THRESHOLD})`);
  if (t.fails < THRESHOLD) return;

  if (Date.now() - t.lastRestartAt < COOLDOWN_MS) {
    log('INFO', 'PostgreSQL 重启冷却中，本轮跳过');
    return;
  }

  const svc = cfg.pg.serviceName;
  const { state } = await scQuery(svc);
  if (state === 'RUNNING') {
    // 服务在跑但端口不通：数据库进程假死，需重启服务
    log('ERROR', `PostgreSQL 进程存在但端口不通，重启服务 ${svc}`);
    const r = await scAction('stop', svc);
    log(r.ok ? 'INFO' : 'ERROR', `sc stop ${svc} -> ${r.ok ? '成功' : r.out}`);
    await sleep(8000);
  }
  await ensureRunning('pg', svc);
  t.fails = 0;
  t.lastRestartAt = Date.now();
}

async function checkApp() {
  if (!cfg.app.enabled) return;
  const t = track.app;

  let ok = await probePort(cfg.app.port);
  if (ok && cfg.health.httpProbe) {
    ok = await probeHttp(`http://127.0.0.1:${cfg.app.port}/`);
  }

  if (ok) {
    if (t.fails > 0) log('INFO', `WMS 应用:${cfg.app.port} 已恢复`);
    t.fails = 0;
    t.everOk = true;
    return;
  }

  t.fails += 1;
  log('WARN', `WMS 应用:${cfg.app.port} 探测失败 (${t.fails}/${THRESHOLD})`);
  if (t.fails < THRESHOLD) return;

  if (Date.now() - t.lastRestartAt < COOLDOWN_MS) {
    log('INFO', 'WMS 应用重启冷却中，本轮跳过');
    return;
  }

  const svc = cfg.app.serviceName;
  const { state } = await scQuery(svc);
  if (state === 'RUNNING') {
    log('ERROR', `WMS 应用进程存在但无响应，重启服务 ${svc}`);
    const r = await scAction('stop', svc);
    log(r.ok ? 'INFO' : 'ERROR', `sc stop ${svc} -> ${r.ok ? '成功' : r.out}`);
    await sleep(6000);
  }
  await ensureRunning('app', svc);
  t.fails = 0;
  t.lastRestartAt = Date.now();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------- 主循环
let stopping = false;

async function tick() {
  try {
    await checkPg();
  } catch (e) {
    log('ERROR', `checkPg 异常: ${e.message}`);
  }
  try {
    await checkApp();
  } catch (e) {
    log('ERROR', `checkApp 异常: ${e.message}`);
  }
}

async function main() {
  log('INFO', '====== WMS 健康值守启动 ======');
  log('INFO', `配置文件: ${CONFIG_PATH}`);
  log(
    'INFO',
    `监视: PostgreSQL:${cfg.pg.port}(${cfg.pg.serviceName}) / ` +
      `应用:${cfg.app.port}(${cfg.app.serviceName})`,
  );
  log('INFO', `间隔 ${INTERVAL_MS / 1000}s，阈值 ${THRESHOLD} 次，冷却 ${COOLDOWN_MS / 1000}s`);

  // 启动后先等待一轮，给服务自身完成初始化的时间
  await sleep(Math.min(INTERVAL_MS, 15000));

  while (!stopping) {
    await tick();
    if (stopping) break;
    await sleep(INTERVAL_MS);
  }
  log('INFO', '====== WMS 健康值守退出 ======');
}

function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log('INFO', `收到 ${sig}，准备退出`);
  // 不主动停止被守护的服务：服务自身有 SCM 生命周期管理
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => {
  log('ERROR', `未捕获异常: ${e && e.stack ? e.stack : e}`);
});
process.on('unhandledRejection', (e) => {
  log('ERROR', `未处理 Promise 拒绝: ${e && e.stack ? e.stack : e}`);
});

main().catch((e) => {
  log('FATAL', `主循环崩溃: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
