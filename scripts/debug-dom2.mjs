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

  // Find all absolutely positioned divs inside the R3F canvas wrapper
  // Html component creates divs with position:absolute inside the container
  const htmlOverlays = p.locator('div[style*="position: absolute"]').filter({ hasText: /生产|品质|工程|仓库|管理/ });
  const count = await htmlOverlays.count();
  console.log('Html overlays with dept names:', count);

  if (count > 0) {
    for (let i = 0; i < Math.min(count, 5); i++) {
      const text = await htmlOverlays.nth(i).innerText();
      console.log(`  Overlay ${i}: "${text}"`);
    }
  }

  // Also check for the background divs (rgba(0,0,0,0.35))
  const bgDivs = p.locator('div[style*="rgba"]');
  const bgCount = await bgDivs.count();
  console.log('Divs with rgba style:', bgCount);
  if (bgCount > 0) {
    for (let i = 0; i < Math.min(bgCount, 5); i++) {
      const outer = await bgDivs.nth(i).outerHTML();
      console.log(`  rgba div ${i}: ${outer.substring(0, 200)}`);
    }
  }

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
