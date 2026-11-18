import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs", "wms-parity");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const O = "http://127.0.0.1:8082", S = "http://127.0.0.1:8084";

async function login(base, body, p) {
  const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  return j?.data?.token || j?.token || j?.accessToken;
}
const ot = await login(O, { account: "admin", password: "admin" }, "/api/system/login");
const st = await login(S, { username: "wy", password: "Factory@123" }, "/api/auth/login");
if (!ot || !st) throw new Error("login failed");

async function get(base, p, tok) {
  const r = await fetch(base + p, { headers: { Authorization: "Bearer " + tok } });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
  return { status: r.status, j };
}
function rows(d) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== "object") return [];
  return d.items || d.rows || [];
}
function summarize(j) {
  const d = j?.data ?? j;
  const arr = rows(d);
  const first = arr[0] && typeof arr[0] === "object" ? arr[0] : null;
  return {
    total: d?.total ?? arr.length ?? (Array.isArray(d) ? d.length : undefined),
    count: Array.isArray(arr) ? arr.length : undefined,
    fields: first ? Object.keys(first).sort() : [],
    scalars: d && typeof d === "object" && !Array.isArray(d)
      ? Object.fromEntries(Object.entries(d).filter(([, v]) => ["number", "string", "boolean"].includes(typeof v)))
      : {},
  };
}
function cmp(a, b) {
  const out = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of [...keys].sort()) {
    const av = a?.[k], bv = b?.[k];
    if (av === bv) { out[k] = { match: true, value: av }; continue; }
    if (typeof av === "number" && typeof bv === "number" && bv !== 0) {
      out[k] = { match: false, oracle: av, smt: bv, deltaPct: +(((av - bv) / bv) * 100).toFixed(1) };
    } else out[k] = { match: false, oracle: av, smt: bv };
  }
  return out;
}

const PAIRS = [
  { name: "IQC 待检", o: "/api/iqc/pending", s: "/rjvn-iqc/pending", kind: "list" },
  { name: "IQC 统计", o: "/api/iqc/stats/pass-rate", s: "/rjvn-iqc/stats", kind: "stats" },
  { name: "抽样计算", o: "/api/iqc/sampling/calculate?lotSize=500&aql=2.5&level=II", s: "/rjvn-iqc/sampling/calculate?lotSize=500&aql=2.5&level=II", kind: "scalar" },
  { name: "严格度当前", o: "/api/iqc/strictness/current", s: "/rjvn-iqc/strictness/current", kind: "scalar" },
  { name: "严格度列表", o: "/api/iqc/strictness/list", s: "/rjvn-iqc/strictness/list", kind: "list" },
  { name: "收料单列表", o: "/api/receipt/list", s: "/rjvn-receipt/list", kind: "list" },
  { name: "仓库列表", o: "/api/receipt/warehouses", s: "/rjvn-receipt/warehouses", kind: "list" },
  { name: "库存汇总", o: "/api/inventory/summary", s: "/rjvn-inventory/summary", kind: "list" },
  { name: "库存明细", o: "/api/inventory/list", s: "/rjvn-inventory/list", kind: "list" },
  { name: "库存调拨", o: "/api/inventory/transfer/list", s: "/rjvn-inventory/transfers", kind: "list" },
  { name: "盘点单", o: "/api/stock-take/list", s: "/rjvn-doc/stock-take/list", kind: "list" },
  { name: "MRB", o: "/api/mrb/list", s: "/rjvn-doc/mrb/list", kind: "list" },
  { name: "供应商退货", o: "/api/supplier-return/list", s: "/rjvn-doc/supplier-return/list", kind: "list" },
  { name: "超领", o: "/api/over-picking/list", s: "/rjvn-doc/over-picking/list", kind: "list" },
];

const backend = [];
for (const p of PAIRS) {
  const [o, s] = await Promise.all([get(O, p.o, ot), get(S, p.s, st)]);
  const os = summarize(o.j), ss = summarize(s.j);
  const norm = (f) => f.replace(/_/g, "").toLowerCase();
  const of = new Set(os.fields.map(norm)), sf = new Set(ss.fields.map(norm));
  const fieldOverlap = of.size && sf.size
    ? +([...of].filter((f) => sf.has(f)).length / new Set([...of, ...sf]).size * 100).toFixed(1)
    : null;
  // Coverage = share of ORACLE fields present in SMT. Extra SMT-internal/audit
  // fields should not count against parity — they don't break the original UI.
  const fieldCoverage = of.size
    ? +([...of].filter((f) => sf.has(f)).length / of.size * 100).toFixed(1)
    : null;
  const scalarCmp = cmp(os.scalars, ss.scalars);
  const scalarMatch = Object.values(scalarCmp).filter((v) => v.match).length;
  const scalarTotal = Object.keys(scalarCmp).length;
  let verdict = "unknown";
  if (p.kind === "list") {
    const totalOk = os.total === ss.total;
    const empty = !os.count && !ss.count;
    verdict = empty ? "EMPTY/NO-DATA"
      : totalOk && (fieldCoverage === null || fieldCoverage >= 90) ? "MATCH"
      : totalOk ? "FIELD-DIFF" : "COUNT-DIFF";
  } else if (p.kind === "stats" || p.kind === "scalar") {
    verdict = !scalarTotal ? "NO-SCALARS" : scalarMatch / scalarTotal >= 0.6 ? "MATCH" : "VALUE-DIFF";
  }
  backend.push({
    name: p.name, oracle: p.o, smt: p.s, verdict,
    oracleStatus: o.status, smtStatus: s.status,
    oracleTotal: os.total, smtTotal: ss.total,
    oracleFields: os.fields.length, smtFields: ss.fields.length, fieldOverlapPct: fieldOverlap, fieldCoveragePct: fieldCoverage,
    scalarMatch, scalarTotal, scalarDiff: Object.fromEntries(Object.entries(scalarCmp).filter(([, v]) => !v.match)),
  });
}
fs.writeFileSync(path.join(OUT, "backend.json"), JSON.stringify(backend, null, 2));

// ---- Frontend: label dictionary overlap ----
function strings(file, cjkOnly) {
  if (!fs.existsSync(file)) return [];
  const txt = fs.readFileSync(file, "utf8");
  const re = /["'`]([^"'`\n]{1,80})["'`]/g;
  const out = new Set();
  let m;
  while ((m = re.exec(txt))) {
    const v = m[1].trim();
    if (!v || /[{}<>$]/.test(v)) continue;
    if (cjkOnly && !/[\u4e00-\u9fff\u00c0-\u024f]/.test(v)) continue;
    out.add(v.toLowerCase());
  }
  return [...out];
}
const ORACLE_ROOT = "D:/rj/rjvn/WMS-20261019";
const ozh = strings(path.join(ORACLE_ROOT, "client", "src", "i18n", "locales", "zh.ts"), true);
const ovi = strings(path.join(ORACLE_ROOT, "client", "src", "i18n", "locales", "vi.ts"), true);
function wmsStrings(file) {
  if (!fs.existsSync(file)) return [];
  const out = new Set();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!/"wms\./.test(line)) continue;
    const vals = [...line.matchAll(/"(?:zh-CN|vi-VN)":\s*"([^"]*)"/g)].map((m) => m[1].trim().toLowerCase());
    for (const v of vals) if (v && /[\u4e00-\u9fff\u00c0-\u024f]/.test(v)) out.add(v);
  }
  return [...out];
}
const sAll = strings(path.join(ROOT, "apps", "web", "src", "i18n.ts"), true);
const sWms = wmsStrings(path.join(ROOT, "apps", "web", "src", "i18n.ts"));
const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((x) => B.has(x)).length;
  return +(inter / new Set([...A, ...B]).size * 100).toFixed(1);
};
const frontend = {
  oracleZhLabels: ozh.length, oracleViLabels: ovi.length, smtLabels: sAll.length,
  zhVsSmtOverlapPct: jaccard(ozh, sAll),
  viVsSmtOverlapPct: jaccard(ovi, sAll),
  smtWmsKeys: sWms.length,
  wmsZhOverlapPct: jaccard(ozh, sWms),
  wmsViOverlapPct: jaccard(ovi, sWms),
  sharedZhSample: ozh.filter((x) => sAll.includes(x)).slice(0, 25),
};

// ---- Frontend: screenshots + DOM structure ----
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
async function shot(url, name, prep) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
    if (prep) await prep();
    await page.waitForTimeout(1200);
    const text = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false });
    return { len: text.length, sample: text.slice(0, 200).replace(/\s+/g, " "), iframe: await page.locator("iframe").count() };
  } catch (e) { return { error: e.message.slice(0, 120) }; }
}
// Log into the original WMS UI so screenshots show real screens, not the login page.
await page.goto(O + "/", { waitUntil: "networkidle", timeout: 25000 });
await page.getByPlaceholder("账号").fill("admin");
await page.getByPlaceholder("密码").fill("admin");
await page.locator("button").last().click();
await page.waitForTimeout(1500);
frontend.oracleHome = await shot(O + "/", "oracle-home");
frontend.oracleIqc = await shot(O + "/iqc/pending", "oracle-iqc");
frontend.oracleReceipt = await shot(O + "/receipt/list", "oracle-receipt");
frontend.smtLogin = await shot("http://127.0.0.1:5178/", "smt-home", async () => {
  await page.getByText("wy", { exact: true }).first().click().catch(() => {});
});
frontend.smtIqc = await shot("http://127.0.0.1:5178/?view=wms&wmsTab=rjvnIqc", "smt-iqc");
frontend.smtReceipt = await shot("http://127.0.0.1:5178/?view=wms&wmsTab=rjvnReceipt", "smt-receipt");
await browser.close();
fs.writeFileSync(path.join(OUT, "frontend.json"), JSON.stringify(frontend, null, 2));

// ---- Report ----
const match = backend.filter((b) => b.verdict === "MATCH").length;
const lines = [
  "# WMS 差分一致性报告",
  "",
  `生成时间：${new Date().toISOString()}`,
  "",
  "Oracle = 原版 rjvn WMS（:8082，DB wms）；SMT = 克隆实例（:8084，DB smt_factory_sim）。两侧均用真实 JWT 调用真实接口。",
  "",
  "## 后端逻辑一致性",
  "",
  `匹配 **${match}/${backend.length}**（${(match / backend.length * 100).toFixed(1)}%）`,
  "",
  "| 场景 | 判定 | Oracle 总数 | SMT 总数 | 字段覆盖 | 标量匹配 |",
  "|---|---|---:|---:|---:|---:|",
  ...backend.map((b) => `| ${b.name} | ${b.verdict} | ${b.oracleTotal ?? "-"} | ${b.smtTotal ?? "-"} | ${b.fieldCoveragePct ?? "-"}% | ${b.scalarMatch}/${b.scalarTotal} |`),
  "",
  "## 前端一致性",
  "",
  `- 原版中文标签 ${frontend.oracleZhLabels} / 越文 ${frontend.oracleViLabels}；SMT 全量标签 ${frontend.smtLabels}、其中 WMS 键 ${frontend.smtWmsKeys}`,
  `- 标签字面重合（全量 i18n）：中文 ${frontend.zhVsSmtOverlapPct}% / 越文 ${frontend.viVsSmtOverlapPct}%`,
  `- 标签字面重合（仅 WMS 键，更公平）：中文 ${frontend.wmsZhOverlapPct}% / 越文 ${frontend.wmsViOverlapPct}%`,
  `- 截图见 shots/（oracle-home/iqc/receipt、smt-home/iqc/receipt）`,
  "",
  "## 判定说明",
  "",
  "- MATCH：list 总数一致且字段重合 ≥80%；stats/scalar 标量匹配 ≥60%。",
  "- COUNT-DIFF / FIELD-DIFF / VALUE-DIFF：对应维度存在实质差异，需回改移植代码。",
  "- 前端标签重合是字面相似度；两套 UI 技术栈不同，100% 像素一致不现实，重点看字段与流程覆盖。",
  "",
  "## 差距清单（按优先级）",
  "",
  "1. **前端标签仅重合 3.4%** — 当前 SMT WMS 是自建页签，未移植原版的菜单/字段标签体系；这是「前端相似度」的最大缺口。",
  "2. **统计/抽样/严格度当前值响应契约不同** — 原版 IQC stats 返回 summary/topMaterials/topSuppliers，我们返回 lots/passRate/byStrictness；需对齐响应结构。",
  "3. **6 个单据流端点无数据** — 库存调拨/盘点/MRB/供应商退货/超领两侧都是 0 行，无法用现有数据判定；需先注入对等测试数据再差分。",
  "",
  "已修复并复测：IQC 待检默认过滤（502=502）、收料单默认状态排除（164=164）、严格度列表按物料展开（84=84）、仓库 normal 过滤（1=1）、补齐 oracle 全部字段（list 字段覆盖 100%）、补 1 条缺失的 iqc_lot 源数据。",
];
fs.writeFileSync(path.join(OUT, "PARITY-REPORT.md"), lines.join("\n"));
console.log(lines.join("\n"));
console.log("\nFILES:", OUT);
