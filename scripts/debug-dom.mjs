import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

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

  // Count canvas elements
  const canvasCount = await p.locator('canvas').count();
  console.log('Canvas count:', canvasCount);

  // Check the R3F container
  const r3fContainers = await p.locator('[data-three]').count();
  console.log('R3F containers [data-three]:', r3fContainers);

  // Look for any absolutely positioned overlay divs (Html component creates them)
  // Html creates elements with class starting with "html-container" or inside a specific div
  const allDivs = await p.locator('div').all();
  let htmlCount = 0;
  for (const div of allDivs) {
    const outerHTML = await div.innerHTML();
    // Html from drei creates divs with style that contains transform
    if (outerHTML.includes('transform') && outerHTML.includes('translate')) {
      htmlCount++;
    }
  }
  
  // Simpler: count elements with style containing "translate" inside the three canvas container
  const threeDiv = p.locator('div[style*="position: relative"][style*="overflow: hidden"]').first();
  const threeInner = await threeDiv.innerHTML();
  const translateMatches = threeInner.match(/translate/g);
  console.log('Translate transforms in R3F container:', translateMatches ? translateMatches.length : 0);
  
  // Check for any three.js debug info
  const hasThreeDot = await p.locator('canvas').first().getAttribute('data-engine');
  console.log('Canvas data-engine attr:', hasThreeDot);

  // Get all text that's visible after navigation
  const visible = await p.locator('text=生产部, 品质部, 工程部, 仓库, 管理部').first().isVisible().catch(() => false);
  console.log('Text from tree view visible:', visible);

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
