import { test, expect } from "@playwright/test";

test("WMS receiving stays stable and exposes OCR after refresh", async ({ page }) => {
  const liveStateRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/api/wms/receiving/live-state")) liveStateRequests.push(request.url());
  });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/?view=wms&wmsTab=materialReceiving", { waitUntil: "domcontentloaded" });
  const quickLogin = page.getByRole("button", { name: /仓库|warehouse/i }).first();
  if (await page.locator('input[type="password"]').isVisible().catch(() => false)) await quickLogin.click();

  await expect(page.getByRole("heading", { name: /PDA物料标签大图OCR|PDA Material Label OCR/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /打开PDA相机|Open PDA camera/i })).toBeVisible();
  await page.waitForTimeout(6_000);

  // React StrictMode mounts effects twice in development; there must be no
  // continuing one-second poll after those two initial restores.
  expect(liveStateRequests.length).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("WMS OCR accepts a label image and shows the extracted result", async ({ page }) => {
  await page.goto("/?view=wms&wmsTab=materialReceiving", { waitUntil: "domcontentloaded" });
  const quickLogin = page.getByRole("button", { name: /仓库|warehouse/i }).first();
  if (await page.locator('input[type="password"]').isVisible().catch(() => false)) await quickLogin.click();
  const input = page.getByLabel(/上传标签图片|Upload label image/i);
  await expect(input).toBeAttached({ timeout: 15_000 });
  const response = page.waitForResponse(item => item.url().includes("/wms/receiving/label-ai") && item.request().method() === "POST", { timeout: 120_000 });
  await input.setInputFiles("C:/Users/tianj/AppData/Local/Temp/orca-paste-1788514737154-b0353d07-bee9-41ee-a0f5-3cdef79efa2a.png");
  await expect(page.locator('img[alt="Material label"]')).toBeVisible();
  const ocrResponse = await response;
  expect(ocrResponse.ok()).toBeTruthy();
  console.log("OCR_RESPONSE", JSON.stringify(await ocrResponse.json()));
  await expect(page.getByText(/OCR识别结果|OCR result/i)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByLabel("Ruijing material code")).toHaveValue("R0312-01001");
  await expect(page.getByLabel(/Lot|批次/i)).toHaveValue("20260731");
  await expect(page.getByLabel(/Supplier barcode|供应商条码/i)).toHaveValue("CN075126073100046");
});
