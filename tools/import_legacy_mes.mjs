/**
 * 旧 MES（SQLite data/mes.db）→ 新系统（PostgreSQL）主数据导入
 *
 * 只导主数据与配置，不导历史（过站/SN/维修等由现场另行归档）：
 *   md_line md_station md_product md_material md_customer md_defect md_employee md_shift
 *   cfg_process cfg_capacity cfg_threshold cfg_sn_rule cfg_pcb_code
 *   cfg_bind_rule cfg_bind_station cfg_dwell_rule
 *
 * 用法：
 *   node tools/import_legacy_mes.mjs --from "D:/rj/repos/MES-ruijing/data/mes.db" --dry-run
 *   node tools/import_legacy_mes.mjs --from "<prod>/data/mes.db"
 *
 * 规则：
 *   · 列取交集（旧表多出来/新表新加的列各自忽略），空串转 NULL 由 PG 默认值兜底
 *   · 幂等：按业务键 WHERE NOT EXISTS 跳过已存在行，可重复执行
 *   · 先 --dry-run 看每张表会插入多少行，再真跑
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { query } from "../services/api/src/db.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(HERE, "../services/api/.env") });

const argv = process.argv.slice(2);
const arg = (name, def = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const FROM = arg("from", path.join(HERE, "../数据库备份/mes.db"));
const DRY = argv.includes("--dry-run");

/** 表 → 业务键（用来判重；没有唯一约束的表用这些列做 NOT EXISTS） */
const PLAN = [
  ["md_line", ["line_code"]],
  ["md_station", ["station_code"]],
  ["md_product", ["product_code"]],
  ["md_material", ["material_code"]],
  ["md_customer", ["cust_code"]],
  ["md_defect", ["defect_code"]],
  ["md_employee", ["emp_no"]],
  ["md_shift", ["shift_code"]],
  ["cfg_process", ["process_code"]],
  ["cfg_capacity", ["line_code", "product_code", "process"]],
  ["cfg_threshold", ["th_key"]],
  ["cfg_sn_rule", ["sn_type"]],
  ["cfg_pcb_code", ["pcb_code"]],
  ["cfg_bind_rule", ["station_code", "role"]],
  ["cfg_bind_station", ["station_code"]],
  ["cfg_dwell_rule", ["from_key", "to_key"]],
];

const castVal = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
};

const legacy = new DatabaseSync(FROM, { readOnly: true });
let total = 0;

for (const [table, keys] of PLAN) {
  const exists = legacy.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) { console.log(`- ${table.padEnd(18)} 旧库没有这张表，跳过`); continue; }
  const legacyRows = legacy.prepare(`SELECT * FROM "${table}"`).all();
  if (!legacyRows.length) { console.log(`- ${table.padEnd(18)} 旧库 0 行`); continue; }
  const pgCols = new Set((await query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [table])).rows
    .map(r => r.column_name));
  if (!pgCols.size) { console.log(`- ${table.padEnd(18)} 新库没有这张表，跳过`); continue; }
  const shared = Object.keys(legacyRows[0]).filter(c => pgCols.has(c));
  const missingKeys = keys.filter(k => !shared.includes(k));
  if (missingKeys.length) { console.log(`- ${table.padEnd(18)} 缺业务键列 ${missingKeys.join(",")}，跳过`); continue; }

  let inserted = 0, skipped = 0;
  for (const row of legacyRows) {
    const cols = shared.filter(c => row[c] !== undefined);
    const vals = cols.map(c => castVal(row[c]));
    const keyWhere = keys.map((k, i) => `${k} = $${i + 1}`).join(" AND ");
    const keyVals = keys.map(k => castVal(row[k]));
    const hit = (await query(
      `SELECT 1 FROM ${table} WHERE ${keyWhere} LIMIT 1`, keyVals)).rows[0];
    if (hit) { skipped += 1; continue; }
    if (DRY) { inserted += 1; continue; }
    try {
      await query(
        `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
        vals);
      inserted += 1;
    } catch (e) {
      console.log(`  ! ${table} ${keys.map(k => row[k]).join("/")}: ${e.message}`);
      skipped += 1;
    }
  }
  total += inserted;
  console.log(`- ${table.padEnd(18)} 旧 ${String(legacyRows.length).padStart(4)} 行 → `
    + `插入 ${String(inserted).padStart(4)}，已存在跳过 ${String(skipped).padStart(4)}`);
}

legacy.close();
console.log(`\n${DRY ? "[dry-run] 将插入" : "已插入"} ${total} 行`);
if (DRY) console.log("确认无误后去掉 --dry-run 再跑一次。");
