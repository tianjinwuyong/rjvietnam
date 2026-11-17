const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9240']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);

  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Navigate to MES > dispatch board
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.includes('MES 执行')) { btn.click(); break; }
    }
  });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.includes('物料配送')) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        btn.click();
        break;
      }
    }
  });
  await page.waitForTimeout(2000);

  // Click the session card to enter detail view
  await page.evaluate(() => {
    const articles = document.querySelectorAll('article');
    for (const art of articles) {
      if (art.textContent.includes('26061010006')) {
        art.click();
        console.log('Clicked session card');
        break;
      }
    }
  });
  await page.waitForTimeout(3000);

  // Scroll down a bit
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
