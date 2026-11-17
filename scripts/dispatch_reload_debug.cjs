const { chromium } = require('playwright');
const http = require('http');
const { Pool } = require('pg');

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost', port: 8080, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9273']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Collect console errors
  const consoleLogs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleLogs.push(`[ERROR] ${msg.text()}`);
  });

  // Login
  await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Navigate to dispatch board and open session
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MES 执行'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('物料配送'));
    if (btn) { btn.scrollIntoView({ behavior: 'smooth', inline: 'center' }); setTimeout(() => btn.click(), 500); }
  });
  await page.waitForTimeout(4000);
  await page.locator('article').filter({ hasText: '26061010006' }).first().click({ force: true });
  await page.waitForTimeout(5000);

  // Inject a counter to track re-renders
  const count = await page.evaluate(() => {
    // Try to find the React component state by looking at DOM changes
    const text = document.body.innerText;
    const match = text.match(/已上料[\s\S]*?(\d+)/);
    return match ? match[1] : 'not found';
  });
  console.log('Initial 已上料:', count);

  // Inject SSE listener to track events
  await page.evaluate(() => {
    window.__sseEvents = [];
    window.__originalOnMsg = null;
    console.log('SSE debug ready');
  });

  // Wait for any background SSE events
  await page.waitForTimeout(2000);

  // Fire loading event
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const client = await pool.connect();
  const result = await client.query(`SELECT id, material_code, assigned_operator FROM material_dispatch_assignments WHERE dispatch_session_id=4 AND status='pending' LIMIT 1`);
  if (result.rows.length > 0) {
    const row = result.rows[0];
    await client.query(`UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.id]);
    await postJson('/api/pda/events', { from: 'test', type: 'MATERIAL_LOADED', payload: { sessionId: 4, workOrderCode: '26061010006', operator: row.assigned_operator, materialCode: row.material_code } });
    console.log('Fired MATERIAL_LOADED for', row.material_code);
  }
  await client.release();
  await pool.end();

  // Wait for potential re-render
  await page.waitForTimeout(5000);

  const after = await page.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/已上料[\s\S]*?(\d+)/);
    return match ? match[1] : 'not found';
  });
  console.log('After reload 已上料:', after);
  console.log('Changed:', count !== after);

  console.log('\nConsole errors:', consoleLogs.length);
  consoleLogs.forEach(e => console.log(' ', e));

  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
