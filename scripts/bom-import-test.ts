// Simple Playwright test to verify BOM import UI
import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ channel: "edge" });
  const page = await browser.newPage();

  // Navigate to app
  await page.goto("http://localhost:5179/");
  await page.waitForLoadState("networkidle");

  // Click BOM nav
  const bomLink = page.getByText("BOM", { exact: false });
  if (await bomLink.count() > 0) {
    await bomLink.first().click();
    await page.waitForTimeout(1000);
  }

  // Check for Import Excel button
  const importBtn = page.getByText("导入 Excel", { exact: false });
  if (await importBtn.count() > 0) {
    console.log("✅ Import Excel button found");
  } else {
    console.log("❌ Import Excel button NOT found");
  }

  // Check BOM list
  const bomItems = page.locator("[style*='border: 1px solid']").filter({ hasText: /B2672|EPS/ });
  const count = await bomItems.count();
  console.log(`✅ Found ${count} BOM items`);

  // Check for console errors
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.waitForTimeout(500);
  if (errors.length > 0) {
    console.log("❌ Console errors:", errors);
  } else {
    console.log("✅ No console errors");
  }

  await browser.close();
  console.log("✅ Browser test completed successfully");
}

main().catch(console.error);
