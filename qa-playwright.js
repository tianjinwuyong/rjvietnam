const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setViewportSize({ width: 1280, height: 800 });

  // Tab 1: Scan
  await page.goto('http://localhost:5179', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'qa-tab1-scan.png' });
  console.log('Tab 1 (Scan) captured');

  // Tab 2: Data Sources
  await page.click('button:has-text("数据源")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'qa-tab2-datasource.png' });
  console.log('Tab 2 (Data Sources) captured');

  // Tab 3: Live Feed
  await page.click('button:has-text("实时数据")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'qa-tab3-feed.png' });
  console.log('Tab 3 (Live Feed) captured');

  await browser.close();
  console.log('All tabs captured');
})();
