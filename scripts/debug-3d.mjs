import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  // Capture console messages
  const logs = [];
  p.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  p.on('pageerror', err => logs.push(`[PAGE_ERROR] ${err.message}`));

  await p.goto('http://localhost:5178');
  await p.waitForLoadState('networkidle');

  // Login
  const adminBtn = p.locator('button').filter({ hasText: 'Admin 01' }).first();
  await adminBtn.click();
  await p.waitForTimeout(2000);

  // Navigate to 人事
  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1000);

  // Click 组织架构 tab
  const orgTab = p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first();
  if (await orgTab.isVisible()) {
    await orgTab.click();
    await p.waitForTimeout(1000);
    console.log('Clicked 组织架构 tab');
  }

  // Switch to 架构图 / diagram
  const diagramBtn = p.locator('button').filter({ hasText: /架构图|3D|Diagram/ }).first();
  if (await diagramBtn.isVisible()) {
    await diagramBtn.click();
    await p.waitForTimeout(4000);
    console.log('Clicked 架构图 button');
  }

  await p.screenshot({ path: 'hr-3d-debug.png', fullPage: true });

  const canvas = await p.$('canvas');
  console.log('Canvas found:', !!canvas);
  if (canvas) {
    const box = await canvas.boundingBox();
    console.log('Canvas bounds:', box);
  }

  // Check if the 3D panel section exists
  const bodyText = await p.locator('body').innerText();
  console.log('Has drag hint:', bodyText.includes('Drag node'));
  console.log('Has 架构图:', bodyText.includes('架构图'));

  // Print console errors
  console.log('\n--- Console logs ---');
  for (const l of logs) console.log(l);

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
