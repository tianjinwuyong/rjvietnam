import { test, expect, chromium } from '@playwright/test';

test.describe('MES 手动线 3D Manual Line', () => {
  test('loads 3D scene without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Login
    await page.goto('http://localhost:5178/');
    await page.waitForLoadState('networkidle');
    await page.fill('input[placeholder="用户名"], input[name="username"]', 'ADMIN_VN_01');
    await page.fill('input[type="password"]', 'Factory@123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    // Navigate to manual line
    await page.goto('http://localhost:5178/mes/mes-manual-line');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // Check page loaded
    const url = page.url();
    console.log('Current URL:', url);

    // Check for canvas (3D scene)
    const canvas = page.locator('canvas');
    const canvasCount = await canvas.count();
    console.log('Canvas elements:', canvasCount);

    // Report errors
    const realErrors = consoleErrors.filter(e => !e.includes('favicon'));
    console.log('Console errors:', realErrors.length);
    realErrors.forEach(e => console.log(' -', e.substring(0, 200)));

    // Take screenshot
    await page.screenshot({ path: 'test-3d-manual-line.png', fullPage: false });
    console.log('Screenshot saved: test-3d-manual-line.png');

    // Assertions
    expect(canvasCount).toBeGreaterThan(0);
    expect(realErrors.length).toBe(0);
  });
});
