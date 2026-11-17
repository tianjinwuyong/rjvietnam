const { chromium } = require('playwright');
const BASE = 'http://localhost:5178';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  let pageErrors = [];
  function errHandler(msg) {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!t.includes('WebSocket') && !t.includes('favicon') && !t.includes('HMR') && !t.includes('vite') && !t.includes('ws://')) {
        pageErrors.push(t.substring(0, 150));
      }
    }
  }

  console.log('=== SMT Factory System - Full Navigation Test ===\n');

  // 1. Go to home (shows login)
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  console.log('After load - URL:', page.url(), '| Title:', await page.title());

  // 2. Click "一键登录（Operator）" button
  const btns = await page.$$('button');
  let clicked = false;
  for (const b of btns) {
    const t = await b.textContent();
    if (t && t.includes('一键登录')) {
      console.log('Clicking:', t.trim());
      await b.click();
      clicked = true;
      await page.waitForTimeout(3000);
      break;
    }
  }

  if (!clicked) {
    // Try fill login form
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].fill('PMC_CN_01');
      await inputs[1].fill('Factory@123');
      const submit = await page.$('button[type="submit"]');
      if (submit) { await submit.click(); await page.waitForTimeout(3000); }
    }
  }

  console.log('After login - URL:', page.url(), '| Title:', await page.title());

  // 3. Now check for sidebar navigation
  const allBtns = await page.$$('button');
  console.log(`\nAll buttons on main page (${allBtns.length}):`);
  for (const b of allBtns.slice(0, 60)) {
    const t = await b.textContent();
    const c = await b.getAttribute('class') || '';
    if (t && t.trim().length > 0 && t.trim().length < 40) {
      console.log(`  "${t.trim()}" class="${c.substring(0,50)}"`);
    }
  }

  // 4. Check for nav sidebar
  const rootInfo = await page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return 'NO ROOT';
    // Find sidebar
    const sidebar = root.querySelector('[class*="sidebar"]') || root.querySelector('aside') || root.querySelector('[class*="nav"]');
    if (!sidebar) {
      // Get top level children
      const children = Array.from(root.children).slice(0, 5);
      return 'No sidebar found. Top children: ' + children.map(c => `${c.tagName} class="${c.className.substring(0,30)}"`).join(', ');
    }
    const navBtns = Array.from(sidebar.querySelectorAll('button, a')).slice(0, 30);
    return 'Sidebar found. Nav items: ' + navBtns.map(n => `${n.tagName} "${n.textContent?.trim().substring(0,20)}"`).join(', ');
  });
  console.log('\nNavigation structure:', rootInfo);

  // 5. Try clicking nav items
  const navLabels = ['PMC', 'WMS', 'MES', 'Quality', 'HR', 'Equipment', 'Reports', 'AI', 'BOM', 'Dashboard', 'nav.dashboard', '3D工厂'];
  let navSuccess = 0;
  for (const label of navLabels) {
    const btns2 = await page.$$('button');
    for (const b of btns2) {
      const t = await b.textContent();
      if (t && t.includes(label)) {
        console.log(`\nClicking nav: "${t.trim()}"`);
        await b.click();
        await page.waitForTimeout(2000);
        console.log('  URL:', page.url(), '| Title:', await page.title());
        navSuccess++;
        break;
      }
    }
  }

  console.log(`\n\nNavigation clicks successful: ${navSuccess}/${navLabels.length}`);
  await browser.close();
})();
