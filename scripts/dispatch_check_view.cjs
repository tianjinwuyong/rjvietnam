const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9275']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Login
  await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Navigate to dispatch board
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) { btn.scrollIntoView({ behavior: 'smooth', inline: 'center' }); setTimeout(() => btn.click(), 500); }
  });
  await page.waitForTimeout(4000);

  // Open session
  await page.locator('article').filter({ hasText: '26061010006' }).first().click({ force: true });
  await page.waitForTimeout(5000);

  // Get full page text to see what's there
  const bodyText = await page.evaluate(() => document.body.innerText);
  const lines = bodyText.split('\n').filter(l => l.trim());
  console.log('Page content:');
  lines.forEach(l => console.log(' ', l.trim().slice(0, 100)));

  // Scroll to operator bars section and screenshot
  await page.evaluate(() => {
    const sections = document.querySelectorAll('section, div[class*="panel"], h3');
    for (const s of sections) {
      if (s.textContent.includes('操作员进度') || s.textContent.includes('Operator Progress')) {
        s.scrollIntoView();
        break;
      }
    }
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\dispatch_scrolled.png', fullPage: true });

  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
