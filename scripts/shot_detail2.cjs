const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9242']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);

  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Go to MES
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);

  // Go to dispatch board tab
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent.includes('物料配送'));
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      btn.click();
    }
  });
  await page.waitForTimeout(2000);

  // Click the session card (look for article with 26061010006)
  await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article'));
    const card = articles.find(a => a.textContent.includes('26061010006'));
    if (card) {
      card.click();
      console.log('Clicked session card');
    } else {
      console.log('Session card not found. Articles:', articles.map(a => a.textContent.substring(0, 50)));
    }
  });
  await page.waitForTimeout(3000);

  // Get the page text to verify we're in detail view
  const bodyText = await page.locator('body').innerText();
  const lines = bodyText.split('\n').filter(l => l.trim());
  console.log('Detail view text (first 60):');
  lines.slice(0, 60).forEach(l => console.log(' ', l.trim()));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board_detail.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
