/**
 * MES 后台定时任务（源 run.py 的 daemon 线程）
 *
 * 源里这些活是 9 个 threading.Thread 挂在 Flask 进程里跑的；新架构不把定时逻辑塞进 API 进程，
 * 单独起一个进程（npm run scheduler），挂了不影响扫码过站。
 *
 * 移植范围：
 *   - 时效扫描   dwell.scan()            dwell.auto_enabled / dwell.scan_minutes / dwell.days
 *   - 物料预警   prd_alert 低库存         material.auto_enabled / material.scan_minutes / material.low_qty
 *   - 数据库备份 pg_dump + 保留 N 份       backup.enabled / backup.interval_hours / backup.keep / backup.dir
 * 未移植：AOI/SPI 同步（新架构由 services/aoi-api 独立服务承担）、WMS 同步（WMS 模块）、
 *         GKG CSV 扫描（保留 POST /mesrj/gkg/scan 手动导入）。
 *
 * 用法：
 *   node services/api/mesrj-scheduler.mjs            # 常驻
 *   MESRJ_SCHED_ONCE=1 node ...                      # 每个任务跑一遍就退出（部署自检/测试）
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { query, getParam } from "./src/db.js";
import * as dwell from "./src/mesrj/dwell.js";

// 与 server.js 同一份 .env（PostgreSQL 连接参数）
const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(HERE, ".env") });

const ONCE = process.env.MESRJ_SCHED_ONCE === "1";
const REPO = path.resolve(HERE, "../..");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const num = async (key, def) => {
  const v = Number(await getParam(key, String(def)));
  return Number.isFinite(v) && v > 0 ? v : def;
};
/** sys_param 的开关口径：'0'/'false'/'off' 视为关（源 util.get_param 同口径） */
async function disabled(key) {
  const v = String(await getParam(key, "1")).trim().toLowerCase();
  return v === "0" || v === "false" || v === "off";
}

// ── 时效扫描 ────────────────────────────────────────────────────────────────
let dwellLast = 0;
async function jobDwell() {
  if (await disabled("dwell.auto_enabled")) return;
  const every = (await num("dwell.scan_minutes", 60)) * 60000;
  if (!ONCE && Date.now() - dwellLast < every) return;
  dwellLast = Date.now();
  const days = await num("dwell.days", 7);
  const items = await dwell.scan(days, true);
  log(`[时效] 扫描完成：${items.length} 颗超期${items.length ? "（已写预警中心）" : ""}`);
}

// ── 物料低库存 ──────────────────────────────────────────────────────────────
let matLast = 0;
async function jobMaterial() {
  if (await disabled("material.auto_enabled")) return;
  const every = (await num("material.scan_minutes", 5)) * 60000;
  if (!ONCE && Date.now() - matLast < every) return;
  matLast = Date.now();
  const lowQty = Number(await getParam("material.low_qty", "0")) || 0;
  if (!(lowQty > 0)) {
    log("[物料] 未设 material.low_qty，跳过（可选：填一个全局低库存线）");
    return;
  }
  const rows = (await query(
    `SELECT material_code, material_name_zh, current_balance
       FROM v_report_material_balance
      WHERE current_balance < $1 ORDER BY current_balance ASC LIMIT 200`, [lowQty])).rows;
  let created = 0;
  for (const r of rows) {
    const key = `MATERIAL:LOW:${r.material_code}`;
    const dup = (await query(
      "SELECT id FROM prd_alert WHERE rule_key=$1 AND status='待处理' LIMIT 1", [key])).rows[0];
    if (dup) continue;
    await query(
      `INSERT INTO prd_alert (rule_key, rule_name, level, title, detail, ref_sn, station_code, status, created_at)
       VALUES ($1,'物料低库存','警告',$2,$3,'','','待处理',now())`,
      [key, `${r.material_code} 库存偏低`,
        `${r.material_name_zh || r.material_code} 当前结存 ${r.current_balance}，低于预警线 ${lowQty}`]);
    created += 1;
  }
  log(`[物料] 扫描完成：${rows.length} 个低于 ${lowQty}，新增预警 ${created}`);
}

// ── 数据库备份 ──────────────────────────────────────────────────────────────
function findPgDump() {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  for (const v of ["18", "17", "16", "15"]) {
    const p = `C:/Program Files/PostgreSQL/${v}/bin/pg_dump.exe`;
    if (fs.existsSync(p)) return p;
  }
  return "pg_dump";
}

// Windows 现场机器不一定有 gzip —— 用 pg_dump 自带的 -Fc（压缩自定义格式，pg_restore 直接读）。
let backupLast = 0;
async function jobBackup() {
  if (await disabled("backup.enabled")) return;
  const every = (await num("backup.interval_hours", 24)) * 3600000;
  if (!ONCE && Date.now() - backupLast < every) return;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const dir = String(await getParam("backup.dir", "")).trim() || path.join(REPO, "database", "backups");
  const keep = await num("backup.keep", 7);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `smt_factory_${stamp}.dump`);
  // prd_decode_log 是历史遗留的 postgres 属主表（app 角色无权限），pg_dump 连 LOCK 都拿不到，
  // 一只坏表能把整库备份搞失败 —— 显式排除，其它表照常。
  const args = ["-h", process.env.PGHOST || "127.0.0.1", "-p", process.env.PGPORT || "5432",
    "-U", process.env.PGUSER || "smt_factory", "-d", process.env.PGDATABASE || "smt_factory",
    "-Fc", "--no-owner", "--no-privileges", "--exclude-table=public.prd_decode_log", "-f", file];
  backupLast = Date.now();
  const res = await new Promise((resolve, reject) => {
    const dump = spawn(findPgDump(), args, { env: process.env, windowsHide: true });
    let err = "";
    dump.stderr.on("data", d => { err += d.toString(); });
    dump.on("error", reject);
    dump.on("close", c => resolve({ code: c, err }));
  });
  if (res.code !== 0 || !fs.existsSync(file) || fs.statSync(file).size < 1024) {
    const err = (res.err || "").trim().split("\n").slice(0, 3).join(" ");
    if (/权限不够|permission denied/i.test(err)) {
      log("[备份] 跳过：库里有 app 角色读不了的遗留对象。请让 DBA 用超级用户执行一次：");
      log("        ALTER TABLE public.prd_decode_log OWNER TO smt_factory;"
        + "  -- 或 DROP TABLE public.prd_decode_log（本系统用的是 mesrj_decode_log）");
    } else {
      log("[备份] 失败:", err || `退出码 ${res.code}`);
    }
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  log(`[备份] 完成 ${file}（${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB）`);
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("smt_factory_") && (f.endsWith(".dump") || f.endsWith(".sql.gz")))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    fs.unlinkSync(path.join(dir, f));
    log(`[备份] 清理旧备份 ${f}`);
  }
}

// ── 调度 ────────────────────────────────────────────────────────────────────
const jobs = [["时效", jobDwell, 60000], ["物料", jobMaterial, 60000], ["备份", jobBackup, 3600000]];
let stopping = false;

async function tick() {
  for (const [name, fn] of jobs) {
    try { await fn(); } catch (e) { log(`[${name}] 任务异常:`, e?.message || e); }
  }
}

log(`MES 定时任务启动（${ONCE ? "单次自检" : "常驻"}）`);
await tick();
if (!ONCE) {
  const timer = setInterval(async () => { if (!stopping) await tick().catch(() => {}); }, 60000);
  const stop = () => { stopping = true; clearInterval(timer); log("退出"); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
