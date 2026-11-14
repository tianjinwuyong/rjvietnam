#!/usr/bin/env node
/**
 * WMS 登录自启部署（免管理员）
 * ------------------------------------------------------------------
 * 不注册 Windows 服务、不写注册表，仅使用用户级文件：
 *   1. 写 %LOCALAPPDATA%\WMS\guardian.txt   —— 记录 node 与守护脚本路径（UTF-16LE）
 *   2. 复制 WMS-Guardian.vbs 到「启动」文件夹 —— 登录后静默拉起守护器
 *
 * 适用：无管理员权限的场合；断电重启后需系统完成登录才会触发。
 *       若需「不登录也启动」，请改用 install-autostart.cmd 安装 Windows 服务。
 *
 * 用法：
 *   node startup-deploy.cjs install     部署并立即启动
 *   node startup-deploy.cjs install --no-start
 *   node startup-deploy.cjs uninstall   移除
 *   node startup-deploy.cjs status      查看部署状态
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const CONFIG_PATH = path.join(HERE, 'service.config.json');
const VBS_SRC = path.join(HERE, 'WMS-Guardian.vbs');
const GUARDIAN = path.join(HERE, 'wms-guardian.cjs');

const LOCALAPP = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const CFG_DIR = path.join(LOCALAPP, 'WMS');
const CFG_FILE = path.join(CFG_DIR, 'guardian.txt');
const STARTUP = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
);
const VBS_DST = path.join(STARTUP, 'WMS-Guardian.vbs');

const C = { reset: '\x1b[0m', dim: '\x1b[90m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m' };
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`);
const info = (m) => console.log(`  ${C.dim}·${C.reset} ${m}`);
const warn = (m) => console.log(`  ${C.yellow}!${C.reset} ${m}`);
const bad = (m) => console.log(`  ${C.red}✗${C.reset} ${m}`);
const head = (m) => console.log(`\n${C.cyan}${C.bold}${m}${C.reset}`);

const gbk = new TextDecoder('gbk');

function probePort(port, timeoutMs = 1500) {
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

function loadCfg() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error(`无法读取配置 ${CONFIG_PATH}: ${e.message}`);
    process.exit(4);
  }
}

function guardianRunning() {
  return new Promise((resolve) => {
    const s = new (require('net').Socket)();
    let d = false;
    const f = (v) => { if (!d) { d = true; s.destroy(); resolve(v); } };
    s.setTimeout(1200);
    s.once('connect', () => f(true));
    s.once('timeout', () => f(false));
    s.once('error', () => f(false));
    try { s.connect(38017, '127.0.0.1'); } catch (_) { f(false); }
  });
}

async function cmdStatus(cfg) {
  head('登录自启部署状态');
  const vol = fs.existsSync(VBS_DST);
  console.log(`  启动文件夹脚本   ${vol ? C.green + '已部署' + C.reset : C.yellow + '未部署' + C.reset}`);
  if (vol) info(VBS_DST);
  const cfgOk = fs.existsSync(CFG_FILE);
  console.log(`  路径配置         ${cfgOk ? C.green + '存在' + C.reset : C.yellow + '缺失' + C.reset}`);
  if (cfgOk) info(CFG_FILE);
  console.log(`  守护器运行中     ${(await guardianRunning()) ? C.green + '是' + C.reset : C.red + '否' + C.reset}`);
  console.log(`  数据库 ${cfg.pg.port}      ${(await probePort(cfg.pg.port)) ? C.green + '可连接' + C.reset : C.red + '不通' + C.reset}`);
  console.log(`  应用 ${cfg.app.port}       ${(await probePort(cfg.app.port)) ? C.green + '监听中' + C.reset : C.red + '未监听' + C.reset}`);
  console.log('');
}

async function cmdInstall(cfg, noStart) {
  head('部署登录自启');

  if (!fs.existsSync(VBS_SRC)) {
    bad(`缺少 ${VBS_SRC}`);
    process.exit(5);
  }
  if (!fs.existsSync(cfg.app.nodeExe)) {
    bad(`Node 运行时不存在: ${cfg.app.nodeExe}`);
    process.exit(5);
  }
  if (!fs.existsSync(GUARDIAN)) {
    bad(`守护脚本不存在: ${GUARDIAN}`);
    process.exit(5);
  }
  if (!fs.existsSync(STARTUP)) {
    bad(`启动文件夹不存在: ${STARTUP}`);
    process.exit(5);
  }

  // 1. 路径配置（UTF-16LE + BOM，供 VBScript 用 Tristate=-1 读取中文路径）
  fs.mkdirSync(CFG_DIR, { recursive: true });
  const payload = `\ufeff${cfg.app.nodeExe}\r\n${GUARDIAN}\r\n`;
  fs.writeFileSync(CFG_FILE, Buffer.from(payload, 'utf16le'));
  ok(`路径配置已写入 ${CFG_FILE}`);

  // 2. 启动文件夹脚本
  fs.copyFileSync(VBS_SRC, VBS_DST);
  ok(`启动脚本已部署 ${VBS_DST}`);

  // 3. 立即启动（不必等下次登录）
  if (noStart) {
    info('已跳过立即启动（--no-start）');
  } else if (await guardianRunning()) {
    info('守护器已在运行，无需重复启动');
  } else {
    const child = spawn('wscript.exe', [VBS_DST], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    ok('已通过 wscript 启动守护器（隐藏窗口）');

    // 等待其真正起来
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await guardianRunning()) break;
    }
    if (await guardianRunning()) ok('守护器已就绪');
    else warn('守护器尚未就绪，请执行 wmsctl logs guardian 查看日志');
  }

  head('完成');
  console.log(`
  ${C.green}${C.bold}登录自启 + 进程守护已生效${C.reset}

  · 注销/重启并登录后，守护器自动运行
  · PostgreSQL 与 WMS 应用退出后会被自动拉起
  · 守护器自身退出时，由启动脚本 5 秒后重新拉起

  ${C.yellow}注意：此方式依赖用户登录。如需「开机即启动、无需登录」，${C.reset}
  ${C.yellow}请以管理员身份运行 install-autostart.cmd 安装 Windows 服务。${C.reset}

  查看状态： wmsctl.cmd status
  自愈实测： wmsctl.cmd test
`);
}

async function cmdUninstall() {
  head('移除登录自启');
  if (fs.existsSync(VBS_DST)) {
    fs.unlinkSync(VBS_DST);
    ok('已移除启动文件夹脚本');
  } else {
    info('启动文件夹中无相关脚本');
  }
  if (fs.existsSync(CFG_FILE)) {
    fs.unlinkSync(CFG_FILE);
    ok('已移除路径配置');
  } else {
    info('无路径配置');
  }

  if (await guardianRunning()) {
    const ps = spawnSync('powershell', [
      '-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*wms-guardian.cjs*' } | " +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    ], { windowsHide: true, timeout: 30000 });
    if (ps.status === 0) ok('已停止守护器进程');
    else warn('停止守护器进程失败，请手工结束 wms-guardian.cjs');

    const ps2 = spawnSync('powershell', [
      '-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='wscript.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*WMS-Guardian.vbs*' } | " +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    ], { windowsHide: true, timeout: 30000 });
    if (ps2.status === 0) info('已清理启动器进程');
  } else {
    info('守护器未在运行');
  }

  console.log(`
  ${C.dim}数据库与应用进程保持运行，未受影响。${C.reset}
  ${C.dim}如需停止应用，请手工结束 node 进程（${path.join(ROOT, 'dist', 'main.js')}）。${C.reset}
`);
}

async function main() {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  const noStart = process.argv.includes('--no-start');
  const cfg = loadCfg();

  console.log(`${C.bold}========================================${C.reset}`);
  console.log(`${C.bold} WMS 登录自启（免管理员）${C.reset}`);
  console.log(`${C.bold}========================================${C.reset}`);

  switch (cmd) {
    case 'install': case 'on': return cmdInstall(cfg, noStart);
    case 'uninstall': case 'off': case 'remove': return cmdUninstall();
    case 'status': default: return cmdStatus(cfg);
  }
}

main().catch((e) => {
  console.error(`执行失败: ${e.message}`);
  process.exit(1);
});
