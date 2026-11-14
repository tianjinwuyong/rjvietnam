#!/usr/bin/env node
/**
 * WMS 卸载引导：停服务 + 移除 Windows 服务。
 * 默认保留 pgdata（数据库文件），加 --purge-data 才删除数据。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NSSM = path.join(ROOT, 'scripts', 'nssm.exe');
const PGDATA = path.join(ROOT, 'pgdata');
const SERVICES = ['WMS-App', 'WMS-PostgreSQL'];

function run(exe, args) {
  return spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
}

for (const svc of SERVICES) {
  run('sc', ['stop', svc]);
}
// 等待服务真正退出，否则文件被占用会导致卸载删不掉
const waitUntil = Date.now() + 30_000;
while (Date.now() < waitUntil) {
  const alive = SERVICES.some((s) => {
    const r = run('sc', ['query', s]);
    return r.status === 0 && /RUNNING/.test(r.stdout || '');
  });
  if (!alive) break;
  spawnSync('ping', ['-n', '2', '127.0.0.1'], { windowsHide: true });
}

for (const svc of SERVICES) {
  if (fs.existsSync(NSSM)) {
    run(NSSM, ['remove', svc, 'confirm']);
  } else {
    run('sc', ['delete', svc]);
  }
}

if (process.argv.includes('--purge-data') && fs.existsSync(PGDATA)) {
  try {
    fs.rmSync(PGDATA, { recursive: true, force: true });
    console.log('已删除数据目录 pgdata');
  } catch (e) {
    console.log('删除数据目录失败（可手动删除）：' + e.message);
  }
} else {
  console.log('已保留数据目录 pgdata');
}
