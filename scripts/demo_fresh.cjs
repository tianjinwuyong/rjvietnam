const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9262']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  // FRESH browser - no caching
  await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);
  console.log('Logged in');

  // MES
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  console.log('MES clicked');

  // Dispatch board tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      setTimeout(() => btn.click(), 500);
    }
  });
  await page.waitForTimeout(4000);
  console.log('Tab clicked');

  // Click session card
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('article')).find(a => a.textContent.includes('26061010006'));
    if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(5000);
  console.log('Card clicked');

  // Get operator bar section text
  const operatorText = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('section, div'));
    for (const s of sections) {
      if (s.textContent.includes('PDA001') && s.textContent.includes('操作员进度')) {
        return s.textContent.substring(0, 300);
      }
    }
    return 'NOT FOUND';
  });
  console.log('Operator bars section:', operatorText);

  // Get page text
  const allText = await page.evaluate(() => document.body.innerText);
  const lines = allText.split('\n').filter(l => l.trim());
  console.log('Page has Zhang Wei:', allText.includes('Zhang Wei'));
  console.log('Page has Li Na:', allText.includes('Li Na'));
  console.log('Page has 操作员进度:', allText.includes('操作员进度'));

  // Scroll to operator bars and screenshot
  await page.evaluate(() => window.scrollTo(0, 350));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\demo_operators.png', fullPage: false });
  console.log('Screenshot saved');
  console.log('Errors:', errors.length, errors.join('; ').substring(0, 200));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
