/**
 * 打印代理（源 tools/print_agent.py —— 托盘小程序，BarTender 通过 COM 打标）
 *
 * 旧代理用 win32com 驱动 BarTender；Node 没有等价的 COM 绑定，所以这里改成「命令模板」：
 * 把任务 payload 落成 JSON，再执行现场配置的命令。BarTender 命令行（bartend.exe /F=… /D=… /P）、
 * ZPL 驱动、或其它贴标程序的 CLI 都能接，只要写进 --cmd。
 *
 * 用法（在装有打印机的那台机器上跑）：
 *   node services/api/print-agent.mjs --url http://<mes-host>:8080 --token <JWT> \
 *        --mode cmd --printer "Godex-01" --tpl-dir "D:/btw" \
 *        --cmd "\"C:/Program Files/Seagull/BarTender Suite/bartend.exe\" /F=\"{file}\" /D=\"{printer}\" /P"
 *   node ... --mode none            # 演练：只回执「已打印」，不碰打印机
 *   node ... --once                 # 跑一轮就退出（部署自检）
 *
 * 命令占位符：{file} {printer} {job_no} {tpl} {box} {payload}
 * 心跳会把本机状态（打印机名、模式、模板目录是否可读、btw 清单）回写给服务端参数 print.agent_*。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, def = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};

const URL_BASE = arg("url", process.env.MES_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const TOKEN = arg("token", process.env.MES_TOKEN || "");
const ONCE = argv.includes("--once");
const POLL_MS = Number(arg("interval", "3000")) || 3000;
const cfg = {
  mode: arg("mode", "none").toLowerCase(),
  printer: arg("printer", ""),
  cmd: arg("cmd", ""),
  bartender: arg("bartender", ""),
  tplDir: arg("tpl-dir", ""),
  tplExt: arg("tpl-ext", ".btw"),
};

if (!TOKEN) {
  console.error("缺少 --token（用有 prod.pack 权限的账号登录取 JWT）");
  process.exit(2);
}

const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
let lastMsg = "";

async function api(p, init = {}) {
  const r = await fetch(`${URL_BASE}/api/mesrj${p}`, { ...init, headers });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch { /* 非 JSON 时用原文报错 */ }
  if (!r.ok || j?.success === false) throw new Error(j?.msg || txt.slice(0, 200));
  return j?.data;
}

function fill(tpl, vars) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function listTplFiles() {
  if (!cfg.tplDir || !fs.existsSync(cfg.tplDir)) return [];
  return fs.readdirSync(cfg.tplDir)
    .filter(f => f.toLowerCase().endsWith(cfg.tplExt))
    .slice(0, 300)
    .map(f => {
      const st = fs.statSync(path.join(cfg.tplDir, f));
      return { name: f, sub: "", size: st.size, mtime: st.mtime.toISOString().slice(0, 19).replace("T", " ") };
    });
}

function run(cmdLine) {
  return new Promise(resolve => {
    const child = spawn(cmdLine, [], { shell: true, windowsHide: true });
    let out = "";
    child.stdout.on("data", d => { out += d.toString(); });
    child.stderr.on("data", d => { out += d.toString(); });
    child.on("error", e => resolve([false, e.message]));
    child.on("close", code => resolve([code === 0,
      `exit ${code}: ${out.trim().slice(0, 280)}`]));
  });
}

async function printJob(job) {
  const tplFile = cfg.tplDir ? path.join(cfg.tplDir, `${job.tpl_code || ""}${cfg.tplExt}`) : "";
  const file = tplFile && fs.existsSync(tplFile) ? tplFile : "";
  const tmpDir = path.join(os.tmpdir(), "mes-print");
  fs.mkdirSync(tmpDir, { recursive: true });
  const payloadFile = path.join(tmpDir, `${job.job_no}.json`);
  fs.writeFileSync(payloadFile, JSON.stringify(job.payload ?? {}, null, 2));

  if (cfg.mode === "none") return [true, "演练模式（未真正打印）"];
  if (file && !fs.existsSync(file)) {
    return [false, `模板不存在：${file}（检查 --tpl-dir / cfg_print_tpl.file_name）`];
  }
  const cmdLine = cfg.cmd || (cfg.bartender && file
    ? `"${cfg.bartender}" /F="${file}" /D="${cfg.printer}" /P`
    : "");
  if (!cmdLine) return [false, "未配置打印命令（--cmd 或 --bartender）"];
  return run(fill(cmdLine, {
    file, printer: cfg.printer, job_no: job.job_no || "",
    tpl: job.tpl_code || "", box: job.box_no || "", payload: payloadFile,
  }));
}

async function loop() {
  let printed = 0, failed = 0;
  try {
    const jobs = await api(`/pack/jobs?status=${encodeURIComponent("待打印")}&limit=20`);
    for (const job of Array.isArray(jobs) ? jobs : []) {
      const [ok, msg] = await printJob(job);
      lastMsg = `${new Date().toISOString().slice(11, 19)} ${job.job_no} ${ok ? "OK" : "FAIL"} ${msg}`;
      await api(`/pack/jobs/${encodeURIComponent(job.job_no)}/done`, {
        method: "POST", body: JSON.stringify({ ok, msg: msg.slice(0, 200) }),
      }).catch(e => console.log(`[打印代理] 回执失败 ${job.job_no}: ${e.message}`));
      if (ok) printed += 1; else failed += 1;
      console.log(`[打印代理] ${job.job_no} ${ok ? "已打印" : `失败：${msg}`}`);
    }
  } catch (e) {
    lastMsg = `${new Date().toISOString().slice(11, 19)} 轮询失败 ${e.message}`;
  }
  await api("/pack/agent/ping", {
    method: "POST",
    body: JSON.stringify({
      printer: cfg.printer,
      mode: cfg.mode === "none" ? "zpl" : cfg.mode,
      printer_ok: failed === 0,
      printer_msg: lastMsg,
      bartender: cfg.bartender,
      tpl_dir: cfg.tplDir,
      tpl_files: listTplFiles(),
    }),
  }).catch(e => console.log(`[打印代理] 心跳失败 ${e.message}`));
  return { printed, failed };
}

console.log(`[打印代理] 启动 → ${URL_BASE}（模式 ${cfg.mode}，${ONCE ? "单次" : `每 ${POLL_MS}ms`}）`);
await loop();
if (!ONCE) setInterval(loop, POLL_MS);
