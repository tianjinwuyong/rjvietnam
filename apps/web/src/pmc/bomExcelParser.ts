export interface ParsedBomLine {
  materialCode: string;
  chinaMaterialCode: string;
  name: string;
  materialCategory: string;
  spec: string;
  unit: string;
  qty: number;
  position: string;
  lossRate: number;
  levelPath: string;
  procurementType: string;
  substitute: boolean;
}

export interface ParsedBomWorkbook {
  productCode: string;
  productName: string;
  revision: string;
  lines: ParsedBomLine[];
  warnings: string[];
}

const t = (value: unknown) => String(value ?? "").replace(/\u00a0/g, " ").trim();
const n = (value: unknown) => {
  const parsed = Number.parseFloat(t(value).replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};
const BOM_EXPANDED = "\u0042\u004f\u004d\u591a\u7ea7\u5c55\u5f00";

/**
 * Parse the factory multi-level BOM workbook.
 * Only effective purchased leaf materials become consumption requirements;
 * self-made assemblies remain in the hierarchy and are not counted twice.
 */
export function parseFactoryBomWorkbook(sheets: Record<string, unknown[][]>): ParsedBomWorkbook {
  const sheetName = Object.keys(sheets).find((name) => name.includes(BOM_EXPANDED))
    ?? Object.keys(sheets).find((name) => name.toUpperCase() === "BOM");
  if (!sheetName) throw new Error("\u672a\u627e\u5230 BOM \u6216 BOM\u591a\u7ea7\u5c55\u5f00 \u5de5\u4f5c\u8868");

  const rows = sheets[sheetName] ?? [];
  const codeHeaders = ["\u5b50\u9879\u7269\u6599\u4ee3\u7801", "\u7269\u6599\u4ee3\u7801"];
  const qtyHeaders = ["\u7528\u91cf", "\u57fa\u672c\u5355\u4f4d\u7528\u91cf"];
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(t);
    return cells.some((v) => codeHeaders.includes(v)) && cells.some((v) => qtyHeaders.includes(v));
  });
  if (headerIndex < 0) throw new Error("\u672a\u627e\u5230\u6807\u51c6 BOM \u8868\u5934");

  const header = rows[headerIndex].map(t);
  const col = (...names: string[]) => header.findIndex((value) => names.includes(value));
  const idx = {
    level: col("\u5c42\u6b21"),
    code: col(...codeHeaders),
    vn: col("\u8d8a\u5357\u6599\u53f7", "\u8d8a\u5357\u4ee3\u7801"),
    name: col("\u7269\u6599\u540d\u79f0"),
    spec: col("\u89c4\u683c\u578b\u53f7"),
    property: col("\u7269\u6599\u5c5e\u6027"),
    unit: col("\u57fa\u672c\u5355\u4f4d", "\u5355\u4f4d"),
    qty: col("\u57fa\u672c\u5355\u4f4d\u7528\u91cf", "\u7528\u91cf"),
    loss: col("\u635f\u8017\u7387(%)", "\u635f\u8017\u7387"),
    position: col("\u4f4d\u7f6e\u53f7"),
  };

  const meta = rows.slice(0, headerIndex).flat().map(t).filter(Boolean).join(" ");
  const root = rows.slice(0, headerIndex).find((row) => t(row[0]).match(/^2\./)) ?? rows[headerIndex + 1] ?? [];
  const productCode = t(root[0])
    || meta.match(/SKU[\uff1a:]\s*([A-Z0-9-]+)/i)?.[1]
    || meta.match(/\u4ea7\u54c1\u578b\u53f7[\uff1a:]\s*([A-Z0-9-]+)/i)?.[1]
    || "";
  const productName = t(root[2])
    || meta.match(/\u4ea7\u54c1\u540d\u79f0[\uff1a:]\s*(.+?)(?:\s+V\d|\s+\u65e5\u671f)/)?.[1]
    || productCode;
  const bomTitle = (sheets.BOM ?? []).slice(0, 5).flat().map(t).filter(Boolean).join(" ");
  const revision = (bomTitle.match(/\bV\d+(?:\.\d+)+\b/i)?.[0]
    ?? meta.match(/\bV\.?\d+(?:\.\d+)?\b/i)?.[0]
    ?? "V1.0").replace("V.", "V");
  if (!productCode) throw new Error("\u65e0\u6cd5\u8bc6\u522b\u6210\u54c1\u7f16\u7801");

  const warnings: string[] = [];
  const lines: ParsedBomLine[] = [];
  let lastPrimary = "";
  for (const row of rows.slice(headerIndex + 1)) {
    const level = idx.level >= 0 ? t(row[idx.level]) : "";
    const chinaCode = t(row[idx.code]);
    if (!chinaCode) continue;
    const qty = n(row[idx.qty]);
    if (!Number.isFinite(qty)) { warnings.push(`${chinaCode}: \u7528\u91cf\u65e0\u6548`); continue; }
    if (qty === 0) { warnings.push(`${chinaCode}: \u7528\u91cf\u4e3a 0\uff0c\u4f5c\u4e3a\u505c\u7528\u9879\u6392\u9664`); continue; }
    if (qty < 0) { warnings.push(`${chinaCode}: \u7528\u91cf\u4e3a\u8d1f\uff0c\u6392\u9664`); continue; }

    const procurementType = idx.property >= 0 ? t(row[idx.property]) : "";
    const substitute = level === "\u66ff\u4ee3" || procurementType.includes("\u66ff\u4ee3");
    if (substitute) {
      warnings.push(`${chinaCode}: \u66ff\u4ee3\u6599\uff0c\u7b49\u5f85\u5ba1\u6279\u9009\u62e9\uff08\u4e3b\u6599 ${lastPrimary || "\u672a\u77e5"}\uff09`);
      continue;
    }
    if (procurementType.includes("\u81ea\u5236")) { lastPrimary = chinaCode; continue; }
    lastPrimary = chinaCode;

    const vnCode = idx.vn >= 0 ? t(row[idx.vn]) : "";
    const lossRaw = idx.loss >= 0 ? n(row[idx.loss]) : 0;
    lines.push({
      materialCode: vnCode || chinaCode,
      chinaMaterialCode: chinaCode,
      name: idx.name >= 0 ? t(row[idx.name]) || chinaCode : chinaCode,
      materialCategory: procurementType || "\u5916\u8d2d",
      spec: idx.spec >= 0 ? t(row[idx.spec]) : "",
      unit: idx.unit >= 0 ? t(row[idx.unit]) || "PCS" : "PCS",
      qty,
      position: idx.position >= 0 ? t(row[idx.position]) : "",
      lossRate: Number.isFinite(lossRaw) ? lossRaw / 100 : 0,
      levelPath: level,
      procurementType,
      substitute: false,
    });
  }

  const consolidated = new Map<string, ParsedBomLine>();
  for (const line of lines) {
    const existing = consolidated.get(line.materialCode);
    if (!existing) { consolidated.set(line.materialCode, { ...line }); continue; }
    const compatible = existing.chinaMaterialCode === line.chinaMaterialCode
      && existing.name === line.name
      && existing.materialCategory === line.materialCategory
      && existing.spec === line.spec
      && existing.unit === line.unit
      && existing.lossRate === line.lossRate;
    if (!compatible) {
      warnings.push(`${line.materialCode}: \u91cd\u590d\u6599\u53f7\u7684\u5c5e\u6027\u4e0d\u4e00\u81f4\uff0c\u5fc5\u987b\u4eba\u5de5\u5904\u7406`);
      consolidated.set(`${line.materialCode}#CONFLICT#${consolidated.size}`, { ...line });
      continue;
    }
    existing.qty += line.qty;
    existing.position = [existing.position, line.position].filter(Boolean).join(",");
    existing.levelPath = [existing.levelPath, line.levelPath].filter(Boolean).join(";");
    warnings.push(`${line.materialCode}: \u591a\u5206\u652f\u7528\u91cf\u5df2\u5408\u5e76`);
  }
  const finalLines = [...consolidated.values()];
  const duplicate = finalLines.map((line) => line.materialCode).filter((value, index, all) => all.indexOf(value) !== index);
  if (duplicate.length) warnings.push(`\u5c5e\u6027\u51b2\u7a81\u7684\u91cd\u590d\u6599\u53f7\uff1a${[...new Set(duplicate)].join(", ")}\uff0c\u7981\u6b62\u5bfc\u5165`);
  if (!finalLines.length) throw new Error("\u6ca1\u6709\u53ef\u6838\u9500\u7684\u6709\u6548\u5916\u8d2d\u7269\u6599");
  return { productCode, productName, revision, lines: finalLines, warnings };
}
