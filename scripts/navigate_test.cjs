const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9282']
  });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', err => consoleErrors.push('PAGE ERR: ' + err.message.slice(0, 200)));

  // Login
  await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Navigate to MES
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);

  // Navigate to dispatch board
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) { btn.scrollIntoView({ behavior: 'smooth', inline: 'center' }); setTimeout(() => btn.click(), 500); }
  });
  await page.waitForTimeout(4000);

  // Click session
  await page.locator('article').filter({ hasText: '26061010006' }).first().click({ force: true });
  await page.waitForTimeout(6000);

  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasDispatch = bodyText.includes('操作员进度') || bodyText.includes('配料分配');

  console.log('Has dispatch content:', hasDispatch);
  console.log('Body text (first 400):', bodyText.slice(0, 400));
  console.log('\nConsole errors:', consoleErrors.length);
  consoleErrors.forEach(e => console.log('  ', e));

  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\after_restart.png', fullPage: true });
  console.log('\nScreenshot saved');
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
