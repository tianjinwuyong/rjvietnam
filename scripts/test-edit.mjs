import { chromium } from '@playwright/test';

async function run() {
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const logs = [];
  p.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  p.on('pageerror', err => logs.push(`[CRASH] ${err.message}`));

  await p.goto('http://localhost:5178');
  await p.waitForLoadState('networkidle');

  // Login
  await p.locator('button').filter({ hasText: 'Admin 01' }).first().click();
  await p.waitForTimeout(2000);

  // Navigate to 人事 > 组织架构 > 架构图
  await p.locator('text=人事').first().click();
  await p.waitForTimeout(1000);
  await p.locator('button, div[role="tab"]').filter({ hasText: '组织架构' }).first().click();
  await p.waitForTimeout(1000);
  await p.locator('button').filter({ hasText: /架构图|3D|Diagram/ }).first().click();
  await p.waitForTimeout(3000);

  // Check for 401 or auth errors before editing
  const authErrorsBefore = logs.filter(l => l.includes('401') || l.includes('Unauthorized') || l.includes('auth'));
  console.log('Auth errors before edit:', authErrorsBefore.length);

  // Click the + 新建 button to test creation
  const createBtn = p.locator('button').filter({ hasText: '+ 新建' }).first();
  if (await createBtn.isVisible()) {
    await createBtn.click();
    await p.waitForTimeout(1000);
    
    // Fill in form
    const codeInput = p.locator('input').first();
    if (await codeInput.isVisible()) {
      await codeInput.fill('TEST');
      const nameInputs = await p.locator('input[type="text"]').all();
      if (nameInputs.length >= 2) {
        await nameInputs[1].fill('测试部门');
      }
      
      // Click save
      const saveBtn = p.locator('button[type="submit"]').filter({ hasText: /保存|Save/ }).first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await p.waitForTimeout(1000);
      }
    }
  }

  // Check for auth errors after edit
  const authErrorsAfter = logs.filter(l => l.includes('401') || l.includes('Unauthorized') || l.includes('auth'));
  console.log('Auth errors after edit:', authErrorsAfter.length);
  for (const l of logs) console.log(l);

  await b.close();
}

run().catch(e => { console.error(e); process.exit(1); });
