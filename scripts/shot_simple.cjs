const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9246']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);

  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Click MES (产线与质量 > MES 执行)
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);

  // Click dispatch board tab (物料配送看板)
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent.includes('物料配送'));
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      setTimeout(() => btn.click(), 400);
    }
  });
  await page.waitForTimeout(3000);

  // Now click the session card using JavaScript dispatch
  await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article'));
    const target = articles.find(a => a.textContent.includes('26061010006'));
    if (target) {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(5000);

  // Check URL and page state
  console.log('URL:', page.url());
  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split('\n').filter(l => l.trim());
  console.log('Lines count:', lines.length);
  console.log('First 80 lines:');
  lines.slice(0, 80).forEach(l => console.log(' ', l.trim()));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board_detail.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
