import { test, expect } from '@playwright/test';

test('MES exposes separate manual-line and auto-line 3D buttons', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.fill('input[name="username"], input[type="text"]', 'ADMIN_VN_01');
  await page.fill('input[type="password"]', 'Factory@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(800);
  await page.goto('/?view=mes&mesTab=overview');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('button', { name: 'Manual Line 3D' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto Line 3D' })).toBeVisible();
});
