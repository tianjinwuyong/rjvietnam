import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  // Catch 500 responses and log the URL
  p.on('response', async resp => {
    if (resp.status() === 500) {
      const text = await resp.text().catch(() => '');
      console.log(`[500] ${resp.url()}`);
      console.log(`  body: ${text.substring(0, 300)}`);
    }
  });

  await p.goto('http://localhost:5178');
  await p.waitForLoadState('networkidle');

  await p.locator('button').filter({ hasText: 'Admin 01' }).first().click();
  await p.waitForTimeout(2000);
  
  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1000);
  await p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first().click();
  await p.waitForTimeout(1000);
  
  // Don't even click 架构图, just check 500s
  console.log('Done checking 500s');
  
  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
