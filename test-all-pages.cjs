/**
 * SMT Factory System - Page-by-page Playwright Test
 * Run: node test-all-pages.js
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:5178';
const results = [];
let browser, page;
let errors = [];
let errorCount = 0;

async function visit(url, label) {
  try {
    errors = [];
    errorCount = 0;
    const consoleHandle = page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(`[${msg.location().url?.split('/').pop() || '?'}] ${msg.text().substring(0, 120)}`);
        errorCount++;
      }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const title = await page.title();
    const status = errorCount === 0 ? '✅' : '⚠️';

    results.push({ label, url, title, errors: [...errors], errorCount, status });
    consoleHandle.dispose();
  } catch (e) {
    results.push({ label, url, title: 'CRASH', errors: [e.message], errorCount: 99, status: '❌' });
  }
}

async function clickTab(tabText) {
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && text.trim() === tabText) {
        await btn.click();
        await page.waitForTimeout(1500);
        return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

async function clickSidebar(key) {
  try {
    const links = await page.$$('a');
    for (const link of links) {
      const href = await link.getAttribute('href');
      const text = await link.textContent();
      if (href === `#${key}` || text?.includes(key)) {
        await link.click();
        await page.waitForTimeout(1500);
        return true;
      }
    }
    // Try finding by text content in any element
    const allEls = await page.$$('*');
    for (const el of allEls) {
      try {
        const text = await el.textContent();
        const className = await el.getAttribute('class') || '';
        if (text?.trim() === key && className.includes('nav')) {
          await el.click();
          await page.waitForTimeout(1500);
          return true;
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  return false;
}

(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();

  // Capture ALL console errors from page load
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text().substring(0, 150);
      if (!txt.includes('WebSocket') && !txt.includes('favicon') && !txt.includes('HMR')) {
        errors.push(`[load] ${txt}`);
        errorCount++;
      }
    }
  });

  console.log('=== SMT Factory System - Page Test ===\n');

  // 1. Home
  await visit(BASE + '/', 'Home/Dashboard');
  await page.waitForTimeout(1000);

  // Get sidebar nav items
  const navItems = [];
  try {
    const sidebarButtons = await page.$$('.nav-item, .sidebar button, [class*="nav"] button, [class*="menu"] button');
    for (const btn of sidebarButtons) {
      const text = await btn.textContent();
      if (text && text.trim().length > 0 && text.trim().length < 30) {
        navItems.push(text.trim());
      }
    }
  } catch(e) {}

  console.log('Nav items found:', navItems.slice(0, 10));

  // Test direct URL pages that don't need auth
  const publicPages = [
    ['Login', BASE + '/login'],
  ];

  for (const [label, url] of publicPages) {
    await visit(url, label);
  }

  // Try login
  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(1000);

    // Fill login form
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].fill('PMC_CN_01');
      await inputs[1].fill('Factory@123');
      const submitBtn = await page.$('button[type="submit"], button:has-text("登录"), button:has-text("Login"), button:has-text("登入")');
      if (submitBtn) await submitBtn.click();
      await page.waitForTimeout(2000);
      results.push({ label: 'Login attempt', url: BASE + '/login', title: await page.title(), errors: [], errorCount: 0, status: '✅' });
    }
  } catch(e) {
    results.push({ label: 'Login', url: BASE + '/login', title: 'FAIL', errors: [e.message], errorCount: 1, status: '❌' });
  }

  // After login - test if we can navigate modules
  if (page.url() !== BASE + '/login') {
    await visit(page.url(), 'Post-Login-Check');
  }

  // Test sub-pages by clicking sidebar
  const moduleKeys = ['PMC', 'WMS', 'MES', 'Quality', 'HR', 'Equipment', 'Reports', 'AI'];
  for (const mod of moduleKeys) {
    await clickSidebar(mod);
    await page.waitForTimeout(1000);
    await visit(page.url(), `Module: ${mod}`);
  }

  // Test 3D factory (lazy route)
  await visit(BASE + '/#/factory3d', '3D Factory (hash)');
  await page.waitForTimeout(2000);

  await browser.close();

  // Print results
  console.log('\n=== RESULTS ===');
  let passCount = 0, warnCount = 0, failCount = 0;
  for (const r of results) {
    const errStr = r.errors.length > 0 ? ` | ERRORS: ${r.errors.join('; ')}` : '';
    console.log(`${r.status} [${r.label}] ${r.title}${errStr}`);
    if (r.status === '✅') passCount++;
    else if (r.status === '⚠️') warnCount++;
    else failCount++;
  }
  console.log(`\nTotal: ${results.length} | ✅ ${passCount} | ⚠️ ${warnCount} | ❌ ${failCount}`);
})();
