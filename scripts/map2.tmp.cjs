const XLSX = require("xlsx");
const fs = require("fs");
const dir = "C:\\Users\\tianj\\Desktop\\\u8d8a\u5357\u5de5\u5382\u745e\u6676\\dc\\bruce";
const files = fs.readdirSync(dir);
const supFile = files.find(n => n === "\u4f9b\u5e94\u5546\u660e\u7ec6.xlsx");
const wb = XLSX.readFile(dir + "\\" + supFile);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
const sups = [];
for (let i = 1; i < rows.length; i++) {
  const code = String(rows[i][0] || "").trim();
  const name = String(rows[i][1] || "").trim();
  if (code && name) sups.push({ code, name });
}
// BOM makers
const bomDir = "C:\\Users\\tianj\\Desktop\\\u8d8a\u5357\u5de5\u5382\u745e\u6676\\dc\\my";
const bf = fs.readdirSync(bomDir).find(n => n.includes("EPS18R1G-36"));
const bwb = XLSX.readFile(bomDir + "\\" + bf);
const brows = XLSX.utils.sheet_to_json(bwb.Sheets["BOM"], { header: 1, defval: "" });
const makers = new Map();
for (let i = 4; i < brows.length; i++) {
  const r = brows[i];
  const code = String(r[1] || "").trim();
  const note = String(r[7] || "");
  const qty = Number(r[6] || 0);
  if (!code || !(qty > 0)) continue;
  if (note.includes("替代")) continue;
  if (code === "2.00.00.55.0006") continue;
  if (/^1\.\d/.test(code)) continue;
  const nm = String(r[3] || "");
  if (/^(装配|插件|贴片)/.test(nm) && !/^0\./.test(code)) continue;
  const maker = String(r[9] || "").trim().split("/")[0].trim() || "未知";
  const factoryCode = String(r[8] || "").trim();
  if (!makers.has(maker)) makers.set(maker, { code, factoryCode });
}
console.log("=== makers needing codes:", makers.size);
for (const [mk, info] of makers) {
  // try exact includes both ways
  const hits = sups.filter(s => s.name.includes(mk) || mk.includes(s.name.slice(0, 3)));
  console.log(JSON.stringify(mk), "|", JSON.stringify(info.factoryCode), "=>", hits.map(h => h.code + ":" + h.name.slice(0, 22)).join(" | ") || "NO MATCH");
}
