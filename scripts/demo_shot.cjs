const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9260']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);
  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Go to MES
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);

  // Go to dispatch board tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      setTimeout(() => btn.click(), 500);
    }
  });
  await page.waitForTimeout(3000);

  // Click session card for 26061010006
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('article')).find(a => a.textContent.includes('26061010006'));
    if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(4000);

  // Scroll through the detail view
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\demo_1.png', fullPage: false });
  console.log('Shot 1 (stats + operators)');

  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\demo_2.png', fullPage: false });
  console.log('Shot 2 (operator bars)');

  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\demo_3.png', fullPage: false });
  console.log('Shot 3 (table)');

  console.log('Errors:', errors.length, errors.join('; ').substring(0, 200));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
