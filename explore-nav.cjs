const { chromium } = require('playwright');
const BASE = 'http://localhost:5178';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  console.log('=== Exploring Full Navigation Structure ===\n');

  // Login
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  const btns0 = await page.$$('button');
  for (const b of btns0) {
    const t = await b.textContent();
    if (t && t.includes('一键登录')) { await b.click(); break; }
  }
  await page.waitForTimeout(3000);
  console.log('Logged in\n');

  // Explore Dashboard (总览) thoroughly
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  // Get ALL text content on the page
  const allText = await page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return [];
    const els = Array.from(root.querySelectorAll('button, a, [role="button"], [class*="card"], [class*="item"]'));
    return els.map(el => {
      const tag = el.tagName;
      const cls = el.className || '';
      const text = el.textContent?.trim() || '';
      const role = el.getAttribute('role') || '';
      const aria = el.getAttribute('aria-label') || '';
      return { tag, cls: cls.substring(0,50), text: text.substring(0,40), role, aria };
    }).filter(x => x.text.length > 1);
  });

  // Deduplicate by text
  const seen = new Set();
  const unique = allText.filter(x => {
    const key = x.text + x.cls;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log('All interactive elements:');
  unique.forEach(x => {
    if (x.text.length < 30) {
      console.log(`  <${x.tag}> ${x.role ? `role="${x.role}"` : ''} "${x.text}" class="${x.cls}"`);
    }
  });

  // Try to find and click module cards
  const cardLabels = ['PMC', 'WMS', 'MES', 'Quality', 'HR', 'Equipment', 'Reports', 'AI', 'BOM', 'Finance', 'Maintenance', 'Admin'];
  console.log('\nTrying module card clicks:');
  for (const label of cardLabels) {
    const els = await page.$$('*');
    for (const el of els) {
      try {
        const text = await el.textContent();
        const cls = await el.getAttribute('class') || '';
        if (text && text.includes(label) && cls && (cls.includes('card') || cls.includes('item') || cls.includes('nav') || cls.includes('menu'))) {
          console.log(`  Found: "${text.trim().substring(0,40)}" in <${el.tagName}> class="${cls.substring(0,40)}"`);
          await el.click();
          await page.waitForTimeout(2000);
          console.log(`    After click: ${page.url()} | ${await page.title()}`);
          break;
        }
      } catch(e) {}
    }
  }

  // Get the full page HTML structure (first level children of root)
  const structure = await page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return 'no root';
    const children = Array.from(root.children);
    return children.map(c => {
      const tag = c.tagName;
      const cls = c.className || '';
      const text = c.textContent?.trim().substring(0, 60) || '';
      return `<${tag}> class="${cls.substring(0,40)}" text="${text}"`;
    }).join('\n');
  });
  console.log('\nRoot children structure:\n', structure);

  await browser.close();
})();
