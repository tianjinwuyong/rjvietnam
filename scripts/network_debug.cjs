const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9281']
  });
  const page = await browser.newPage();

  const failedRequests = [];
  page.on('requestfailed', req => {
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
  });
  page.on('response', async res => {
    if (res.status() === 404) {
      failedRequests.push({ url: res.url(), status: 404 });
    }
  });

  await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  console.log('Failed/404 requests:');
  failedRequests.forEach(r => console.log(' ', r.url, r.status || r.failure));

  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
