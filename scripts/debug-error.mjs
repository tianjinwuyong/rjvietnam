import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  
  p.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  p.on('pageerror', err => console.log(`[CRASH] ${err.message}`));
  p.on('response', resp => {
    if (resp.status() >= 400) console.log(`[HTTP ${resp.status()}] ${resp.url().substring(0,100)}`);
  });

  await p.goto('http://localhost:5178');
  await p.waitForTimeout(3000);
  
  // Check page state
  const bodyText = await p.locator('body').textContent().catch(() => '');
  console.log('Page loaded, body length:', bodyText.length);
  
  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
