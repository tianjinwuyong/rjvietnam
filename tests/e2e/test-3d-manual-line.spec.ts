import { test, expect } from '@playwright/test';

test('MES 手动线 3D scene loads without errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // Login (zh-CN UI, locale-agnostic selectors)
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('input[type="text"]').first().fill('ADMIN_VN_01');
  await page.locator('input[type="password"]').fill('Factory@123');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1500);

  // Navigate to the manual-line 3D scene (rendered inside an iframe)
  await page.goto('/?view=mes&mesTab=manualLine3d');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(6000);

  const frame = page.frameLocator('iframe[src*="manual-line-video-3d"]');
  await expect(frame.locator('canvas')).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('body')).toContainText('手动线 · 现场三维实时生产线', { timeout: 5_000 });

  // No JS exceptions: the scene's own error overlay would otherwise replace the canvas.
  // (Station-data polling 404/503 for offline factory machines is expected/environmental.)
  expect(pageErrors.filter((e) => !/net::|Failed to fetch/i.test(e))).toEqual([]);
});
