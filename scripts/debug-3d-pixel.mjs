import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  const logs = [];
  p.on('console', msg => { if (msg.type() === 'error') logs.push(`[ERR] ${msg.text()}`); });
  p.on('pageerror', err => logs.push(`[CRASH] ${err.message}`));

  await p.goto('http://localhost:5178');
  await p.waitForLoadState('networkidle');

  // Login
  await p.locator('button').filter({ hasText: 'Admin 01' }).first().click();
  await p.waitForTimeout(2000);

  // Navigate to 人事 > 组织架构 > 架构图
  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1000);
  await p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first().click();
  await p.waitForTimeout(1000);
  await p.locator('button').filter({ hasText: /架构图|3D|Diagram/ }).first().click();
  await p.waitForTimeout(5000);

  // Get canvas pixel data
  const canvasInfo = await p.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { found: false };
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { found: true, webgl: false };
    
    // Read pixels at center and at several points
    const w = canvas.width;
    const h = canvas.height;
    const pixels = [];
    const points = [
      { x: w/2, y: h/2, name: 'center' },
      { x: w/4, y: h/4, name: 'top-left' },
      { x: 3*w/4, y: h/4, name: 'top-right' },
      { x: w/4, y: 3*h/4, name: 'bottom-left' },
      { x: 3*w/4, y: 3*h/4, name: 'bottom-right' },
    ];
    for (const pt of points) {
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(pt.x), Math.floor(h - pt.y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      pixels.push({ name: pt.name, r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] });
    }
    return { found: true, width: w, height: h, pixels };
  });
  console.log('Canvas info:', JSON.stringify(canvasInfo, null, 2));

  // Also check Three.js renderer info
  const threeInfo = await p.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 'no canvas';
    // Check if scene has objects by looking at renderer
    return { id: canvas.id, class: canvas.className, parentClasses: canvas.parentElement?.className || '' };
  });
  console.log('Three.js info:', JSON.stringify(threeInfo, null, 2));

  for (const l of logs) console.log(l);
  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
