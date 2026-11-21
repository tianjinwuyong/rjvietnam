const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9280']
  });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message));

  await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const title = await page.title();
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasContent = bodyText.trim().length > 50;

  console.log('Title:', title);
  console.log('Has content:', hasContent);
  console.log('Body text (first 300):', bodyText.slice(0, 300));
  console.log('Console errors:', consoleErrors.length);
  consoleErrors.forEach(e => console.log('  ERR:', e.slice(0, 200)));

  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\blank_check.png' });
  console.log('Screenshot saved');
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
