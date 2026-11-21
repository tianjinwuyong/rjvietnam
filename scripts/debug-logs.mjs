import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

  // Capture ALL console messages
  const logs = [];
  p.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  p.on('pageerror', err => logs.push(`[PAGE_ERROR] ${err.message}`));

  // Track network requests for font loading
  const fontRequests = [];
  p.on('request', req => {
    if (req.url().includes('.ttf') || req.url().includes('.woff') || req.url().includes('font')) {
      fontRequests.push({ url: req.url(), status: 'requested' });
    }
  });
  p.on('response', resp => {
    if (resp.url().includes('.ttf') || resp.url().includes('.woff') || resp.url().includes('font')) {
      const idx = fontRequests.findIndex(f => f.url === resp.url() && f.status === 'requested');
      if (idx >= 0) fontRequests[idx].status = `${resp.status()}`;
    }
  });

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

  // Print font requests
  console.log('Font requests:');
  for (const fr of fontRequests) {
    console.log(`  ${fr.status} ${fr.url}`);
  }

  // Print relevant errors (filter noise)
  console.log('\nRelevant console output:');
  for (const l of logs) {
    // Skip Vite HMR noise
    if (l.includes('[vite]') || l.includes('autocomplete')) continue;
    // Skip 500/404 from API server
    if (l.includes('500') && l.includes('8080')) continue;
    if (l.includes('404') && l.includes('8080')) continue;
    if (l.includes('THREE.Clock')) continue;
    console.log(l);
  }

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
