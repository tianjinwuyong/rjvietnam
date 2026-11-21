const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('5178'));
  if (!page) page = await ctx.newPage();
  await page.bringToFront();
  await page.goto('http://127.0.0.1:5178/?view=mes&mesTab=warehouseStorage', { waitUntil: 'domcontentloaded', timeout: 45000 });
  // check auth token
  const tok = await page.evaluate(() => sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '');
  console.log('TOKEN:', tok ? 'present (' + tok.slice(0, 12) + '...)' : 'MISSING');
  if (!tok) {
    // quick login via demo button if visible
    try {
      await page.getByRole('button', { name: '工厂经理快速登录', exact: true }).click({ timeout: 4000 });
      console.log('quick login clicked');
    } catch (e) {
      console.log('quick login btn not found:', e.message.split('\n')[0]);
    }
    await page.waitForTimeout(2500);
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);
  const url = page.url();
  const hasTwin = await page.locator('[data-testid="twin-dashboard"]').count();
  const has3d = await page.locator('canvas').count();
  const title = await page.title();
  const bodyText = (await page.locator('body').innerText()).slice(0, 300).replace(/\s+/g, ' ');
  console.log('URL:', url);
  console.log('TITLE:', title);
  console.log('twin-dashboard:', hasTwin, '| canvas:', has3d);
  console.log('BODY:', bodyText);
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
