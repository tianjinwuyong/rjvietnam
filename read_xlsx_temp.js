const XLSX = require('xlsx');

const filePath = 'C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\dc\\bruce\\物料标签格式.xlsx';
const workbook = XLSX.readFile(filePath);

console.log('Sheets:', workbook.SheetNames);
workbook.SheetNames.forEach(name => {
    const sheet = workbook.Sheets[name];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`\n=== Sheet: ${name} (${data.length} rows) ===`);
    data.forEach((row, i) => {
        if (row.some(c => c != null && c !== '')) {
            console.log(`R${i}:`, JSON.stringify(row));
        }
    });
});
