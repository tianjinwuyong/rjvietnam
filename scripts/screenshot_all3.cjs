const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9283']
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

  // Screenshot of session list
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\all_3_complete.png', fullPage: true });
  console.log('Session list screenshot saved');

  // Get session text
  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split('\n').filter(l => l.trim());
  console.log('Session list text:');
  lines.forEach(l => {
    if (l.includes('2606') || l.includes('Session') || l.includes('总计') || l.includes('已上料') || l.includes('LINE'))
      console.log(' ', l.trim());
  });

  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
