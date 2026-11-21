const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  console.log('TABS:', pages.map(p => p.url().slice(0, 80)));
  let page = pages.find(p => p.url().includes('warehouseStorage')) || pages.find(p => p.url().includes('5178'));
  if (!page) { console.log('ERR no warehouse page'); await browser.close(); return; }
  await page.bringToFront();
  await page.waitForTimeout(1500);
  // click fullscreen toggle if not already fullscreen
  const fsBtn = page.locator('button', { hasText: /全屏|Fullscreen|全屏模式/ }).first();
  const fsCount = await fsBtn.count();
  console.log('fullscreen button:', fsCount);
  if (fsCount > 0) {
    const label = await fsBtn.innerText();
    if (label.includes('全屏') && !label.includes('退出')) {
      await fsBtn.click();
      await page.waitForTimeout(1200);
      console.log('clicked fullscreen');
    }
  }
  const url = page.url();
  const twin = await page.locator('[data-testid="twin-dashboard"]').count();
  const canvas = await page.locator('canvas').count();
  const kpi = await page.locator('[data-testid="twin-dashboard"]').innerText().catch(() => '');
  console.log('URL:', url);
  console.log('twin:', twin, '| canvas:', canvas);
  console.log('KPI:', kpi.replace(/\s+/g, ' ').slice(0, 400));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
