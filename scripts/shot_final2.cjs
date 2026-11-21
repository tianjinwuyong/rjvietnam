const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9252']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5178');
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
  await page.waitForTimeout(1500);

  // Dispatch board tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      setTimeout(() => btn.click(), 500);
    }
  });
  await page.waitForTimeout(3000);

  // Click session card
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('article')).find(a => a.textContent.includes('26061010006'));
    if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(4000);

  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split('\n').filter(l => l.trim());
  console.log('Detail view text (first 80):');
  lines.slice(0, 80).forEach(l => console.log(' ', l.trim()));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board_detail.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
