import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  
  // Log 500 errors with URLs
  p.on('response', resp => {
    if (resp.status() === 500) console.log(`[500] ${resp.url()}`);
  });
  p.on('pageerror', err => console.log(`[CRASH] ${err.message}`));

  await p.goto('http://localhost:5178');
  await p.waitForLoadState('networkidle');

  await p.locator('button').filter({ hasText: 'Admin 01' }).first().click();
  await p.waitForTimeout(2000);
  
  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1000);
  await p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first().click();
  await p.waitForTimeout(1000);
  await p.locator('button').filter({ hasText: /架构图|3D|Diagram/ }).first().click();
  await p.waitForTimeout(5000);

  // Check the canvas for rendered labels by sampling specific areas
  const hasContent = await p.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 'NO_CANVAS';
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(canvas, 0, 0);
    const data = tempCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    
    // Count non-background pixels (bg = #f0f4f8 ≈ rgb(240,244,248))
    let nonBg = 0;
    const step = 20;
    const bgR = 240, bgG = 244, bgB = 248;
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const idx = (y * canvas.width + x) * 4;
        if (Math.abs(data[idx] - bgR) > 15 || Math.abs(data[idx+1] - bgG) > 15 || Math.abs(data[idx+2] - bgB) > 15) {
          nonBg++;
        }
      }
    }
    return { w: canvas.width, h: canvas.height, nonBg, total: Math.ceil(canvas.width/step) * Math.ceil(canvas.height/step) };
  });
  console.log('Canvas:', JSON.stringify(hasContent));

  await p.screenshot({ path: 'surface-labels.png', fullPage: true });
  console.log('screenshot saved');
  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
