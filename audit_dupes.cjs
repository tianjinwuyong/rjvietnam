const XLSX = require("xlsx");

const SOURCE_FILE = "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\dc\\bruce\\供应商明细.xlsx";
const wb = XLSX.readFile(SOURCE_FILE);
const sheet = wb.Sheets.Sheet2 ?? wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }).slice(1);

function cleanName(name) {
  return name.replace(/\(\s*([^\)]+?)\s*\)/g, "（$1）").replace(/\s+/g, "").trim();
}

const map = new Map();
for (let i = 0; i < rows.length; i++) {
  const code = String(rows[i][0] ?? "").trim().toUpperCase();
  const name = String(rows[i][1] ?? "").trim();
  if (!code || !name) continue;
  if (!map.has(code)) map.set(code, []);
  map.get(code).push({ row: i + 2, raw: name, clean: cleanName(name) });
}

const dupes = [...map.entries()].filter(([, v]) => v.length > 1);
console.log(`Found ${dupes.length} duplicate code pairs\n`);
console.log("code | kept (row+raw) | dropped (row+raw) | same after normalize?");
console.log("-".repeat(100));
let identical = 0, differ = 0;
for (const [code, list] of dupes) {
  const kept = list[0];
  const dropped = list[list.length - 1];
  const sameClean = kept.clean === dropped.clean;
  const sameRaw = kept.raw === dropped.raw;
  if (sameClean) identical++; else differ++;
  console.log(
    `${code.padEnd(7)} | row ${String(kept.row).padEnd(4)} ${kept.raw.padEnd(30)} | row ${String(dropped.row).padEnd(4)} ${dropped.raw.padEnd(30)} | ${sameClean ? "SAME" : "DIFFER"} (raw=${sameRaw ? "same" : "diff"})`
  );
}
console.log("\nSummary:");
console.log("  identical after normalize:", identical);
console.log("  different after normalize:", differ);