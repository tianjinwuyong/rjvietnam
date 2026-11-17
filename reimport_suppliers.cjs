// Reimport suppliers from the cleaned Excel into WMS via /wms/suppliers/import-replace
// - Deduplicates by code (keeps first occurrence)
// - Normalizes A.997 / A.991 brackets to full-width for consistency
// - Endpoint does UPDATE + INSERT + soft-delete (status='inactive') atomically

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const jwt = require("jsonwebtoken");

const SOURCE_FILE = "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\dc\\bruce\\供应商明细.xlsx";
const API_BASE = "http://127.0.0.1:8080";

function loadEnvSecret() {
  const env = fs.readFileSync(".env", "utf8");
  return env.match(/JWT_SECRET=(.+)/)[1].trim();
}

async function login(username, password) {
  const r = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login failed ${r.status}: ${JSON.stringify(j)}`);
  const t = j.data?.token || j.token;
  if (!t) throw new Error(`login returned no token: ${JSON.stringify(j)}`);
  return t;
}

function cleanName(name) {
  // Normalize mixed-width parens to full-width for consistency.
  // Source-of-truth is the Excel; DB will be updated to match.
  return name
    .replace(/\(\s*([^\)]+?)\s*\)/g, "（$1）") // half-width ( ... ) → full-width （ ... ）
    .replace(/\s+/g, "") // collapse whitespace to match existing DB convention
    .trim();
}

function readSuppliersFromExcel() {
  const wb = XLSX.readFile(SOURCE_FILE);
  const sheet = wb.Sheets.Sheet2 ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }).slice(1);
  const incoming = new Map(); // code -> {code, nameZh, firstRow}
  let sourceRows = 0;
  const skipped = { empty: 0, halfOnlyCode: 0, halfOnlyName: 0 };
  for (let i = 0; i < rows.length; i++) {
    const rawCode = String(rows[i][0] ?? "").trim();
    const rawName = String(rows[i][1] ?? "").trim();
    if (!rawCode && !rawName) { skipped.empty++; continue; }
    if (!rawCode) { skipped.halfOnlyCode++; continue; }
    if (!rawName) { skipped.halfOnlyName++; continue; }
    sourceRows += 1;
    const code = rawCode.toUpperCase();
    const nameZh = cleanName(rawName);
    if (!incoming.has(code)) incoming.set(code, { code, nameZh, firstRow: i + 2 });
  }
  const suppliers = [...incoming.values()].map(({ code, nameZh }) => ({ code, nameZh }));
  return { suppliers, sourceRows, skipped };
}

(async () => {
  console.log("[1/4] reading Excel…");
  const { suppliers, sourceRows, skipped } = readSuppliersFromExcel();
  console.log(`    raw data rows: ${sourceRows + skipped.empty + skipped.halfOnlyCode + skipped.halfOnlyName}`);
  console.log(`    empty rows skipped: ${skipped.empty}`);
  console.log(`    half-only rows skipped (no code or no name): ${skipped.halfOnlyCode + skipped.halfOnlyName}`);
  console.log(`    valid rows counted by import: ${sourceRows}`);
  console.log(`    unique suppliers (dedup by code): ${suppliers.length}`);
  console.log(`    duplicates merged: ${sourceRows - suppliers.length}`);

  console.log("\n[2/4] login as admin (wms.execute required)…");
  const token = await login("admin", "Factory@123");
  console.log("    token len:", token.length);

  const sourceModifiedAt = fs.statSync(SOURCE_FILE).mtime.toISOString();
  const body = {
    sourceFile: path.basename(SOURCE_FILE),
    sourceModifiedAt,
    sourceRows,
    duplicateRows: sourceRows - suppliers.length,
    rows: suppliers,
  };
  console.log("\n[3/4] POST /wms/suppliers/import-replace …");
  const r = await fetch(`${API_BASE}/wms/suppliers/import-replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log("    HTTP", r.status);
  console.log("    response:", JSON.stringify(j, null, 2));
  if (!r.ok) throw new Error(`import failed: ${JSON.stringify(j)}`);

  console.log("\n[4/4] verifying…");
  const { Pool } = require("pg");
  const p = new Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "smt_factory" });
  const cnt = await p.query("SELECT status, COUNT(*) AS n FROM suppliers GROUP BY status");
  console.log("    suppliers by status:", cnt.rows);
  const a997 = await p.query("SELECT code, name_zh FROM suppliers WHERE code='A.997'");
  const a991 = await p.query("SELECT code, name_zh FROM suppliers WHERE code='A.991'");
  console.log("    A.997 name_zh:", a997.rows[0]?.name_zh);
  console.log("    A.991 name_zh:", a991.rows[0]?.name_zh);
  await p.end();

  console.log("\nDONE.");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});