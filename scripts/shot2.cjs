const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9231']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Login
  await page.goto('http://localhost:5178');
  await page.waitForTimeout(1500);
  await page.fill('input[placeholder="用户名"]', 'PMC_CN_01');
  await page.fill('input[placeholder="密码"]', 'Factory@123');
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(2000);

  // Click MES in sidebar
  const mesBtn = page.locator('text=MES').first();
  if (await mesBtn.count() > 0) {
    await mesBtn.click();
    await page.waitForTimeout(1500);
  }

  // Scroll right in tab bar
  await page.evaluate(() => {
    const tabBar = document.querySelector('[role="tablist"], .tab-bar, .tabs, nav');
    if (tabBar) tabBar.scrollLeft = 600;
  });
  await page.waitForTimeout(500);

  const dispatchTab = page.locator('text=物料配送看板');
  const count = await dispatchTab.count();
  console.log('Found dispatchBoard tab:', count);

  if (count > 0) {
    await dispatchTab.first().click();
    await page.waitForTimeout(2500);
  } else {
    await page.evaluate(() => {
      const tabBar = document.querySelector('[role="tablist"], .tab-bar, .tabs, nav');
      if (tabBar) tabBar.scrollLeft = 1200;
    });
    await page.waitForTimeout(500);
    const count2 = await page.locator('text=物料配送看板').count();
    console.log('After scroll, found:', count2);
    if (count2 > 0) {
      await page.locator('text=物料配送看板').first().click();
      await page.waitForTimeout(2500);
    }
  }

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board.png', fullPage: true });
  const bodyText = await page.locator('body').innerText();
  const lines = bodyText.split('\n').filter(l => l.trim());
  console.log('Page text (first 60):');
  lines.slice(0, 60).forEach(l => console.log(' ', l.trim()));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
