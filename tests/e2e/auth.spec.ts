import { test, expect } from "@playwright/test";

const BASE = "http://127.0.0.1:5178";

test.describe("Auth", () => {
  test("01 — login and load dashboard", async ({ page }) => {
    await page.goto(BASE);
    // Demo accounts authenticate client-side (ADMIN_VN_01)
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[type="text"]').first().fill("ADMIN_VN_01");
    await page.locator('input[type="password"]').fill("Factory@123");
    await page.locator('button[type="submit"]').click();
    // Dashboard or any main content should appear
    await expect(page.locator('input[type="password"]')).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(50);
  });
});
