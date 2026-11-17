const XLSX = require("xlsx");
const wb = XLSX.readFile("C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\dc\\bruce\\供应商明细.xlsx");
const sheet = wb.Sheets.Sheet2 ?? wb.Sheets[wb.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

console.log("=== FILE INFO ===");
console.log("Sheet names:", wb.SheetNames);
console.log("Total rows (with header):", rawRows.length);
console.log("Header:", JSON.stringify(rawRows[0]));

const dataRows = rawRows.slice(1);
const data = [];
const issues = {
  emptyRows: [],
  missingCode: [],
  missingName: [],
  bothMissing: [],
  duplicateCodes: new Map(),
  duplicateNames: new Map(),
  malformedCodes: [],
  shortCodes: [],
  wsIssues: [],
  encodingGlitches: [],
};

for (let i = 0; i < dataRows.length; i++) {
  const code = String(dataRows[i][0] ?? "").trim();
  const name = String(dataRows[i][1] ?? "").trim();
  const rowNum = i + 2;
  if (!code && !name) { issues.emptyRows.push(rowNum); continue; }
  if (!code) { issues.missingCode.push({ row: rowNum, name }); continue; }
  if (!name) { issues.missingName.push({ row: rowNum, code }); continue; }
  data.push({ row: rowNum, code, name });
  // format: single letter A-H + dot + 1-4 digits
  if (!/^[A-H]\.\d{1,4}$/.test(code)) issues.malformedCodes.push({ row: rowNum, code, name });
  if (code.length <= 3) issues.shortCodes.push({ row: rowNum, code, name });
  if (name.includes("?") || /[\uFFFD]/.test(name)) issues.encodingGlitches.push({ row: rowNum, code, name });
  if (dataRows[i][0] !== code || dataRows[i][1] !== name) {
    issues.wsIssues.push({ row: rowNum, raw0: dataRows[i][0], raw1: dataRows[i][1], code, name });
  }
}

console.log("\n=== ROW COUNTS ===");
console.log("Header rows: 1");
console.log("Empty rows:", issues.emptyRows.length, "->", issues.emptyRows);
console.log("Valid data rows:", data.length);
console.log("Missing code:", issues.missingCode.length);
console.log("Missing name:", issues.missingName.length);

// duplicates
for (const { row, code, name } of data) {
  if (!issues.duplicateCodes.has(code)) issues.duplicateCodes.set(code, []);
  issues.duplicateCodes.get(code).push({ row, name });
  if (!issues.duplicateNames.has(name)) issues.duplicateNames.set(name, []);
  issues.duplicateNames.get(name).push({ row, code });
}

const dupCodes = [...issues.duplicateCodes.entries()].filter(([, v]) => v.length > 1);
console.log("\n=== DUPLICATE CODES ===");
console.log("Total codes:", issues.duplicateCodes.size, " Duplicates:", dupCodes.length);
dupCodes.forEach(([code, list]) => console.log(" ", code, "->", list));

const dupNames = [...issues.duplicateNames.entries()].filter(([, v]) => v.length > 1);
console.log("\n=== DUPLICATE NAMES (same name, different code) ===");
console.log("Total names:", issues.duplicateNames.size, " Duplicates:", dupNames.length);
dupNames.forEach(([name, list]) => console.log(" ", name, "<-", list));

console.log("\n=== MALFORMED CODES (should look like A.123) ===");
console.log("Count:", issues.malformedCodes.length);
issues.malformedCodes.slice(0, 20).forEach((x) => console.log(" row", x.row, ":", x.code, "=>", x.name));

console.log("\n=== SHORT CODES (<=3 chars) ===");
console.log("Count:", issues.shortCodes.length);
issues.shortCodes.slice(0, 10).forEach((x) => console.log(" row", x.row, ":", x.code, "=>", x.name));

console.log("\n=== WHITESPACE ISSUES (raw != trimmed) ===");
console.log("Count:", issues.wsIssues.length);
issues.wsIssues.slice(0, 10).forEach((x) => console.log(" row", x.row, ": raw=[", x.raw0, "][", x.raw1, "] clean=[", x.code, "][", x.name, "]"));

console.log("\n=== ENCODING GLITCHES ===");
console.log("Count:", issues.encodingGlitches.length);
issues.encodingGlitches.slice(0, 10).forEach((x) => console.log(" row", x.row, ":", x.code, "=>", x.name));

console.log("\n=== CODE PREFIX DISTRIBUTION ===");
const prefixes = {};
for (const { code } of data) {
  const p = code.charAt(0);
  prefixes[p] = (prefixes[p] || 0) + 1;
}
console.log(prefixes);

console.log("\n=== SAMPLE OF DUPLICATE-CODE PAIRS ===");
dupCodes.slice(0, 3).forEach(([code, list]) => {
  console.log(" code", code, ":");
  list.forEach((r) => console.log("  row", r.row, "name:", r.name));
});

const { Pool } = require("pg");
const pool = new Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "smt_factory" });
(async () => {
  const dbRows = await pool.query("SELECT code, name_zh FROM suppliers WHERE status='active'");
  console.log("\n=== DB CROSS-CHECK ===");
  console.log("DB suppliers (active):", dbRows.rows.length);
  const dbByCode = new Map(dbRows.rows.map((r) => [r.code, r.name_zh]));
  const excelByCode = new Map(data.map((r) => [r.code, r.name]));
  let mismatch = 0, onlyDb = 0, onlyExcel = 0, match = 0;
  const mismatches = [];
  for (const [code, name] of excelByCode) {
    const dbName = dbByCode.get(code);
    if (dbName === undefined) { onlyExcel++; continue; }
    if (dbName !== name) { mismatch++; if (mismatches.length < 5) mismatches.push({ code, excel: name, db: dbName }); }
    else match++;
  }
  for (const code of dbByCode.keys()) if (!excelByCode.has(code)) onlyDb++;
  console.log("Match:", match, " | Mismatch:", mismatch, " | Only DB:", onlyDb, " | Only Excel:", onlyExcel);
  console.log("Sample mismatches:");
  mismatches.forEach((m) => console.log(" ", m.code, "excel=", m.excel, "db=", m.db));
  await pool.end();
})().catch((e) => console.error("DB ERR:", e.message));