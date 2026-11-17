import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const logs = [];
  p.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  p.on('pageerror', err => logs.push(`[PAGE_ERROR] ${err.message}`));

  await p.goto('http://localhost:5179');
  await p.waitForLoadState('networkidle');
  await p.locator('button').filter({ hasText: 'Admin 01' }).first().click();
  await p.waitForTimeout(2000);
  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1500);
  await p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first().click();
  await p.waitForTimeout(1000);
  await p.locator('button').filter({ hasText: '架构图' }).first().click();
  await p.waitForTimeout(4000);

  // Log errors
  for (const l of logs) {
    if (l.includes('[vite]') || l.includes('autocomplete') || l.includes('THREE.Clock')) continue;
    if (l.includes('500') || l.includes('404')) continue;
    console.log(l);
  }

  // Check if canvas has pixels (not blank)
  const pixelData = await p.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return 'NO_CANVAS';
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'NO_GL_CONTEXT';
    // Read center pixel
    const buf = new Uint8Array(4);
    gl.readPixels(c.width/2, c.height/2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return `Center pixel: RGBA(${buf[0]},${buf[1]},${buf[2]},${buf[3]})`;
  });
  console.log('Pixel check:', pixelData);

  // Count scene objects by checking the r3f store
  const sceneInfo = await p.evaluate(() => {
    try {
      const root = document.getElementById('root');
      const threeDiv = root?.querySelector('div[style*="position: relative"]');
      const canvas = threeDiv?.querySelector('canvas');
      return {
        hasThreeDiv: !!threeDiv,
        canvasSize: canvas ? `${canvas.width}x${canvas.height}` : 'none',
      };
    } catch(e) { return { error: e.message }; }
  });
  console.log('Scene info:', JSON.stringify(sceneInfo));

  await p.screenshot({ path: 'tmp/canvas-text-final.png', fullPage: false });
  console.log('Screenshot saved');

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
