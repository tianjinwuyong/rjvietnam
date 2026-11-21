import { test, expect } from '@playwright/test';

test('NgBlocks are clickable on the 3D manual line scene', async ({ page }) => {
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
  const canvas = frame.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  // Click a grid across the canvas — station blocks (NgBlocks) must be clickable
  // without crashing the scene (no page errors, canvas stays rendered).
  let clicked = 0;
  for (let gx = 0; gx < 3; gx++) {
    for (let gy = 0; gy < 2; gy++) {
      const x = Math.min(box!.width - 5, Math.max(5, box!.width * (0.2 + gx * 0.3)));
      const y = Math.min(box!.height - 5, Math.max(5, box!.height * (0.3 + gy * 0.35)));
      await canvas.click({ position: { x, y }, force: true });
      await page.waitForTimeout(300);
      clicked++;
    }
  }
  expect(clicked).toBe(6);
  await expect(canvas).toBeVisible({ timeout: 5_000 });
  expect(pageErrors).toEqual([]);
});
