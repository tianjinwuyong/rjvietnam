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
    args: ['--remote-debugging-port=9276']
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

  // Check initial state
  const getStats = async () => {
    return await page.evaluate(() => {
      const text = document.body.innerText;
      const loaded = text.match(/已上料[\s]*(\d+)/)?.[1] ?? '?';
      const pdas = text.match(/PDA数[\s]*(\d+)/)?.[1] ?? '?';
      const hasOpSection = text.includes('操作员进度');
      const opNames = (text.match(/Zhang Wei|Li Na|Wang Qiang|Chen Jie/g) || []);
      return { loaded, pdas, hasOpSection, opNames };
    });
  };

  const before = await getStats();
  console.log('Before:', JSON.stringify(before));

  // Get 2 pending assignments
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const client = await pool.connect();
  const r = await client.query(`SELECT id, material_code, assigned_operator FROM material_dispatch_assignments WHERE dispatch_session_id=4 AND status='pending' LIMIT 2`);
  console.log('Will load:', r.rows.map(x => `${x.assigned_operator}:${x.material_code}`));

  for (const row of r.rows) {
    await client.query(`UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.id]);
    await postJson('/api/pda/events', { from: 'test', type: 'MATERIAL_LOADED', payload: { sessionId: 4, workOrderCode: '26061010006', operator: row.assigned_operator, materialCode: row.material_code } });
    console.log('Fired:', row.material_code);
    await new Promise(r => setTimeout(r, 3000));
  }

  // Wait for polling to kick in
  await page.waitForTimeout(6000);
  const after = await getStats();
  console.log('After:', JSON.stringify(after));
  console.log('Stats changed:', before.loaded !== after.loaded);

  await client.release();
  await pool.end();
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
