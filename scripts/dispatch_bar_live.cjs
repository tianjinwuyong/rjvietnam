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
    args: ['--remote-debugging-port=9277']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

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

  // Open session
  await page.locator('article').filter({ hasText: '26061010006' }).first().click({ force: true });
  await page.waitForTimeout(6000);

  const getState = async () => {
    return await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        loaded: text.match(/已上料[\s]*(\d+)/)?.[1] ?? '?',
        pdas: text.match(/PDA数[\s]*(\d+)/)?.[1] ?? '?',
      };
    });
  };

  // Baseline
  const before = await getState();
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\bar_t0.png', fullPage: true });
  console.log('t0:', JSON.stringify(before));

  // Load 3 materials for different operators
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const client = await pool.connect();
  const r = await client.query(`SELECT id, material_code, assigned_operator FROM material_dispatch_assignments WHERE dispatch_session_id=4 AND status='pending' ORDER BY assigned_operator LIMIT 3`);
  for (const row of r.rows) {
    await client.query(`UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.id]);
    await postJson('/api/pda/events', { from: 'test', type: 'MATERIAL_LOADED', payload: { sessionId: 4, workOrderCode: '26061010006', operator: row.assigned_operator, materialCode: row.material_code } });
    console.log('Loaded:', row.assigned_operator, row.material_code);
    await new Promise(res => setTimeout(res, 3000));
    await page.screenshot({ path: `C:\\Users\\tianj\\Desktop\\bar_t1_${row.material_code}.png`, fullPage: true });
    const s = await getState();
    console.log('  State:', JSON.stringify(s));
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\bar_t_final.png', fullPage: true });
  const after = await getState();
  console.log('Final:', JSON.stringify(after));

  await client.release();
  await pool.end();
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
