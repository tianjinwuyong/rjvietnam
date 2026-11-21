const { chromium } = require('playwright');
const http = require('http');

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost', port: 8080, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9270']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Login
  await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Navigate to dispatch board
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) { btn.scrollIntoView({ behavior: 'smooth', inline: 'center' }); setTimeout(() => btn.click(), 500); }
  });
  await page.waitForTimeout(4000);

  // Click session card
  await page.locator('article').filter({ hasText: '26061010006' }).first().click({ force: true });
  await page.waitForTimeout(5000);

  // Take baseline screenshot
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\dispatch_before.png', fullPage: true });
  console.log('Baseline screenshot saved');

  // Fire loading events with delays
  const events = [
    { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'A1', materialCode: 'C0805-10450', qty: 500, operator: 'Li Na', lotNo: 'LOT-LN-01' },
    { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'A2', materialCode: 'R0402-10310', qty: 1000, operator: 'Li Na', lotNo: 'LOT-LN-02' },
    { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'B1', materialCode: 'C0603-10500', qty: 300, operator: 'Wang Qiang', lotNo: 'LOT-WQ-01' },
    { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'B2', materialCode: 'R0402-10100', qty: 800, operator: 'Wang Qiang', lotNo: 'LOT-WQ-02' },
    { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'A3', materialCode: 'C0402-10220', qty: 200, operator: 'Li Na', lotNo: 'LOT-LN-03' },
    { workOrderCode: '26061010006', lineCode: 'LINE-01', slotNo: 'B3', materialCode: 'R0603-10470', qty: 600, operator: 'Wang Qiang', lotNo: 'LOT-WQ-03' },
  ];

  for (let i = 0; i < events.length; i++) {
    await postJson('/mes/feeder-loading', events[i]);
    console.log(`Fired event ${i + 1}/${events.length}: ${events[i].operator} → ${events[i].materialCode}`);
    await page.waitForTimeout(4000); // Wait for SSE refresh
    await page.screenshot({ path: `C:\\Users\\tianj\\Desktop\\dispatch_after_event${i+1}.png`, fullPage: true });
    console.log(`Screenshot after event ${i + 1} saved`);
  }

  // Take final screenshot
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\dispatch_after_all.png', fullPage: true });
  console.log('Final screenshot saved');

  await browser.close();
  console.log('Done!');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
