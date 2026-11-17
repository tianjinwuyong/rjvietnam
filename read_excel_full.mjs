import XLSX from 'xlsx';

const wb = XLSX.readFile('F:/越南工厂瑞晶/dc/产品呆滞管控.xlsx');

for (const sheetName of wb.SheetNames) {
  console.log(`\n=== Sheet: ${sheetName} ===`);
  const sheet = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    console.log(`Row ${i}: ${JSON.stringify(row)}`);
  }
}
