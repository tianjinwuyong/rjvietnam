const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9230']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Go to login first
  await page.goto('http://localhost:5178');
  await page.waitForTimeout(1500);
  await page.fill('input[placeholder="用户名"]', 'PMC_CN_01');
  await page.fill('input[placeholder="密码"]', 'Factory@123');
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(2000);

  // Now navigate to MES
  await page.goto('http://localhost:5178/mes');
  await page.waitForTimeout(2000);

  // Find and click the dispatch board tab
  const tabs = await page.locator('[role="tab"], .tab-item, button').allTextContents();
  console.log('All tab/button texts:', tabs.filter(t => t.trim()));

  // Try clicking by text
  const dispatchTab = page.locator('text=物料配送看板');
  const count = await dispatchTab.count();
  console.log('Found dispatchBoard tab:', count);
  if (count > 0) {
    await dispatchTab.first().click();
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
