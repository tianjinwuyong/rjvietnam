const { chromium } = require('playwright');
const http = require('http');
const { Pool } = require('pg');

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

async function runLiveUpdate() {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, material_code, assigned_operator
      FROM material_dispatch_assignments
      WHERE dispatch_session_id = 4 AND status = 'pending'
      ORDER BY assigned_operator, id
      LIMIT 8
    `);

    const byOp = { 'Li Na': [], 'Wang Qiang': [] };
    for (const row of result.rows) {
      if (byOp[row.assigned_operator] && byOp[row.assigned_operator].length < 4) {
        byOp[row.assigned_operator].push(row);
      }
    }

    for (const op of ['Li Na', 'Wang Qiang']) {
      for (const a of byOp[op]) {
        await client.query(`UPDATE material_dispatch_assignments SET status='loaded',loaded_at=NOW(),updated_at=NOW() WHERE id=$1`, [a.id]);
        console.log(`Loaded: ${a.material_code} by ${op}`);
        await postJson('/api/pda/events', { from: 'test', type: 'MATERIAL_LOADED', payload: { sessionId: 4, workOrderCode: '26061010006', materialCode: a.material_code, operator: op, assignmentId: a.id } });
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--remote-debugging-port=9271']
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

  // Navigate
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
  await page.waitForTimeout(5000);

  // Baseline
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\dispatch_t0_baseline.png', fullPage: true });
  console.log('t0: baseline saved');

  // Start live update in background and take screenshots
  const updatePromise = runLiveUpdate();

  // Wait and take screenshots as events fire
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\dispatch_t1_after.png', fullPage: true });
  console.log('t1: after first loads saved');

  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\dispatch_t2_mid.png', fullPage: true });
  console.log('t2: mid saved');

  await updatePromise;

  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'C:\\Users\\tianj\\Desktop\\dispatch_t3_final.png', fullPage: true });
  console.log('t3: final saved');

  await browser.close();
  console.log('Done!');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
