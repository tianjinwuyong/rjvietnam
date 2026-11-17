import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  const jsErrors = [];
  p.on('pageerror', err => jsErrors.push(err.message));

  // Try port 5179 since that's what's listening
  await p.goto('http://localhost:5179');
  await p.waitForLoadState('networkidle');

  const title = await p.title();
  console.log('Page title:', title);
  console.log('URL:', p.url());

  await p.screenshot({ path: 'tmp/port5179.png' });
  console.log('Screenshot saved');

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
