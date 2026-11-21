
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

  await page.goto('http://127.0.0.1:5178/?view=mes&mesTab=warehouseStorage', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /工厂经理快速登录/ }).first().click();
  await page.waitForTimeout(18000);

  console.log('h2:', JSON.stringify(await page.locator('h2').allInnerTexts()));
  console.log('canvas count:', await page.evaluate(() => document.querySelectorAll('canvas').length));
  console.log('buttons:', JSON.stringify((await page.locator('button').allInnerTexts()).filter(t => t.length < 30).slice(0, 15)));
  const liveText = await page.evaluate(() => document.body.innerText.includes('LIVE WMS') || document.body.innerText.includes('实时 WMS'));
  console.log('has LIVE WMS text:', liveText);
  const wmsErrors = errors.filter(e => e.includes('wms.view') || e.includes('403'));
  console.log('wms permission errors:', wmsErrors.length);
  console.log('--- other errors (first 8) ---');
  errors.filter(e => !e.includes('WebGL') && !e.includes('THREE')).slice(0, 8).forEach(e => console.log(e));
  await page.screenshot({ path: 'C:/Users/tianj/Desktop/越南工厂瑞晶/3d-page-final.png' });
  await browser.close();
})();
