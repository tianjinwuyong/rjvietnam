import { chromium } from '@playwright/test';

const CHROMIUM_PATH = 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe';

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  // Login
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.fill('input[placeholder*="用户名"], input[type="text"]', 'ADMIN_VN_01');
  await page.fill('input[type="password"]', 'Factory@123');
  await page.getByRole('button', { name: /登录|Sign in|Đăng nhập/ }).first().click();
  await page.waitForTimeout(2000);

  // Click 人事 nav
  const hrBtn = page.locator('nav a, nav button').filter({ hasText: /人事|HR/ }).first();
  if (await hrBtn.isVisible()) {
    await hrBtn.click();
    await page.waitForTimeout(1500);
    console.log('Clicked HR nav');
  } else {
    console.log('HR nav not found, checking page...');
    const navText = await page.locator('nav').innerText();
    console.log('NAV:', navText.substring(0, 800));
  }

  await page.waitForTimeout(1000);
  const bodyText = await page.locator('body').innerText();
  console.log('=== PAGE BODY ===');
  console.log(bodyText.substring(0, 2000));

  // Check for org chart tab/button
  const orgChartBtn = page.locator('button, a, div[role="tab"]').filter({ hasText: /组织|org|chart|3D|图示|diagram/i }).first();
  if (await orgChartBtn.isVisible()) {
    console.log('Found org chart button, clicking...');
    await orgChartBtn.click();
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: 'hr-3d-org.png', fullPage: true });
  console.log('Screenshot saved to hr-3d-org.png');

  // Check for 3D canvas
  const canvas = await page.$('canvas');
  if (canvas) {
    console.log('3D Canvas found! Org chart is rendering in 3D.');
  } else {
    console.log('No 3D canvas found on page.');
  }

  await browser.close();
}

run().catch(console.error);
