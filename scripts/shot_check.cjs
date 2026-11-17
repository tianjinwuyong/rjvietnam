const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9241']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);

  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);
  console.log('URL after login:', page.url());

  // Navigate to MES
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.includes('MES 执行')) { btn.click(); break; }
    }
  });
  await page.waitForTimeout(1500);
  console.log('URL after MES click:', page.url());

  // Find and scroll to dispatch board tab, then click
  await page.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll('button'));
    const dispatchBtn = allButtons.find(b => b.textContent.includes('物料配送'));
    if (dispatchBtn) {
      dispatchBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      dispatchBtn.click();
      console.log('Clicked dispatch board tab');
    } else {
      console.log('Dispatch board tab NOT found. All buttons:', allButtons.map(b => b.textContent.trim().substring(0, 30)));
    }
  });
  await page.waitForTimeout(3000);
  console.log('URL after tab click:', page.url());

  // Get current URL and page title
  console.log('Final URL:', page.url());

  // Check what article/card elements exist
  const articles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('article, [class*="card"]')).map(el => el.textContent.substring(0, 80));
  });
  console.log('Articles/cards found:', articles.length);
  if (articles.length > 0) console.log(articles.slice(0, 5));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board.png', fullPage: false });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
