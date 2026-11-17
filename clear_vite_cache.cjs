const fs = require('fs');
const dirs = [
  'C:/Users/tianj/Desktop/越南工厂瑞晶/smt-factory-system/node_modules/@smt-factory/web/node_modules/.vite',
  'C:/Users/tianj/Desktop/越南工厂瑞晶/smt-factory-system/node_modules/.vite',
];
for (const d of dirs) {
  try {
    fs.rmSync(d, { recursive: true, force: true });
    console.log('deleted: ' + d);
  } catch(e) {
    console.log('skip: ' + d + ' -> ' + e.message);
  }
}
