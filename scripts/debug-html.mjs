import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  // Track console errors
  const jsErrors = [];
  p.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push(msg.text());
  });
  p.on('pageerror', err => jsErrors.push(err.message));

  await p.goto('http://localhost:5178');
  await p.waitForLoadState('networkidle');

  // Login
  await p.locator('button').filter({ hasText: 'Admin 01' }).first().click();
  await p.waitForTimeout(2000);

  // Navigate to HR
  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1500);

  // Switch to 组织架构 tab
  const orgTab = p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first();
  await orgTab.click();
  await p.waitForTimeout(1000);

  // Click 架构图 button
  const diagramBtn = p.locator('button').filter({ hasText: '架构图' }).first();
  await diagramBtn.click();
  await p.waitForTimeout(2000);

  // Now check if Html labels rendered: the names from OrgChartNode
  // Look for any text content from the Html overlay
  const bodyText = await p.locator('body').innerText();
  const namesFound = ['生产部', '品质部', '工程部', '仓库', '管理部'].filter(n => bodyText.includes(n));
  console.log('Names found in page:', namesFound);

  // Also check for any divs with the label styling (rgba background)
  const labelDivs = await p.locator('div[style*="rgba(0,0,0,0.35)"]').count();
  console.log('Html label backgrounds found:', labelDivs);

  console.log('JS errors:', jsErrors.filter(e => !e.includes('404') && !e.includes('500') && !e.includes('autocomplete')));

  // Screenshot
  await p.screenshot({ path: 'tmp/org3d-html-labels.png', fullPage: false });
  console.log('Screenshot saved');

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
