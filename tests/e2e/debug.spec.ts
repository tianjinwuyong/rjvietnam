import { test, expect } from "@playwright/test";

const BASE = "http://127.0.0.1:5178";

test("debug — inspect page", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30_000 });
  const url = page.url();
  const title = await page.title();
  const bodyText = await page.locator("body").innerText().catch(() => "ERROR");
  const html = await page.locator("html").innerHTML().catch(() => "ERROR");
  
  console.log("URL:", url);
  console.log("Title:", title);
  console.log("Body text (first 500):", bodyText.slice(0, 500));
  console.log("HTML (first 1000):", html.slice(0, 1000));
  
  // Take screenshot
  await page.screenshot({ path: "tests/e2e/debug-screenshot.png" });
  
  // Check if there are any inputs
  const inputs = await page.locator("input").count();
  console.log("Input count:", inputs);
  
  // Try demo account quick login button
  const demoBtn = page.locator("button").filter({ hasText: /admin|demo|sign.?in/i }).first();
  if (await demoBtn.count() > 0) {
    console.log("Found demo button:", await demoBtn.innerText());
    await demoBtn.click();
    await page.waitForTimeout(2000);
    const bodyAfter = await page.locator("body").innerText();
    console.log("Body after demo click:", bodyAfter.slice(0, 500));
  }
});
