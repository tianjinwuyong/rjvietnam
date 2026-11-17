const XLSX = require("xlsx");
const wb = XLSX.readFile("C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\dc\\bruce\\供应商明细.xlsx");
const sheet = wb.Sheets.Sheet2 ?? wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
console.log("headers:", rows[0]);
console.log("total data rows:", rows.length - 1);
const matches = [];
for (let i = 1; i < rows.length; i++) {
  const code = String(rows[i][0] ?? "").trim();
  const name = String(rows[i][1] ?? "").trim();
  if (name.includes("华锐") || name.includes("深圳")) matches.push({ row: i + 1, code, name });
}
console.log("\nrows with 华锐 or 深圳 in nameZh:");
matches.forEach((r) => console.log(" row", r.row, ":", r.code, "=>", r.name));