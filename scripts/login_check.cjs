const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9237']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(2000);

  // Fill and submit login form directly
  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  console.log('URL:', page.url());

  // Get all text on page
  const bodyText = await page.locator('body').innerText();
  const lines = bodyText.split('\n').filter(l => l.trim());
  console.log('Body (first 50):');
  lines.slice(0, 50).forEach(l => console.log(' ', l.trim()));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\login_check.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
