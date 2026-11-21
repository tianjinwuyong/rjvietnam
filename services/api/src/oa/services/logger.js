// 生产日志落盘：由本进程自持文件句柄、同步裸写入 server/logs/oa.log。
// 单文件超 10MB 即同步轮转为带 UTC 时间戳的历史文件，保留 5 份、目录总占用 ≤50MB。
// 落盘/轮转的任何失败都降级为「仅 stdout + stderr 告警」——服务绝不因写日志崩溃。
// 零运行时依赖：只用 Node 内置 fs/path/util。
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { config } from '../config/index.js';

const DIR = path.join(config.root, 'logs');           // server/logs/
const CUR = path.join(DIR, 'oa.log');                 // 当前文件
const MAX_BYTES = 10 * 1024 * 1024;                   // 单文件上限
const KEEP_HISTORY = 5;                               // 历史文件保留份数
const DIR_MAX_BYTES = 50 * 1024 * 1024;               // 日志目录总占用上限

let fd = null;            // 当前文件句柄；null 表示已降级（仅 stdout）
let bytes = 0;            // 当前文件已写字节数（写入侧尺寸判断用）
let degraded = false;
let consolePatched = false;

function size(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// 一律直写 stderr，不能走 console——否则会被下面的 console 补丁再次拉回 sink，形成回环
function markDegraded(msg) {
  if (!degraded) process.stderr.write(`[logger] 日志落盘降级，后续仅写 stdout：${msg}\n`);
  degraded = true;
  fd = null;
}

function archivePath() {
  // UTC 时间戳去掉分隔符；ISO 串本身字典序可排，便于 prune 按名判新旧
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  let name = `oa-${stamp}.log`;
  for (let i = 1; fs.existsSync(path.join(DIR, name)); i++) name = `oa-${stamp}-${i}.log`;
  return path.join(DIR, name);
}

/** 按「份数上限 + 目录总占用上限」滚动删除最旧的历史档；当前文件永不删。 */
export function prune() {
  let archives = fs.readdirSync(DIR)
    .filter(n => /^oa-.*\.log$/.test(n))
    .sort();                                          // 时间戳命名 ⇒ 字典序即时间序，最旧在前
  const remove = (n) => {
    try { fs.unlinkSync(path.join(DIR, n)); return true; }
    catch (err) { process.stderr.write(`[logger] 清理历史日志 ${n} 失败：${err.message}\n`); return false; }
  };

  // ① 份数上限：只保留最新 KEEP_HISTORY 份
  while (archives.length > KEEP_HISTORY) remove(archives.shift());

  // ② 目录总占用上限：连当前文件一起算，超限则从最旧历史档起删（上限独立于磁盘水位，长期有界）
  let total = size(CUR) + archives.reduce((s, n) => s + size(path.join(DIR, n)), 0);
  for (const n of archives) {
    if (total <= DIR_MAX_BYTES) break;
    const s = size(path.join(DIR, n));
    if (remove(n)) total -= s;
  }
}

/**
 * 同步轮转：closeSync → renameSync → prune → openSync('a')。
 * 全程同步 ⇒ 这三个动作之间不存在写入窗口，当前窗口的日志不会丢，也不会与并发 rename/reopen 竞态。
 * 任一步失败都保留原文件、不删不丢，最终必须把 fd 重建（重建不了才降级）。
 */
export function rotate() {
  if (fd === null) return false;
  const target = archivePath();
  try { fs.closeSync(fd); } catch (err) { process.stderr.write(`[logger] 关闭日志句柄失败：${err.message}\n`); }
  fd = null;

  let rotated = false;
  try {
    fs.renameSync(CUR, target);
    rotated = true;
    bytes = 0;
  } catch (err) {
    // rename 失败：原文件原地保留，随后重新打开继续追加，不丢日志
    process.stderr.write(`[logger] 归档日志失败，保留原文件继续追加：${err.message}\n`);
  }
  if (rotated) {
    try { prune(); } catch (err) { process.stderr.write(`[logger] 清理历史日志失败：${err.message}\n`); }
  }
  try { fd = fs.openSync(CUR, 'a'); bytes = size(CUR); }
  catch (err) { markDegraded(`日志文件不可写——${err.message}`); }
  return rotated;
}

/** 写入侧落盘。降级后静默跳过（stdout 由 fileDestination/console 原方法保证）。 */
export function sink(line) {
  if (fd === null) return;
  try {
    bytes += fs.writeSync(fd, line);
    if (bytes >= MAX_BYTES) rotate();
  } catch (err) {
    markDegraded(`写入日志失败——${err.message}`);
  }
}

/** 供 cron 每 10 分钟巡检：仅在当前文件确实超限时才轮转，返回是否真的轮转了。 */
export function rotateLogIfNeeded() {
  if (fd === null) return false;
  try {
    if (size(CUR) >= MAX_BYTES) return rotate();
  } catch (err) {
    process.stderr.write(`[logger] 检查日志大小失败：${err.message}\n`);
  }
  return false;
}

// Fastify 生产 logger 的 destination：每条 pino 日志先落盘、再透传 stdout（不再依赖外部重定向）
export const fileDestination = {
  write(line) {
    sink(line);
    process.stdout.write(line);
  },
  flushSync() {},
};

/** 仅 production 调用：开文件句柄并把 console.* tee 到 sink，让启动日志与 [cron] 日志一并落盘。 */
export function initFileLog() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fd = fs.openSync(CUR, 'a');                        // 追加写：进程重启不截断历史、不重复轮转
    bytes = size(CUR);
  } catch (err) {
    markDegraded(`初始化日志文件失败——${err.message}`);
  }

  if (!consolePatched) {
    consolePatched = true;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const orig = console[level].bind(console);
      console[level] = (...args) => { sink(util.format(...args) + '\n'); orig(...args); };
    }
  }
}
