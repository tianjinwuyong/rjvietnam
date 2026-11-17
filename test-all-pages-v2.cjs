/**
 * SMT Factory System - Page-by-page Playwright Test
 * Run: node test-all-pages.cjs
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:5178';
const results = [];
let browser, page;
let pageErrors = [];

async function visit(url, label) {
  pageErrors = [];
  function errHandler(msg) {
    if (msg.type() === 'error') {
      const txt = msg.text();
      if (txt.includes('WebSocket') || txt.includes('favicon') || txt.includes('HMR') || txt.includes('vite')) return;
      pageErrors.push(txt.substring(0, 150));
    }
  }
  page.on('console', errHandler);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    const title = await page.title();
    const status = pageErrors.length === 0 ? 'PASS' : 'WARN';
    results.push({ label, url, title, errors: [...pageErrors], errorCount: pageErrors.length, status });
  } catch (e) {
    results.push({ label, url, title: 'CRASH', errors: [e.message], errorCount: 99, status: 'FAIL' });
  } finally {
    page.off('console', errHandler);
  }
}

async function clickNavButton(text) {
  try {
    const btns = await page.$$('button');
    for (const b of btns) {
      const t = await b.textContent();
      if (t && t.trim() === text) {
        await b.click();
        await page.waitForTimeout(2000);
        return true;
      }
    }
  } catch(e) {}
  return false;
}

async function clickAriaLabel(label) {
  try {
    const el = await page.$(`[aria-label="${label}"]`);
    if (el) { await el.click(); await page.waitForTimeout(2000); return true; }
  } catch(e) {}
  return false;
}

(async () => {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage();

  console.log('=== SMT Factory System - Page-by-Page Test ===\n');

  await visit(BASE + '/', '1. Home/Dashboard');
  await page.waitForTimeout(1000);

  let sidebarClicks = 0;
  const navLabels = ['PMC', 'WMS', 'MES', 'Quality', 'HR', 'Equipment', 'Reports', 'AI', 'BOM', 'Dashboard'];

  for (const label of navLabels) {
    const clicked = await clickNavButton(label);
    if (clicked) {
      sidebarClicks++;
      await visit(page.url(), `Nav: ${label}`);
    }
  }

  const subTabs = ['Dashboard', 'Work Orders', 'WorkOrderDetail', 'Material', 'Station', 'Employee', 'Report', 'Alert'];
  for (const tab of subTabs) {
    const clicked = await clickNavButton(tab);
    if (clicked) {
      await visit(page.url(), `SubTab: ${tab}`);
    }
  }

  await visit(BASE + '/', 'Direct: Home');
  try {
    await clickAriaLabel('3D工厂');
    await page.waitForTimeout(3000);
    await visit(page.url(), 'After: 3D工厂 click');
  } catch(e) {}

  await visit(BASE + '/#/factory3d', 'Hash: #/factory3d');
  await visit(BASE + '/#/mes', 'Hash: #/mes');
  await visit(BASE + '/#/pmc', 'Hash: #/pmc');

  await browser.close();

  console.log('\n=== TEST RESULTS ===');
  let pass = 0, warn = 0, fail = 0;
  for (const r of results) {
    const errStr = r.errors.length > 0 ? `\n   ERRORS: ${r.errors.slice(0,3).join('\n   ')}` : '';
    console.log(`${r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌'} [${r.label}]\n   Title: ${r.title}${errStr}\n`);
    if (r.status === 'PASS') pass++;
    else if (r.status === 'WARN') warn++;
    else fail++;
  }
  console.log(`Total: ${results.length} pages | ✅ ${pass} | ⚠️ ${warn} | ❌ ${fail}`);
  console.log('\nSidebar nav clicks successful:', sidebarClicks);
})();
