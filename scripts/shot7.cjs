const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9236']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5178');
  await page.waitForTimeout(1500);

  // Try demo account: Admin 01
  await page.click('button:has-text("Admin 01")');
  await page.waitForTimeout(1000);

  await page.fill('input[placeholder="用户名"]', 'ADMIN_VN_01');
  await page.fill('input[placeholder="密码"]', 'Factory@123');
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(2000);
  console.log('Logged in');

  const sidebarButtons = await page.evaluate(() => {
    const btns = [];
    document.querySelectorAll('button').forEach(b => { if (b.textContent.trim()) btns.push(b.textContent.trim().substring(0, 40)); });
    return btns;
  });
  console.log('Sidebar buttons:', sidebarButtons);

  // Find MES button
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const t = btn.textContent.trim();
      if (t.toLowerCase().includes('mes') || t.includes('执行')) {
        btn.scrollIntoView();
        btn.click();
        console.log('Clicked:', t);
        break;
      }
    }
  });
  await page.waitForTimeout(2000);

  // Now click dispatch board tab
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const t = btn.textContent.trim();
      if (t.includes('物料配送')) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        btn.click();
        console.log('Clicked tab:', t);
        break;
      }
    }
  });
  await page.waitForTimeout(3000);

  const bodyText = await page.locator('body').innerText();
  const lines = bodyText.split('\n').filter(l => l.trim());
  console.log('Page text (first 60):');
  lines.slice(0, 60).forEach(l => console.log(' ', l.trim()));

  await page.screenshot({ path: 'C:\Users\\tianj\\AppData\\Local\\Temp\\dispatch_board.png', fullPage: true });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
