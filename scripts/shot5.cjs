const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9234']
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

  // Try clicking "产线与质量" in the sidebar
  const sidebarLinks = await page.evaluate(() => {
    const links = [];
    document.querySelectorAll('a, button, [role="button"], li').forEach(el => {
      if (el.textContent.trim()) links.push({ text: el.textContent.trim().substring(0, 50), tag: el.tagName });
    });
    return links;
  });
  console.log('All interactive elements:', sidebarLinks.slice(0, 50));

  // Click "产线与质量"
  const prodBtn = page.locator('text=产线与质量').first();
  if (await prodBtn.count() > 0) {
    await prodBtn.click();
    await page.waitForTimeout(1500);
    console.log('Clicked 产线与质量');
  }

  // Get page text again
  const bodyText = await page.locator('body').innerText();
  const lines = bodyText.split('\n').filter(l => l.trim());
  console.log('After clicking 产线与质量:');
  lines.slice(0, 80).forEach(l => console.log(' ', l.trim()));

  await page.screenshot({ path: 'C:\\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
