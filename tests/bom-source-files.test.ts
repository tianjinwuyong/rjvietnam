import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseFactoryBomWorkbook } from "../apps/web/src/pmc/bomExcelParser";

const sourceDir = process.env.BOM_SOURCE_DIR;

describe.skipIf(!sourceDir)("configured factory BOM source files", () => {
  it("parses every XLS/XLSX source without silently dropping the product or materials", () => {
    const files = fs.readdirSync(sourceDir!).filter((name) => /\.xlsx?$/i.test(name) && !name.startsWith("~$"));
    expect(files.length).toBeGreaterThan(0);

    const summaries = files.map((name) => {
      const workbook = XLSX.readFile(path.join(sourceDir!, name), { cellDates: true });
      const sheets = Object.fromEntries(workbook.SheetNames.map((sheetName) => [
        sheetName,
        XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" }),
      ]));
      const parsed = parseFactoryBomWorkbook(sheets);
      expect(parsed.productCode, name).not.toBe("");
      expect(parsed.revision, name).toMatch(/^V\d/i);
      expect(parsed.lines.length, name).toBeGreaterThan(0);
      const duplicateCodes = parsed.lines.map((line) => line.materialCode)
        .filter((code, index, all) => all.indexOf(code) !== index);
      return {
        file: name,
        productCode: parsed.productCode,
        revision: parsed.revision,
        materials: parsed.lines.length,
        duplicateCodes: new Set(duplicateCodes).size,
        warnings: parsed.warnings.length,
      };
    });

    console.table(summaries);
  });
});
