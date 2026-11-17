const { chromium } = require('playwright');
const BASE = 'http://localhost:5178';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Login
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  const btns0 = await page.$$('button');
  for (const b of btns0) {
    const t = await b.textContent();
    if (t && t.includes('一键登录')) { await b.click(); break; }
  }
  await page.waitForTimeout(3000);

  console.log('=== Deep Exploring All Tabs ===\n');

  const tabs = ['总览', 'WMS 物料', 'MES 执行'];
  for (const tab of tabs) {
    console.log(`\n--- Tab: ${tab} ---`);
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    const allBtns = await page.$$('button');
    for (const b of allBtns) {
      const t = await b.textContent();
      if (t && t.includes(tab)) { await b.click(); break; }
    }
    await page.waitForTimeout(2000);

    // Get all interactive elements
    const els = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return [];
      const all = Array.from(root.querySelectorAll('button, a, [role="button"], [role="tab"], article, [class*="card"]'));
      return all.map(el => {
        const tag = el.tagName;
        const cls = el.className || '';
        const text = el.textContent?.trim() || '';
        const role = el.getAttribute('role') || '';
        const type = el.getAttribute('type') || '';
        return { tag, cls: cls.substring(0,40), text: text.substring(0,40), role, type };
      }).filter(x => x.text.length > 1 && x.text.length < 50);
    });

    // Deduplicate
    const seen = new Set();
    els.filter(x => {
      const key = x.text + x.tag;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).forEach(x => {
      const roleType = x.role ? `role="${x.role}"` : (x.type ? `type="${x.type}"` : '');
      console.log(`  <${x.tag}> ${roleType} "${x.text}"`);
    });

    // Try clicking each button in this tab
    const uniqueTexts = [...new Set(els.map(x => x.text))];
    for (const text of uniqueTexts) {
      if (['总览', 'WMS 物料', 'MES 执行', '退出'].includes(text)) continue;
      const clicked = await (async () => {
        const bs = await page.$$('button');
        for (const b of bs) {
          const t = await b.textContent();
          if (t && t.includes(text)) {
            await b.click();
            await page.waitForTimeout(1500);
            return true;
          }
        }
        return false;
      })();
      if (clicked) {
        const title = await page.title();
        console.log(`  -> Clicked "${text}" -> ${title}`);
      }
    }
  }

  await browser.close();
})();
