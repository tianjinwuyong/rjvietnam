import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('console', msg => { if (msg.type() === 'error') console.log('[ERR]', msg.text()); });
  p.on('pageerror', err => console.log('[CRASH]', err.message));

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

  // Get canvas content via toDataURL and check if it's all bg color
  const canvasContent = await p.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 'NO_CANVAS';
    // Check if there's a WebGL context
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'NO_WEBGL';
    
    // Use toDataURL to get actual rendered content
    const dataUrl = canvas.toDataURL();
    // Check if it's essentially blank (all one color)
    // A blank canvas with WebGL clear color will have a specific data URL
    console.log('Data URL length:', dataUrl.length);
    
    // Create an ImageData from a small sample to check if non-bg pixels exist
    try {
      // Use preserveDrawingBuffer by temporarily setting it
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(canvas, 0, 0);
      const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Check a grid of points for non-background colors
      // Background is #f0f4f8 = rgb(240, 244, 248)
      const bgR = 240, bgG = 244, bgB = 248;
      let nonBgPixels = 0;
      const step = 50;
      for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
          const idx = (y * canvas.width + x) * 4;
          const dr = Math.abs(data[idx] - bgR);
          const dg = Math.abs(data[idx + 1] - bgG);
          const db = Math.abs(data[idx + 2] - bgB);
          if (dr > 10 || dg > 10 || db > 10) {
            nonBgPixels++;
          }
        }
      }
      return { width: canvas.width, height: canvas.height, nonBgPixels, totalChecked: Math.ceil(canvas.width/step) * Math.ceil(canvas.height/step) };
    } catch (e) {
      return { error: e.message };
    }
  });
  
  console.log('Canvas content analysis:', JSON.stringify(canvasContent, null, 2));
  await p.screenshot({ path: 'hr-3d-fixed.png', fullPage: true });
  console.log('Screenshot saved');
  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
