import XLSX from 'xlsx';

const wb = XLSX.readFile('F:/越南工厂瑞晶/dc/产品呆滞管控.xlsx');

console.log('Sheets:', wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  console.log(`\n=== Sheet: ${sheetName} ===`);
  const sheet = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  for (let i = 0; i < Math.min(data.length, 100); i++) {
    const row = data[i];
    if (row && row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
      console.log(JSON.stringify(row));
    }
  }
}
