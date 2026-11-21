const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9245']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);

  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);
  console.log('Logged in');

  // Click MES
  await page.getByRole('button', { name: /MES 执行/i }).click();
  await page.waitForTimeout(2000);
  console.log('Clicked MES');

  // Scroll the tab bar to find dispatch board tab
  const tabBar = page.locator('.toolbar, [role="tablist"]');
  if (await tabBar.count() > 0) {
    await tabBar.evaluate(el => el.scrollLeft = 500);
    await page.waitForTimeout(500);
  }

  // Find dispatch board tab button
  const dispatchBtn = page.getByRole('button', { name: /物料配送/i });
  if (await dispatchBtn.count() > 0) {
    await dispatchBtn.click();
    await page.waitForTimeout(3000);
    console.log('Clicked dispatch board tab');
  } else {
    console.log('Dispatch button not found');
  }

  // Now find and click the session card
  const sessionCard = page.locator('article').filter({ hasText: '26061010006' });
  if (await sessionCard.count() > 0) {
    await sessionCard.click();
    await page.waitForTimeout(4000);
    console.log('Clicked session card');
  } else {
    console.log('Session card not found');
  }

  // Get page text
  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split('\n').filter(l => l.trim());
  console.log('Page text (first 60):');
  lines.slice(0, 60).forEach(l => console.log(' ', l.trim()));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board_detail.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
