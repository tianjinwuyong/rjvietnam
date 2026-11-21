const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9232']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Login first
  await page.goto('http://localhost:5178');
  await page.waitForTimeout(1500);
  await page.fill('input[placeholder="用户名"]', 'PMC_CN_01');
  await page.fill('input[placeholder="密码"]', 'Factory@123');
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(2000);
  console.log('Logged in, URL:', page.url());

  // Try direct URL to dispatch board
  await page.goto('http://localhost:5178/mes/dispatchBoard');
  await page.waitForTimeout(3000);
  console.log('URL after nav:', page.url());

  // Get page text
  const bodyText = await page.locator('body').innerText();
  const lines = bodyText.split('\n').filter(l => l.trim());
  console.log('Page text (first 80):');
  lines.slice(0, 80).forEach(l => console.log(' ', l.trim()));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
