const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  console.log('TABS:', pages.map(p => p.url().slice(0, 90)));
  let page = pages.find(p => p.url().includes('warehouseStorage')) || pages.find(p => p.url().includes('5178'));
  if (!page) {
    console.log('opening new page...');
    page = await ctx.newPage();
    await page.goto('http://127.0.0.1:5178/?view=mes&mesTab=warehouseStorage', { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await page.bringToFront();
  const tok = await page.evaluate(() => sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '');
  console.log('TOKEN:', tok ? 'present' : 'MISSING');
  if (!tok) {
    try {
      await page.getByRole('button', { name: '工厂经理快速登录', exact: true }).click({ timeout: 5000 });
      console.log('quick login clicked');
    } catch (e) { console.log('no quick login btn:', e.message.split('\n')[0]); }
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await page.waitForTimeout(4000);
  const twin = await page.locator('[data-testid="twin-dashboard"]').count();
  const canvas = await page.locator('canvas').count();
  const url = page.url();
  console.log('URL:', url);
  console.log('twin:', twin, '| canvas:', canvas);
  // ensure fullscreen
  const fsBtn = page.locator('button', { hasText: /全屏/ }).first();
  if (await fsBtn.count() > 0) {
    const label = await fsBtn.innerText();
    console.log('fs label:', label);
    if (label.includes('全屏') && !label.includes('退出')) { await fsBtn.click(); await page.waitForTimeout(1000); console.log('fullscreen on'); }
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
