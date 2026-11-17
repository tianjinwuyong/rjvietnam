import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:5178/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[type="text"], input:not([type])').first();
  const password = page.locator('input[type="password"]').first();
  if (await password.isVisible().catch(() => false)) {
    await username.fill("MENG_YING");
    await password.fill("my");
    await page.locator('button[type="submit"]').click();
  }
  await page.waitForTimeout(1200);
  const procurementNav = page.getByText(/采购|procurement/i).first();
  if (!(await procurementNav.isVisible().catch(() => false))) {
    throw new Error(`Procurement navigation missing. Page text: ${(await page.locator("body").innerText()).slice(0, 1200)}`);
  }
  await procurementNav.click();
  await page.getByRole("button", { name: /询价与比价/ }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /询价与比价/ }).click();
  await page.getByText("RFQ号", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /采购订单/ }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: /采购订单/ }).first().click();
  await page.getByText("闭环检查", { exact: true }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: /采购订单/ }).first().click().catch(() => {});
  assert.equal(errors.some(x => /useState|null|suspend/i.test(x)), false, errors.join("\n"));
  console.log(JSON.stringify({ ok: true, procurementVisible: true, rfqVisible: true, poClosureVisible: true, pageErrors: errors }));
} finally {
  await browser.close();
}
