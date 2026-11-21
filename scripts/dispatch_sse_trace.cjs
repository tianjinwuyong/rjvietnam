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
    args: ['--remote-debugging-port=9274']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Track ALL network requests
  const requests = [];
  page.on('request', req => {
    if (req.url().includes('pda/events')) requests.push({ type: 'send', url: req.url() });
  });
  page.on('response', res => {
    if (res.url().includes('pda/events')) requests.push({ type: 'recv', url: res.url(), status: res.status() });
  });

  // Login
  await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.locator('input[placeholder="用户名"]').fill('ADMIN_VN_01');
  await page.locator('input[placeholder="密码"]').fill('Factory@123');
  await page.locator('button:has-text("登录")').click();
  await page.waitForTimeout(3000);

  // Navigate to dispatch board
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

  // Clear requests and click session
  requests.length = 0;
  await page.locator('article').filter({ hasText: '26061010006' }).first().click({ force: true });
  await page.waitForTimeout(3000);

  // Get initial count
  const getCount = () => page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/已上料[\s\S]*?(\d+)/);
    return m ? m[1] : '?';
  });
  const before = await getCount();
  console.log('Before:', before);
  console.log('SSE connections established:', requests.filter(r => r.type === 'send' && r.url.includes('GET')).length);

  // DB: load 1 material
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const client = await pool.connect();
  const r = await client.query(`SELECT id, material_code, assigned_operator FROM material_dispatch_assignments WHERE dispatch_session_id=4 AND status='pending' LIMIT 1`);
  if (r.rows.length > 0) {
    const row = r.rows[0];
    await client.query(`UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.id]);
    console.log('DB updated:', row.material_code);
  }
  await client.release();
  await pool.end();

  // Fire SSE
  await postJson('/api/pda/events', { from: 'test', type: 'MATERIAL_LOADED', payload: { sessionId: 4, workOrderCode: '26061010006', operator: 'Li Na' } });
  console.log('SSE event fired');
  requests.length = 0;

  // Wait for potential re-render
  await page.waitForTimeout(5000);
  const after = await getCount();
  console.log('After:', after);
  console.log('Changed:', before !== after);

  console.log('SSE connections after event:', requests.filter(r => r.type === 'send' && r.url.includes('GET')).length);
  requests.filter(r => r.type === 'recv').forEach(r => console.log('  SSE response:', r.status));

  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
