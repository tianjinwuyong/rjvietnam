import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(process.env.TEST_WEB_URL ?? "http://127.0.0.1:5178/", { waitUntil: "networkidle", timeout: 30_000 });
  const quick = page.getByRole("button", { name: /蒙营|MENG_YING/ }).first();
  if (await quick.count()) await quick.click();
  else {
    await page.locator("input").nth(0).fill("蒙营");
    await page.locator("input").nth(1).fill("my");
    await page.locator("form button[type=submit]").click();
  }
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /PMC 工单|PMC Orders/i }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /客户\/产品管理|Customer\/Product Master/i }).first().click();
  await page.waitForTimeout(800);
  assert.match(await page.locator("body").innerText(), /客户与产品主数据中心/);
  assert.match(await page.locator("body").innerText(), /NetBit/);
  assert.match(await page.locator("body").innerText(), /Anker/);
  await page.getByRole("button", { name: "产品管理", exact: true }).click();
  const body = await page.locator("body").innerText();
  for (const code of ["EPS48R1-36", "EPS18R1G-36", "EPS36R0-36", "B2672111", "B2672121"]) {
    assert.match(body, new RegExp(code));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, page: "客户与产品主数据中心", customers: 2, products: 5 }));
} finally {
  await browser.close();
}
