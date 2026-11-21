import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  await p.goto('http://localhost:5179');
  await p.waitForLoadState('networkidle');

  await p.locator('button').filter({ hasText: 'Admin 01' }).first().click();
  await p.waitForTimeout(2000);

  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1500);

  await p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first().click();
  await p.waitForTimeout(1000);

  await p.locator('button').filter({ hasText: '架构图' }).first().click();
  await p.waitForTimeout(3000);

  const canvas = p.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 3000 });
  await canvas.screenshot({ path: 'tmp/org3d-canvas-test.png' });

  await p.screenshot({ path: 'tmp/org3d-full-test.png', fullPage: false });

  console.log('Canvas screenshots saved');
  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
