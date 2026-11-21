const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9244']
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
      setTimeout(() => btn.click(), 500);
    }
  });
  await page.waitForTimeout(3000);

  // Click the article using JS
  await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article'));
    const card = articles.find(a => a.textContent.includes('26061010006'));
    if (card) {
      const rect = card.getBoundingClientRect();
      const event = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      });
      card.dispatchEvent(event);
      console.log('JS-clicked article');
    } else {
      console.log('Article not found');
    }
  });
  await page.waitForTimeout(4000);

  // Get page HTML
  const html = await page.content();
  console.log('Page has content:', html.length, 'chars');
  console.log('Has session detail content:', html.includes('操作员进度') || html.includes('Per-operator'));

  // Check URL
  console.log('URL:', page.url());

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board_detail.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
