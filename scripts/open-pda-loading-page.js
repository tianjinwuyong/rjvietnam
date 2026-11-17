import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });
  await page.goto(
    `http://localhost:5178/?view=wms&wmsTab=materialLoading&v=${Date.now()}`,
    { waitUntil: "domcontentloaded" },
  );
  const managerLogin = page.locator("button.auth-account").filter({ hasText: "MENG_YING" });
  if (await managerLogin.count()) {
    await managerLogin.click();
  }
  await page.waitForSelector("text=PDA 上料追溯", { timeout: 15000 });
  await page.bringToFront();
  await new Promise((resolve) => browser.on("disconnected", resolve));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
