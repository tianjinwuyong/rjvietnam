import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  const jsErrors = [];
  p.on('pageerror', err => jsErrors.push(err.message));

  await p.goto('http://localhost:5178');
  await p.waitForLoadState('networkidle');

  await p.locator('button').filter({ hasText: 'Admin 01' }).first().click();
  await p.waitForTimeout(2000);

  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1500);

  const orgTab = p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first();
  await orgTab.click();
  await p.waitForTimeout(1000);

  const diagramBtn = p.locator('button').filter({ hasText: '架构图' }).first();
  await diagramBtn.click();
  await p.waitForTimeout(3000);

  const canvas = p.locator('canvas').first();
  const dataEngine = await canvas.getAttribute('data-engine');
  console.log('Three.js engine:', dataEngine);

  // Check console errors (ignore 404/500 from API server)
  console.log('Page errors:', jsErrors.filter(e => !e.includes('404') && !e.includes('500') && !e.includes('autocomplete')));

  // Screenshot the 3D area
  await p.screenshot({ path: 'tmp/org3d-text-cjk.png', fullPage: false });
  console.log('Screenshot saved to tmp/org3d-text-cjk.png');

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
