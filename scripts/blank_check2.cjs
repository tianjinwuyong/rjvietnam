const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9251']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => consoleMessages.push({ type: 'pageerror', text: err.message }));

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);

  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Go to MES
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);

  // Click dispatch board tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      setTimeout(() => btn.click(), 500);
    }
  });
  await page.waitForTimeout(3000);

  console.log('After tab click:');
  console.log('  URL:', page.url());
  console.log('  Errors:', consoleMessages.filter(m => m.type === 'error' || m.type === 'pageerror').length);

  // Click the session card
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('article')).find(a => a.textContent.includes('26061010006'));
    if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(4000);

  console.log('\nAfter card click:');
  console.log('  URL:', page.url());

  const criticalErrors = consoleMessages.filter(m => m.type === 'pageerror' || (m.type === 'error' && !m.text.includes('404') && !m.text.includes('401') && !m.text.includes('502')));
  console.log('  Critical errors:', criticalErrors.length);
  criticalErrors.forEach(e => console.log('  ', e.type, ':', e.text.substring(0, 200)));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\blank_check.png', fullPage: false });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
