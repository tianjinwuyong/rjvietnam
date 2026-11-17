// Dedup 供应商明细.xlsx in place (with backup):
// - Removes 204 empty rows
// - Removes 25 duplicate-code rows (keeps first occurrence)
// - Result: 1 header + 365 unique data rows = 366 rows

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SOURCE_FILE = "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\dc\\bruce\\供应商明细.xlsx";
const BACKUP_FILE = "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\dc\\bruce\\供应商明细.backup.xlsx";

function backupOriginal() {
  fs.copyFileSync(SOURCE_FILE, BACKUP_FILE);
  console.log("[1/3] backup ->", BACKUP_FILE);
  console.log("    size:", fs.statSync(BACKUP_FILE).size, "bytes");
}

function dedupExcel() {
  const wb = XLSX.readFile(SOURCE_FILE);
  const sheetName = wb.SheetNames.includes("Sheet2") ? "Sheet2" : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const header = rows[0];
  const seen = new Set();
  const cleaned = [header];
  let emptyDropped = 0;
  let dupDropped = 0;
  const droppedLog = [];

  for (let i = 1; i < rows.length; i++) {
    const rawCode = String(rows[i][0] ?? "").trim();
    const rawName = String(rows[i][1] ?? "").trim();
    if (!rawCode && !rawName) { emptyDropped++; continue; }
    const normCode = rawCode.toUpperCase();
    if (seen.has(normCode)) { dupDropped++; droppedLog.push({ row: i + 1, code: rawCode, name: rawName }); continue; }
    seen.add(normCode);
    cleaned.push(rows[i]);
  }

  // Replace sheet contents with the cleaned data
  const newSheet = XLSX.utils.aoa_to_sheet(cleaned);
  wb.Sheets[sheetName] = newSheet;
  // Write to a sibling .xlsx with a different name — original may be locked by Excel
  const cleanedFile = SOURCE_FILE.replace(/\.xlsx$/i, ".deduped.xlsx");
  if (fs.existsSync(cleanedFile)) fs.unlinkSync(cleanedFile);
  XLSX.writeFile(wb, cleanedFile);
  console.log("    cleaned file written ->", cleanedFile);

  console.log("[2/3] dedup complete");
  console.log("    header kept:", JSON.stringify(header));
  console.log("    empty rows dropped:", emptyDropped);
  console.log("    duplicate rows dropped:", dupDropped);
  console.log("    final data rows:", cleaned.length - 1);
  if (droppedLog.length > 0) {
    console.log("\n    dropped (kept earlier occurrence):");
    droppedLog.forEach((d) => console.log(`      row ${d.row}: ${d.code} => ${d.name}`));
  }
}

function verify() {
  const cleanedFile = SOURCE_FILE.replace(/\.xlsx$/i, ".deduped.xlsx");
  const wb = XLSX.readFile(cleanedFile);
  const sheetName = wb.SheetNames.includes("Sheet2") ? "Sheet2" : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  console.log("\n[3/3] verify (cleaned file)");
  console.log("    file:", cleanedFile);
  console.log("    total rows (with header):", rows.length);
  console.log("    header:", JSON.stringify(rows[0]));
  let empty = 0, valid = 0, seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const c = String(rows[i][0] ?? "").trim();
    const n = String(rows[i][1] ?? "").trim();
    if (!c && !n) { empty++; continue; }
    valid++;
    seen.add(c.toUpperCase());
  }
  console.log("    empty rows:", empty);
  console.log("    valid rows:", valid);
  console.log("    unique codes:", seen.size);
  console.log("    duplicates:", valid - seen.size);
  console.log("\nDONE.");
}

backupOriginal();
dedupExcel();
verify();