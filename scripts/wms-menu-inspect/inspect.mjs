import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const source = 'C:/Users/tianj/Desktop/越南工厂瑞晶/dc/MES工站与WMS需求.xlsx';
const outputDir = 'C:/Users/tianj/Desktop/越南工厂瑞晶/smt-factory-system/scripts/wms-menu-inspect/output';
await fs.mkdir(outputDir, { recursive: true });
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const sheets = await workbook.inspect({ kind: 'sheet', include: 'id,name', maxChars: 8000 });
console.log('SHEETS');
console.log(sheets.ndjson);
const overview = await workbook.inspect({ kind: 'workbook,sheet,table,region', maxChars: 20000, tableMaxRows: 100, tableMaxCols: 20, tableMaxCellChars: 200 });
console.log('OVERVIEW');
console.log(overview.ndjson);
for (const target of ['仓库与IQC MES功能清单', 'SMT MES需求']) {
  const detail = await workbook.inspect({ kind: 'table,region', sheetId: target, range: target === '仓库与IQC MES功能清单' ? 'A1:F88' : 'A1:E80', maxChars: 30000, tableMaxRows: 100, tableMaxCols: 10, tableMaxCellChars: 500 });
  console.log(`DETAIL ${target}`);
  console.log(detail.ndjson);
}
for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  if (used) {
    const preview = await workbook.render({ sheetName: sheet.name, autoCrop: 'all', scale: 1.5, format: 'png' });
    await fs.writeFile(`${outputDir}/${sheet.name.replace(/[\\/:*?"<>|]/g, '_')}.png`, new Uint8Array(await preview.arrayBuffer()));
  }
}
