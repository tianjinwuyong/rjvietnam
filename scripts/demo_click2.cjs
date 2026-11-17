const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9263']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // MES
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);

  // Dispatch board tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      setTimeout(() => btn.click(), 500);
    }
  });
  await page.waitForTimeout(4000);

  // Check if we're in list view or detail view
  const inDetailView = await page.evaluate(() => {
    return document.body.innerText.includes('Session #');
  });
  console.log('In detail view (Session #):', inDetailView);

  // Find and click the card using Playwright's click
  const cardLocator = page.locator('article').filter({ hasText: '26061010006' });
  const cardCount = await cardLocator.count();
  console.log('Found cards:', cardCount);

  if (cardCount > 0) {
    // Use Playwright click with force
    await cardLocator.first().click({ force: true, timeout: 5000 });
    await page.waitForTimeout(6000);
    console.log('Card clicked with Playwright');
  }

  // Check again
  const inDetailViewAfter = await page.evaluate(() => {
    return document.body.innerText.includes('Session #');
  });
  console.log('In detail view after click:', inDetailViewAfter);

  const allText = await page.evaluate(() => document.body.innerText);
  console.log('Body has 操作员进度:', allText.includes('操作员进度'));
  console.log('Body has Zhang Wei:', allText.includes('Zhang Wei'));
  console.log('Body has 刷新:', allText.includes('刷新'));
  console.log('Body has 返回:', allText.includes('返回'));

  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\demo_after_click.png', fullPage: false });
  console.log('Screenshot saved');

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
