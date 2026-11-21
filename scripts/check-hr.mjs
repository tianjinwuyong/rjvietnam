import { chromium } from '@playwright/test';

async function run() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  console.log('Page loaded');

  // Login
  const inputs = page.locator('input');
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const placeholder = await inputs.nth(i).getAttribute('placeholder');
    const type = await inputs.nth(i).getAttribute('type');
    if (placeholder?.includes('用户名') || placeholder?.includes('用户') || type === 'text') {
      await inputs.nth(i).fill('ADMIN_VN_01');
    } else if (type === 'password') {
      await inputs.nth(i).fill('Factory@123');
    }
  }
  
  const loginBtn = page.locator('button').filter({ hasText: /登录|Sign in|Đăng nhập/ }).first();
  if (await loginBtn.isVisible()) {
    await loginBtn.click();
    await page.waitForTimeout(2000);
    console.log('Logged in');
  }

  // Click 人事 sidebar nav
  const hrNav = page.locator('nav a, nav button, nav span').filter({ hasText: '人事' }).first();
  if (await hrNav.isVisible()) {
    await hrNav.click();
    await page.waitForTimeout(1500);
    console.log('Clicked 人事 nav');
  }

  // Click 组织架构 tab
  const orgTab = page.locator('button, a, div[role="tab"]').filter({ hasText: /组织架构|Org Chart/ }).first();
  if (await orgTab.isVisible()) {
    await orgTab.click();
    await page.waitForTimeout(1000);
    console.log('Clicked 组织架构 tab');
  }

  // Take screenshot of tree view first
  await page.screenshot({ path: 'hr-org-tree.png', fullPage: true });
  console.log('Tree view screenshot saved');

  // Click 3D图示 / Diagram button
  const diagramBtn = page.locator('button').filter({ hasText: /3D|图示|Diagram/ }).first();
  if (await diagramBtn.isVisible()) {
    await diagramBtn.click();
    await page.waitForTimeout(3000); // wait for Three.js to render
    console.log('Switched to 3D diagram view');
  }

  // Take screenshot of 3D view
  await page.screenshot({ path: 'hr-org-3d.png', fullPage: true });
  console.log('3D view screenshot saved');

  const body = await page.locator('body').innerText();
  console.log('=== PAGE BODY ===');
  console.log(body.substring(0, 2000));

  // Check for 3D canvas
  const canvas = await page.$('canvas');
  if (canvas) {
    console.log('3D Canvas found! Three.js org chart is rendering.');
    const box = await canvas.boundingBox();
    console.log('Canvas size:', box?.width, 'x', box?.height);
  } else {
    console.log('No Three.js canvas found on page');
  }

  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });
