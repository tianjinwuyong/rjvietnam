/**
 * 生成 20261026 改动的回滚副本（集成中枢三项：告警 / 对账 / MES 连接器）
 * ------------------------------------------------------------
 * 本机不是 git 仓库，改动是原地编辑的，所以用「反向补丁」现造一份改动前的文件：
 * 把本次新增的代码块精确切掉，得到 .pre 文件。
 *
 * 产出目录：D:\Program Files\OA\backup-20261026\
 *   routes-integration.js.pre      → 覆盖回 app/server/src/routes/integration.js
 *   services-cron.js.pre           → 覆盖回 app/server/src/services/cron.js
 *   services-wms-iqc-pull.js.pre   → 覆盖回 app/server/src/services/wms-iqc-pull.js
 *   integration-console.html.pre   → 覆盖回 app/web/dist/integration-console.html
 *
 * 每个 .pre 都会做 node --check，保证语法自洽。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OA = 'D:/Program Files/OA';
const OUT = path.join(OA, 'backup-20261026');
fs.mkdirSync(OUT, { recursive: true });

const read = (p) => fs.readFileSync(p, 'utf8');

function cutOnce(src, needle, label) {
  const n = src.split(needle).length - 1;
  if (n !== 1) throw new Error(`[${label}] 期望出现 1 次，实际 ${n} 次`);
  return src.replace(needle, '');
}

function check(file, label) {
  // node --check 只认 .js/.mjs 后缀，.pre 会报 ERR_UNKNOWN_FILE_EXTENSION → 临时改名再查
  const tmp = `${file}.check.mjs`;
  fs.copyFileSync(file, tmp);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`  ✔ ${label} 语法自洽`);
  } finally {
    fs.unlinkSync(tmp);
  }
}

/* ---------- 1. routes/integration.js ---------- */
{
  let out = read(path.join(OA, 'app/server/src/routes/integration.js'));
  for (const line of [
    "import { listAlerts, ackAlert, scanIntegrationAlerts } from '../services/integration-alert.js';\n",
    "import { runIntegrationReconcile, listReconcileRuns, getReconcileRun } from '../services/integration-reconcile.js';\n",
    "import { getMesStatus, pingMes } from '../services/mes-connector.js';\n",
  ]) out = cutOnce(out, line, 'integration.js import');

  const i = out.indexOf('  /* ---------------- 告警 ---------------- */');
  if (i < 0) throw new Error('找不到告警代码块起点');
  if (!out.trimEnd().endsWith('}')) throw new Error('integration.js 结尾不是 }');
  out = out.slice(0, i) + '}\n';

  const f = path.join(OUT, 'routes-integration.js.pre');
  fs.writeFileSync(f, out, 'utf8');
  check(f, 'routes/integration.js.pre');
}

/* ---------- 2. services/cron.js ---------- */
{
  let out = read(path.join(OA, 'app/server/src/services/cron.js'));
  out = cutOnce(out, "import { scanIntegrationAlerts } from './integration-alert.js';\n", 'cron import 1');
  out = cutOnce(out, "import { runIntegrationReconcile } from './integration-reconcile.js';\n", 'cron import 2');

  const a = out.indexOf('/* ---------------- 集成中枢：告警扫描 / 对账 ---------------- */');
  const b = out.indexOf('export function startCron() {');
  if (a < 0 || b < 0 || b <= a) throw new Error('cron.js wrapper 区块定位失败');
  out = out.slice(0, a) + out.slice(b);

  out = cutOnce(
    out,
    "  // 集成中枢：告警扫描 5 分钟一轮、对账 6 小时一轮（用户 2026-10-26 补齐）\n" +
    "  schedule(runIntegrationAlertScan, 5, '集成告警扫描');\n" +
    "  schedule(runIntegrationReconcileCron, 360, '集成对账');\n",
    'cron schedule'
  );

  const f = path.join(OUT, 'services-cron.js.pre');
  fs.writeFileSync(f, out, 'utf8');
  check(f, 'services/cron.js.pre');
}

/* ---------- 3. services/wms-iqc-pull.js ---------- */
{
  const src = read(path.join(OA, 'app/server/src/services/wms-iqc-pull.js'));
  const out = src.replace(
    '/** 供对账等只读场景复用（不写库）：带 token 缓存、401 自动重登一次 */\nexport async function apiGet(cfg, path, params = {}) {',
    'async function apiGet(cfg, path, params = {}) {'
  );
  if (out === src) throw new Error('wms-iqc-pull.js 未发生替换');
  const f = path.join(OUT, 'services-wms-iqc-pull.js.pre');
  fs.writeFileSync(f, out, 'utf8');
  check(f, 'services/wms-iqc-pull.js.pre');
}

/* ---------- 4. 控制台页面 ---------- */
{
  const bak = path.join(OA, 'app/web/dist/integration-console.html.bak-alert-20261026');
  if (!fs.existsSync(bak)) throw new Error('缺少控制台备份 .bak-alert-20261026');
  fs.copyFileSync(bak, path.join(OUT, 'integration-console.html.pre'));
  console.log('  ✔ integration-console.html.pre（取自 .bak-alert-20261026）');
}

console.log(`\n回滚副本已生成：${OUT}`);
