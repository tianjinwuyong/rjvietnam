import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  await p.goto('http://localhost:5178');
  await p.waitForLoadState('networkidle');

  // Click Admin 01
  const adminBtn = p.locator('button').filter({ hasText: 'Admin 01' }).first();
  await adminBtn.click();
  await p.waitForTimeout(3000);
  console.log('Logged in');

  // Find sidebar elements
  const sidebarItems = await p.evaluate(() => {
    const all = document.querySelectorAll('body *');
    const results = [];
    for (const el of all) {
      const text = (el.textContent || '').trim();
      if (text === '人事' && el.children.length === 0) {
        const rect = el.getBoundingClientRect();
        results.push({ tag: el.tagName, text, x: rect.x, y: rect.y, w: rect.width, h: rect.height, parentTag: el.parentElement?.tagName, parentClass: (el.parentElement?.className || '').substring(0, 40) });
      }
    }
    return results;
  });
  console.log('Sidebar "人事" elements:', JSON.stringify(sidebarItems, null, 2));

  // Click the 人事 text
  const hrText = p.locator('text=人事').first();
  await hrText.click().catch(e => console.log('Click failed:', e.message));
  await p.waitForTimeout(2000);
  console.log('Clicked 人事 text');

  // Click 组织架构 tab
  const orgTab = p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first();
  if (await orgTab.isVisible()) {
    await orgTab.click();
    await p.waitForTimeout(1500);
    console.log('Clicked 组织架构 tab');
  }

  await p.screenshot({ path: 'hr-org-tree.png', fullPage: true });
  console.log('Org tree view saved');

  // Click 架构图 / diagram button
  const diagramBtn = p.locator('button').filter({ hasText: /架构图|3D|Diagram/ }).first();
  if (await diagramBtn.isVisible()) {
    await diagramBtn.click();
    await p.waitForTimeout(3000);
    console.log('Clicked 架构图 button');
    await p.screenshot({ path: 'hr-org-3d.png', fullPage: true });
    console.log('3D view saved');
  } else {
    console.log('架构图 button not found, dumping buttons...');
    const buttons = await p.locator('button').allInnerTexts();
    console.log(buttons.join(' | '));
  }

  const canvas = await p.$('canvas');
  console.log('3D Canvas:', canvas ? 'FOUND!' : 'none');

  const body = await p.locator('body').innerText();
  console.log('\nPage has 组织架构:', body.includes('组织架构'));
  console.log('Page has 3D:', body.includes('3D'));
  console.log('Body snippet:', body.substring(100, 400));

  await p.screenshot({ path: 'hr-check2.png', fullPage: true });
  console.log('Screenshot saved');

  const foundCanvas = await p.$('canvas');
  console.log('3D Canvas:', foundCanvas ? 'FOUND!' : 'none');

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
