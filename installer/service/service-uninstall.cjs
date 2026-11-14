#!/usr/bin/env node
/**
 * WMS 自启动值守 —— 服务卸载器
 * 停止并删除 WMS-PostgreSQL / WMS-App / WMS-Health 三个服务。
 * 默认保留数据库数据、应用文件与日志。
 *
 * 用法（管理员）：
 *   node service-uninstall.cjs              卸载服务（不删除数据）
 *   node service-uninstall.cjs --keep-running  卸载后以手动方式拉起，业务不中断
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const HERE = __dirname;
const CONFIG_PATH = path.join(HERE, 'service.config.json');
const KEEP_RUNNING = process.argv.includes('--keep-running');
const gbk = new TextDecoder('gbk');

const C = { reset: '\x1b[0m', dim: '\x1b[90m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m' };
const ok = (m) => console.log(`    ${C.green}✓${C.reset} ${m}`);
const info = (m) => console.log(`    ${C.dim}·${C.reset} ${m}`);
const warn = (m) => console.log(`    ${C.yellow}!${C.reset} ${m}`);
const fail = (m) => console.log(`    ${C.red}✗${C.reset} ${m}`);
const title = (m) => console.log(`\n${C.cyan}${C.bold}${m}${C.reset}`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { windowsHide: true, timeout: opts.timeout || 120000 });
  return {
    code: r.status === null ? -1 : r.status,
    out: `${r.stdout ? gbk.decode(r.stdout) : ''}${r.stderr ? gbk.decode(r.stderr) : ''}`.trim(),
  };
}

function probePort(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const net = require('net');
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

function main() {
  console.log(`${C.bold}========================================${C.reset}`);
  console.log(`${C.bold} WMS 自启动值守 · 服务卸载${C.reset}`);
  console.log(`${C.bold}========================================${C.reset}`);

  if (run('net', ['session']).code !== 0) {
    fail('需要管理员权限，请右键以管理员身份运行');
    process.exit(3);
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    fail(`无法读取配置: ${e.message}`);
    process.exit(4);
  }

  const services = [
    cfg.health.serviceName,
    cfg.app.serviceName,
    cfg.pg.serviceName,
  ];

  title('停止并删除服务');
  for (const name of services) {
    const q = run('sc.exe', ['query', name]);
    if (q.code !== 0) {
      info(`${name} 不存在，跳过`);
      continue;
    }
    run('sc.exe', ['stop', name]);
    run('nssm', ['remove', name, 'confirm']);
    const d = run('sc.exe', ['delete', name]);
    if (d.code === 0) ok(`${name} 已删除`);
    else warn(`${name} 删除返回 ${d.code}（可能已处于删除中）`);
  }

  // 移除服务模式标记，让免管理员的登录自启方案可以重新接管
  const flag = path.join(cfg.app.workDir, 'runtime', 'service-mode.flag');
  if (fs.existsSync(flag)) {
    try {
      fs.unlinkSync(flag);
      ok('已移除服务模式标记');
    } catch (e) {
      warn(`移除服务模式标记失败: ${e.message}`);
    }
  }

  if (KEEP_RUNNING) {
    title('以手动方式拉起服务（业务不中断）');
    const pgCtl = path.join(cfg.pg.binDir, 'pg_ctl.exe');
    if (!probePort(cfg.pg.port)) {
      const r = run(pgCtl, ['start', '-D', cfg.pg.dataDir, '-l', path.join(cfg.logDir, 'pg-manual.log'), '-w', '-t', '60']);
      if (r.code === 0) ok('PostgreSQL 已手动启动');
      else fail(`PostgreSQL 启动失败: ${r.out.split(/\r?\n/)[0]}`);
    } else {
      info('PostgreSQL 仍在运行，无需重启');
    }
    setTimeout(async () => {
      if (!(await probePort(cfg.app.port))) {
        const fd = fs.openSync(path.join(cfg.logDir, 'app-manual.log'), 'a');
        const child = spawn(cfg.app.nodeExe, [cfg.app.script], {
          cwd: cfg.app.workDir, detached: true, stdio: ['ignore', fd, fd],
        });
        child.unref();
        ok(`应用已手动启动 PID ${child.pid}（关闭终端后仍会运行）`);
      } else {
        info('应用仍在运行，无需重启');
      }
    }, 1500);
  }

  setTimeout(() => {
    title('卸载完成');
    console.log(`
  数据库数据目录未删除：${cfg.pg.dataDir}
  应用与日志未删除：${cfg.app.workDir}
  如需彻底清理，请手工删除上述目录（务必先备份数据库）。
`);
  }, KEEP_RUNNING ? 2000 : 500);
}

main();
