/**
 * 镭雕机 SN 下发服务（TCP）—— 移植自 设备对接工具/镭雕机/laser_sn_server.py
 *
 * 镭雕机「文本元素 → 网络通讯」配 IP+端口+命令 `TCP:Give me string`；
 * 每要雕一片就连上来问一次，本服务回一个 SN，它就雕这个号（下发即记录，可追溯机台/时间）。
 *
 * 用法：
 *   node services/api/laser-sn-server.mjs               # 按 sys_param laser.sn_port（默认 1000）
 *   node services/api/laser-sn-server.mjs --port 1001
 *   node services/api/laser-sn-server.mjs --dry         # 演练：算号不写库、不递增
 *   node services/api/laser-sn-server.mjs --seq 14900   # 本次运行强制起始序列
 *
 * 现场要点（源文件注释里踩过的坑，原样保留）：
 *   · 连上后给客户端 laser.push_grace_ms（默认 1500）的宽限，兼容「先发命令再等」和「连上直接读」两种固件；
 *   · 先回包、后写日志：Windows 控制台被鼠标点进「选择」模式会让 print 挂起，设备端表现为没反应；
 *   · 配置缺失（没选工单 / 没配拼版）必须拒发并断开，不能回一个错号出去；
 *   · 超计划量（计划 × (1+laser.over_pct%)）拒发。
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { getParam } from "./src/db.js";
import laser from "./src/mesrj/laser.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(HERE, ".env") });

const argv = process.argv.slice(2);
const arg = (name, def = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const DRY = argv.includes("--dry");
const FORCED_SEQ = arg("seq", "") ? Number(arg("seq")) : null;
const LOG_PATH = path.join(HERE, "logs", "laser_sn.log");

function log(msg, echo = true) {
  const line = `${new Date().toISOString().slice(0, 19).replace("T", " ")} ${msg}`;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line + "\n", "utf-8");
  } catch { /* 日志写不进去也不能影响发号 */ }
  if (echo) { try { console.log(line); } catch { /* 控制台被点住 */ } }
}

/** 结尾符：|0d0a 回车换行 / |0a 换行 / |0 无（源 suffix_bytes） */
async function suffix() {
  const s = String(await getParam("laser.sn_suffix", "|0d0a")).trim().toLowerCase();
  if (s === "|0a") return "\n";
  if (s === "|0") return "";
  return "\r\n";
}

async function pushGraceMs() {
  const ms = Number(await getParam("laser.push_grace_ms", "1500")) || 0;
  return Math.min(10000, Math.max(50, ms || 1500));
}

let queue = Promise.resolve();

/** 取号串行化：同一进程里并发连上来也不会拿到同一个序列 */
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function handle(sock, remote) {
  const ip = String(remote || sock.remoteAddress || "").replace(/^::ffff:/, "");
  const t0 = Date.now();
  let req = "";
  try {
    sock.setTimeout(await pushGraceMs());
    req = await new Promise(resolve => {
      let buf = "";
      const done = v => { sock.removeAllListeners("data"); sock.removeAllListeners("timeout"); resolve(v); };
      sock.on("data", d => { buf += d.toString("utf-8"); done(buf); });
      sock.on("timeout", () => done(buf));
      sock.on("error", () => done(buf));
      sock.on("end", () => done(buf));
    });
    const tTake = Date.now();
    const out = await serial(() => laser.takeSn(ip, { dry: DRY, forceSeq: FORCED_SEQ }));
    // 先回包
    sock.write(String(out.sn) + (await suffix()));
    const tSend = Date.now();
    log(`[下发] ${ip} ← ${out.sn}${req ? `  请求:${req.slice(0, 40).replace(/[\r\n]/g, " ")}` : "  [连上即推]"}`
      + `（${DRY ? "演练" : "正式"}，${out.brief}，取号 ${tTake - t0}ms / 回包 ${tSend - tTake}ms）`, false);
  } catch (e) {
    log(`[拒绝发号] ${ip}：${e?.message || e}（耗时 ${Date.now() - t0}ms）`);
  } finally {
    setTimeout(() => sock.destroy(), 50);
  }
}

const port = Number(arg("port", "") || process.env.LASER_SN_PORT || await getParam("laser.sn_port", "1000")) || 1000;

const server = net.createServer(sock => handle(sock, sock.remoteAddress));
server.on("error", e => { log(`[服务异常] ${e.message}`); process.exitCode = 1; });
server.listen(port, "0.0.0.0", () => {
  log(`[启动] 镭雕发码服务监听 0.0.0.0:${port}${DRY ? "（演练模式：不写库、不递增）" : ""}`);
});

const stop = () => { log("[退出]"); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
