#!/usr/bin/env node
/**
 * WMS 进程守护器 (Guardian)
 * ------------------------------------------------------------------
 * 免管理员方案的核心：不注册 Windows 服务，直接以普通用户权限守护两个进程。
 *
 *   PostgreSQL  -> pg_ctl start -D <datadir>（端口 5433）
 *   WMS 应用    -> node dist/main.js（端口 3000 / 3443）
 *
 * 行为：
 *   - 端口已在监听则视为健康，绝不重复启动（可安全接管人工启动的实例）；
 *   - 进程退出后立即重建，带指数退避，避免崩溃循环打满 CPU；
 *   - 自动清理断电残留的 postmaster.pid；
 *   - 单实例运行（本地端口锁），日志写入 runtime/logs/guardian.log；
 *   - 若检测到已切换为 Windows 服务模式（runtime/service-mode.flag），自动退出。
 *
 * 由 WMS-Guardian.vbs 循环拉起，VBS 负责进程级的再次兜底。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const CONFIG_PATH = process.env.WMS_CONFIG || path.join(HERE, 'service.config.json');
const LOCK_PORT = 38017;
const SERVICE_FLAG = path.join(ROOT, 'runtime', 'service-mode.flag');

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const LOG_DIR = cfg.logDir || path.join(ROOT, 'runtime', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'guardian.log');
const APP_LOG = path.join(LOG_DIR, 'app-console.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level.padEnd(5)}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
    if (fs.statSync(LOG_FILE).size > 8 * 1024 * 1024) {
      try { fs.unlinkSync(LOG_FILE + '.1'); } catch (_) {}
      fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    }
  } catch (_) {}
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------- 探针
function probePort(port, host = '127.0.0.1', timeoutMs = 2500) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let d = false;
    const f = (v) => { if (!d) { d = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => f(true));
    s.once('timeout', () => f(false));
    s.once('error', () => f(false));
    try { s.connect(port, host); } catch (_) { f(false); }
  });
}

function probeHttp(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    let d = false;
    const done = (v) => { if (!d) { d = true; resolve(v); } };
    try {
      const req = mod.get(url, { rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
        res.resume(); done(res.statusCode);
      });
      req.on('timeout', () => { req.destroy(); done(0); });
      req.on('error', () => done(0));
    } catch (_) { done(0); }
  });
}

// ---------------------------------------------------------------- 单实例锁
function acquireLock() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        log('WARN', `已有守护器实例在运行（锁端口 ${LOCK_PORT} 被占用），本实例退出`);
        resolve(null);
      } else {
        log('WARN', `锁端口异常 ${e.code}，继续运行（不做单实例保护）`);
        resolve({ close() {} });
      }
    });
    srv.once('listening', () => resolve(srv));
    srv.listen(LOCK_PORT, '127.0.0.1');
  });
}

// ---------------------------------------------------------------- 数据库
function clearStalePidFile() {
  const pidFile = path.join(cfg.pg.dataDir, 'postmaster.pid');
  if (!fs.existsSync(pidFile)) return false;
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(pidFile, 'utf8').split(/\r?\n/)[0].trim());
  } catch (_) { return false; }
  if (!pid) return false;
  try {
    process.kill(pid, 0); // 进程存在则返回，不抛异常
    return false;
  } catch (e) {
    if (e.code === 'EPERM') return false; // 存在但无权限
  }
  try {
    fs.unlinkSync(pidFile);
    log('WARN', `清理断电残留的 postmaster.pid（记录的 PID ${pid} 已不存在）`);
    return true;
  } catch (e) {
    log('ERROR', `无法删除 postmaster.pid: ${e.message}`);
    return false;
  }
}

let pgStarting = false;
let pgFailStreak = 0;

function startPg() {
  return new Promise((resolve) => {
    if (pgStarting) return resolve(false);
    pgStarting = true;
    clearStalePidFile();

    const pgCtl = path.join(cfg.pg.binDir, 'pg_ctl.exe');
    const logFile = path.join(LOG_DIR, 'pg-server.log');
    log('INFO', `启动 PostgreSQL: ${cfg.pg.dataDir}`);
    const t0 = Date.now();

    const child = spawn(
      pgCtl,
      ['start', '-D', cfg.pg.dataDir, '-l', logFile, '-w', '-t', '60'],
      { stdio: 'ignore', windowsHide: true, detached: true },
    );

    child.on('exit', async (code) => {
      pgStarting = false;
      if (code === 0) {
        const wait = await waitPort(cfg.pg.port, 60000);
        if (wait) {
          log('INFO', `PostgreSQL 已就绪（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
          pgFailStreak = 0;
          resolve(true);
        } else {
          log('ERROR', 'pg_ctl 返回成功但端口未就绪');
          pgFailStreak += 1;
          resolve(false);
        }
      } else {
        log('ERROR', `pg_ctl start 失败 (exit ${code})，详见 ${logFile}`);
        pgFailStreak += 1;
        resolve(false);
      }
    });

    child.on('error', (e) => {
      pgStarting = false;
      log('ERROR', `pg_ctl 无法执行: ${e.message}`);
      pgFailStreak += 1;
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------- 应用
let appChild = null;
let appStarting = false;
let appFailStreak = 0;

function startApp() {
  return new Promise(async (resolve) => {
    if (appStarting) return resolve(false);
    appStarting = true;

    const nodeExe = cfg.app.nodeExe;
    const scriptPath = path.join(cfg.app.workDir, cfg.app.script);
    log('INFO', `启动 WMS 应用: ${cfg.app.script} (cwd=${cfg.app.workDir})`);
    const t0 = Date.now();

    let fd = null;
    try {
      fd = fs.openSync(APP_LOG, 'a');
      fs.writeSync(fd, `\n===== 启动 ${new Date().toISOString()} =====\n`);
    } catch (_) {}

    const child = spawn(nodeExe, [scriptPath], {
      cwd: cfg.app.workDir,
      stdio: ['ignore', fd === null ? 'ignore' : fd, fd === null ? 'ignore' : fd],
      windowsHide: true,
      // 独立进程组：守护器自身被结束时，应用进程不会被一并清理
      detached: true,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
    });
    appChild = child;
    appStarting = false;
    log('INFO', `应用进程 PID ${child.pid}`);

    child.on('exit', (code, signal) => {
      appChild = null;
      log('WARN', `应用进程退出 (code=${code}, signal=${signal})`);
      const delay = Math.min(60000, 3000 * Math.pow(2, Math.min(appFailStreak, 4)));
      appFailStreak += 1;
      setTimeout(() => {
        log('INFO', `${Math.round(delay / 1000)}s 后重新拉起应用`);
        startApp();
      }, delay);
    });

    child.on('error', (e) => {
      appChild = null;
      log('ERROR', `应用进程启动失败: ${e.message}`);
      appFailStreak += 1;
    });

    const up = await waitPort(cfg.app.port, 90000);
    if (up) {
      log('INFO', `应用已监听 ${cfg.app.port}（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
      appFailStreak = 0;
      resolve(true);
    } else {
      log('ERROR', '应用端口 90s 内未就绪，继续观察');
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------- 工具
function waitPort(port, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = async () => {
      if (await probePort(port)) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 1000);
    };
    tick();
  });
}

// ---------------------------------------------------------------- 主循环
let stopping = false;
let appHttpFailStreak = 0;

async function tick() {
  // 数据库
  const pgOk = await probePort(cfg.pg.port);
  if (!pgOk) {
    if (pgFailStreak >= 5) {
      log('ERROR', `PostgreSQL 连续 ${pgFailStreak} 次拉起失败，退避 60s`);
      pgFailStreak = 0;
      await sleep(60000);
      return;
    }
    await startPg();
  } else if (pgFailStreak > 0) {
    pgFailStreak = 0;
  }

  // 应用
  const appUp = await probePort(cfg.app.port);
  if (!appUp) {
    await startApp();
  } else {
    appFailStreak = 0;
    // 端口通但 HTTP 无响应：仅告警，避免误杀他人进程
    const code = await probeHttp(`http://127.0.0.1:${cfg.app.port}/`);
    if (!code) {
      appHttpFailStreak += 1;
      if (appHttpFailStreak === 3) {
        log('ERROR', `应用端口 ${cfg.app.port} 已监听但 HTTP 连续 3 次无响应，可能处于假死状态`);
      }
    } else {
      appHttpFailStreak = 0;
    }
  }
}

async function main() {
  log('INFO', '====== WMS 守护器启动 ======');

  if (fs.existsSync(SERVICE_FLAG)) {
    log('INFO', '检测到已启用 Windows 服务模式（runtime/service-mode.flag），守护器退出，避免重复拉起');
    process.exit(0);
  }

  const lock = await acquireLock();
  if (!lock) process.exit(0);

  log('INFO', `配置: ${CONFIG_PATH}`);
  log('INFO', `监视 PostgreSQL:${cfg.pg.port} / 应用:${cfg.app.port}`);

  const shutdown = (sig) => {
    if (stopping) return;
    stopping = true;
    log('INFO', `收到 ${sig}，守护器退出（数据库与应用进程继续保持运行）`);
    if (appChild) log('INFO', `应用进程 PID ${appChild.pid} 交由系统继续运行`);
    try { lock.close(); } catch (_) {}
    setTimeout(() => process.exit(0), 800);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (e) => log('ERROR', `未捕获异常: ${e && e.stack ? e.stack : e}`));
  process.on('unhandledRejection', (e) => log('ERROR', `未处理拒绝: ${e && e.stack ? e.stack : e}`));

  await sleep(2000);

  while (!stopping) {
    try {
      await tick();
    } catch (e) {
      log('ERROR', `循环异常: ${e.message}`);
    }
    await sleep(6000);
  }
}

main().catch((e) => {
  log('FATAL', `守护器崩溃: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
