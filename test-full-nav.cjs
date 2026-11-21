const { chromium } = require('playwright');
const BASE = 'http://localhost:5178';

const results = [];
let browser, page;

function errHandler(msg) {
  if (msg.type() === 'error') {
    const t = msg.text();
    if (!t.includes('WebSocket') && !t.includes('favicon') && !t.includes('HMR') &&
        !t.includes('vite') && !t.includes('ws://') && !t.includes('ConcurrentRoot')) {
      results[results.length-1].errors.push(t.substring(0, 200));
      results[results.length-1].errorCount++;
    }
  }
}

async function testPage(label) {
  const r = { label, url: page.url(), title: await page.title(), errors: [], errorCount: 0 };
  results.push(r);
  page.on('console', errHandler);
  await page.waitForTimeout(1500);
  page.off('console', errHandler);
  const status = r.errorCount === 0 ? 'PASS' : 'WARN';
  const icon = status === 'PASS' ? '✅' : '⚠️';
  console.log(`${icon} [${label}] ${r.title} (${r.errorCount} errors)`);
  if (r.errors.length > 0) {
    r.errors.forEach(e => console.log(`   ERR: ${e}`));
  }
}

async function getButtons() {
  return await page.$$('button');
}

async function clickButtonContaining(text) {
  const btns = await getButtons();
  for (const b of btns) {
    const t = await b.textContent();
    if (t && t.includes(text)) {
      await b.click();
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

(async () => {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage();

  console.log('=== SMT Factory System - Full Page Test ===\n');

  // Load and login
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  const btns0 = await getButtons();
  for (const b of btns0) {
    const t = await b.textContent();
    if (t && t.includes('一键登录')) { await b.click(); break; }
  }
  await page.waitForTimeout(3000);
  console.log('Logged in:', page.url());

  // Test 1: Dashboard (总览)
  await testPage('1. Dashboard (总览)');

  // Test 2: Quick actions on dashboard
  const quickActions = ['收料', '发料', '绑定', '报工', '检验', '查询'];
  for (const action of quickActions) {
    await clickButtonContaining(action);
    await testPage(`   ${action}`);
  }

  // Test 3: Click "WMS 物料" tab
  await clickButtonContaining('WMS 物料');
  await testPage('2. WMS 物料');
  await page.waitForTimeout(2000);

  // Get all buttons in WMS tab
  const wmsBtns = await getButtons();
  const wmsLabels = [];
  for (const b of wmsBtns) {
    const t = await b.textContent();
    if (t && t.trim().length > 0 && t.trim().length < 30) {
      wmsLabels.push(t.trim());
    }
  }
  console.log('   WMS buttons:', [...new Set(wmsLabels)].join(', '));

  // Click back to 总览 and then to MES
  await clickButtonContaining('总览');
  await testPage('Back to Dashboard');
  await clickButtonContaining('MES 执行');
  await testPage('3. MES 执行');
  await page.waitForTimeout(2000);

  const mesBtns = await getButtons();
  const mesLabels = [];
  for (const b of mesBtns) {
    const t = await b.textContent();
    if (t && t.trim().length > 0 && t.trim().length < 30) {
      mesLabels.push(t.trim());
    }
  }
  console.log('   MES buttons:', [...new Set(mesLabels)].join(', '));

  // Click each unique MES button
  const uniqueMesBtns = [...new Set(mesLabels)];
  for (const label of uniqueMesBtns) {
    if (['总览', 'WMS 物料', 'MES 执行', '退出'].includes(label)) continue;
    const clicked = await clickButtonContaining(label);
    if (clicked) {
      await testPage(`   MES: ${label}`);
    }
  }

  // Test hash routes
  for (const hash of ['#/factory3d', '#/mes', '#/pmc', '#/wms', '#/hr', '#/quality']) {
    await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle', timeout: 20000 });
    await testPage(`Hash: ${hash}`);
  }

  await browser.close();

  // Summary
  console.log('\n=== SUMMARY ===');
  let pass = 0, warn = 0, fail = 0;
  for (const r of results) {
    if (r.errorCount === 0) pass++;
    else if (r.errorCount < 99) warn++;
    else fail++;
  }
  console.log(`Total: ${results.length} | ✅ ${pass} | ⚠️ ${warn} | ❌ ${fail}`);
  if (warn > 0 || fail > 0) {
    console.log('\nPages with errors:');
    results.filter(r => r.errorCount > 0).forEach(r => {
      console.log(`  ⚠️ [${r.label}] ${r.errors.length} errors`);
      r.errors.forEach(e => console.log(`     ${e.substring(0, 100)}`));
    });
  }
})();
