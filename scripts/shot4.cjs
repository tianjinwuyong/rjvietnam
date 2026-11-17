const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9233']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Login
  await page.goto('http://localhost:5178');
  await page.waitForTimeout(1500);
  await page.fill('input[placeholder="用户名"]', 'PMC_CN_01');
  await page.fill('input[placeholder="密码"]', 'Factory@123');
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(2000);
  console.log('Logged in');

  // Click MES quick action button (绑定 = bind = mes module)
  // Actually let's use the sidebar nav
  // First find any "MES" text
  const mesLink = page.locator('text=MES').first();
  if (await mesLink.count() > 0) {
    await mesLink.click();
    await page.waitForTimeout(2000);
    console.log('Clicked MES link');
  }

  // Get the tab bar element and scroll it
  // Find all buttons in the toolbar
  const allButtons = await page.locator('.toolbar button, [role="tab"]').allTextContents();
  console.log('Toolbar/tab buttons:', allButtons);

  // Try to find and click dispatch board tab using partial match
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.includes('物料配送') || btn.textContent.includes('dispatch') || btn.textContent.includes('Dispatch')) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        btn.click();
        console.log('Clicked:', btn.textContent);
        break;
      }
    }
  });
  await page.waitForTimeout(3000);

  const bodyText = await page.locator('body').innerText();
  const lines = bodyText.split('\n').filter(l => l.trim());
  console.log('Page text (first 60):');
  lines.slice(0, 60).forEach(l => console.log(' ', l.trim()));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
