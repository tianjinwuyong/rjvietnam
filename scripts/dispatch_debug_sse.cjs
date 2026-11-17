const { chromium } = require('playwright');
const http = require('http');

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost', port: 8080, path,
      method: 'POST',
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
    args: ['--remote-debugging-port=9272']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Collect all SSE messages
  const sseMessages = [];
  await page.exposeFunction('onSSEMessage', (msg) => sseMessages.push(msg));

  // Intercept SSE events
  await page.route('**/api/pda/events*', async route => {
    const client = await route.request().intercept();
    client.on('event', event => {
      page.evaluate(`window.onSSEMessage(${JSON.stringify(event.data)})`);
    });
    client.respond(route.request().continue());
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

  // Get initial loaded count
  const getLoadedCount = async () => {
    return await page.evaluate(() => {
      const el = document.querySelector('.stat-value, [class*="stat"]');
      const allText = document.body.innerText;
      const match = allText.match(/已上料[\s\S]*?(\d+)/);
      return match ? match[1] : 'not found';
    });
  };

  const initial = await getLoadedCount();
  console.log('Initial loaded count:', initial);
  console.log('SSE messages so far:', sseMessages.length);

  // Fire 2 loading events
  const { Pool } = require('pg');
  const pool = new (require('pg').Pool)({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const client = await pool.connect();

  const result = await client.query(`SELECT id, material_code, assigned_operator FROM material_dispatch_assignments WHERE dispatch_session_id = 4 AND status = 'pending' ORDER BY id LIMIT 2`);
  console.log('Pending to load:', result.rows.map(r => r.material_code));

  for (const row of result.rows) {
    await client.query(`UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.id]);
    await postJson('/api/pda/events', { from: 'test', type: 'MATERIAL_LOADED', payload: { sessionId: 4, workOrderCode: '26061010006', materialCode: row.material_code, operator: row.assigned_operator } });
    console.log('Fired MATERIAL_LOADED for', row.material_code);
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\nSSE messages received:', sseMessages.length);
  sseMessages.forEach((m, i) => console.log(`  SSE[${i}]:`, m));

  const after = await getLoadedCount();
  console.log('\nLoaded count after:', after);

  await client.release();
  await pool.end();
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
