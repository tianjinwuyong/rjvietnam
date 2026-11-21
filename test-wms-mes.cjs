const { chromium } = require('playwright');
const BASE = 'http://localhost:5178';
const results = [];
let browser, page;

function errHandler(msg) {
  if (msg.type() === 'error') {
    const t = msg.text();
    if (!t.includes('WebSocket') && !t.includes('favicon') && !t.includes('HMR') &&
        !t.includes('vite') && !t.includes('ws://') && !t.includes('ConcurrentRoot')) {
      const cur = results[results.length-1];
      if (cur) { cur.errors.push(t.substring(0, 200)); cur.errorCount++; }
    }
  }
}

async function testPage(label) {
  const r = { label, url: page.url(), title: await page.title(), errors: [], errorCount: 0 };
  results.push(r);
  page.on('console', errHandler);
  await page.waitForTimeout(1200);
  page.off('console', errHandler);
  const icon = r.errorCount === 0 ? '✅' : '⚠️';
  console.log(`${icon} [${label}] ${r.title}${r.errorCount > 0 ? ` (${r.errorCount} err)` : ''}`);
}

async function getAllButtonTexts() {
  const btns = await page.$$('button');
  const texts = [];
  for (const b of btns) {
    const t = await b.textContent();
    if (t && t.trim().length > 0 && t.trim().length < 40) texts.push(t.trim());
  }
  return [...new Set(texts)];
}

async function clickBtn(text) {
  const btns = await page.$$('button');
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

  console.log('=== SMT WMS + MES Sub-Tab Test ===\n');

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

  // === WMS Module ===
  await clickBtn('WMS 物料');
  await testPage('WMS Main Tab');

  // Get all WMS buttons
  const wmsTexts = await getAllButtonTexts();
  console.log('  WMS buttons:', wmsTexts.join(', '));

  // Click each WMS sub-section
  const wmsSkip = ['总览', 'WMS 物料', 'MES 执行', '退出'];
  for (const text of wmsTexts) {
    if (wmsSkip.includes(text)) continue;
    const clicked = await clickBtn(text);
    if (clicked) await testPage(`WMS: ${text}`);
  }

  // === MES Module ===
  await clickBtn('MES 执行');
  await testPage('MES Main Tab');

  const mesTexts = await getAllButtonTexts();
  console.log('\n  MES buttons:', mesTexts.join(', '));

  const mesSkip = ['总览', 'WMS 物料', 'MES 执行', '退出', '重试'];
  for (const text of mesTexts) {
    if (mesSkip.includes(text)) continue;
    const clicked = await clickBtn(text);
    if (clicked) await testPage(`MES: ${text}`);
  }

  // === Dashboard (总览) sub-sections ===
  await clickBtn('总览');
  await testPage('Dashboard Tab');

  const dashTexts = await getAllButtonTexts();
  console.log('\n  Dashboard buttons:', dashTexts.join(', '));

  const dashSkip = ['总览', 'WMS 物料', 'MES 执行', '退出'];
  for (const text of dashTexts) {
    if (dashSkip.includes(text)) continue;
    const clicked = await clickBtn(text);
    if (clicked) await testPage(`Dash: ${text}`);
  }

  await browser.close();

  // Summary
  console.log('\n=== FINAL SUMMARY ===');
  let pass = results.filter(r => r.errorCount === 0).length;
  let warn = results.filter(r => r.errorCount > 0 && r.errorCount < 99).length;
  let fail = results.filter(r => r.errorCount >= 99).length;
  console.log(`Total: ${results.length} | ✅ ${pass} | ⚠️ ${warn} | ❌ ${fail}`);
  if (warn > 0) {
    console.log('\n⚠️ Pages with errors:');
    results.filter(r => r.errorCount > 0).forEach(r => {
      console.log(`  [${r.label}]: ${r.errors.join('; ')}`);
    });
  }
  console.log('\nAll tested pages:');
  results.forEach(r => {
    const icon = r.errorCount === 0 ? '✅' : '⚠️';
    console.log(`  ${icon} ${r.label}`);
  });
})();
