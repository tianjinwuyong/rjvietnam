const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9247']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Listen for console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);

  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);
  console.log('Logged in, URL:', page.url());

  // Click MES
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);

  // Click dispatch board tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      setTimeout(() => btn.click(), 500);
    }
  });
  await page.waitForTimeout(4000);
  console.log('Dispatch board tab clicked');

  // Check what we see
  const html = await page.content();
  console.log('HTML length:', html.length);
  console.log('Has 物料配送看板:', html.includes('物料配送看板'));
  console.log('Has 进行中:', html.includes('进行中'));

  // Check console errors
  console.log('Console errors:', errors.length);
  if (errors.length > 0) errors.forEach(e => console.log('  ERROR:', e));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board_detail.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
