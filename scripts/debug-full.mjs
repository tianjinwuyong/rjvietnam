import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  await p.goto('http://localhost:5179');
  await p.waitForLoadState('networkidle');

  // Login as Admin 01
  await p.locator('button').filter({ hasText: 'Admin 01' }).first().click();
  await p.waitForTimeout(2000);

  // Go to HR
  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1500);

  // Click 组织架构 tab
  await p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first().click();
  await p.waitForTimeout(1000);

  // Click 架构图 button to enter 3D mode
  await p.locator('button').filter({ hasText: '架构图' }).first().click();
  await p.waitForTimeout(3000);

  // Screenshot showing 3D view
  await b.newPage(); // blank page just to get a clean test messaging
  // Close blank
  const pages = b.contexts()[0].pages();
  if (pages.length > 1) await pages[1].close();

  // Take a focused screenshot clipped to the diagram area
  const diagramSection = p.locator('section.surface-panel').last();
  await diagramSection.screenshot({ path: 'tmp/org3d-text-test.png' });
  
  // Also full page
  await p.screenshot({ path: 'tmp/org3d-full-test.png', fullPage: false });

  // Check canvas rendering state
  const canvas = p.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 2000 });

  // Check the actual scene state by looking for renderer info
  const engine = await canvas.getAttribute('data-engine');
  console.log('Engine:', engine);

  // Read pixel data from center of canvas to verify rendering
  const centerX = (await canvas.boundingBox()).x + (await canvas.boundingBox()).width / 2;
  const centerY = (await canvas.boundingBox()).y + (await canvas.boundingBox()).height / 2;
  
  // Take screenshot of the canvas area for reading later
  await canvas.screenshot({ path: 'tmp/org3d-canvas-only.png' });

  console.log('All screenshots saved to tmp/');
  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
