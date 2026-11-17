const { chromium } = require('playwright');
const BASE = 'http://localhost:5178';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  console.log('URL:', page.url());
  console.log('Title:', await page.title());

  const btns = await page.$$('button');
  console.log(`\nButtons (${btns.length}):`);
  for (const b of btns.slice(0, 50)) {
    const t = await b.textContent();
    const c = await b.getAttribute('class') || '';
    if (t && t.trim().length > 0 && t.trim().length < 50) {
      console.log(`  "${t.trim()}" class="${c.substring(0,50)}"`);
    }
  }

  const links = await page.$$('a');
  console.log(`\nLinks (${links.length}):`);
  for (const l of links.slice(0, 30)) {
    const t = await l.textContent();
    const h = await l.getAttribute('href') || '';
    if (t && t.trim().length > 0 && t.trim().length < 50) {
      console.log(`  "${t.trim()}" href="${h}"`);
    }
  }

  const rootInfo = await page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return 'NO ROOT';
    const allEls = Array.from(root.querySelectorAll('*'));
    const els = allEls.slice(0, 40).map(c => `${c.tagName} class="${c.className}" txt="${c.textContent?.trim().substring(0,25)}"`);
    return els.join('\n');
  });
  console.log('\nRoot children:\n', rootInfo);

  await browser.close();
})();
