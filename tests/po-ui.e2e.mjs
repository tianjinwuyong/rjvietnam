import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

try {
  await page.goto(process.env.TEST_WEB_URL ?? "http://127.0.0.1:5178/", {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  const quickLogin = page.getByRole("button", { name: /蒙营|MENG_YING/ }).first();
  if (await quickLogin.count()) {
    await quickLogin.click();
  } else {
    const inputs = page.locator("input");
    assert.ok(await inputs.count() >= 2, "login fields must be visible");
    await inputs.nth(0).fill("MENG_YING");
    await inputs.nth(1).fill("my");
    await page.getByRole("button", { name: /登录|Sign in/i }).click();
  }
  await page.waitForTimeout(1_000);
  const pmcNav = page.getByRole("button", { name: /PMC 工单|PMC Orders/i }).first();
  assert.ok(await pmcNav.count(), "PMC navigation must be visible to superadmin");
  await pmcNav.click();
  await page.waitForTimeout(1_000);
  const poTab = page.getByRole("button", { name: /PO 管理|PO Management/i }).first();
  assert.ok(await poTab.count(), "Customer PO tab must be visible");
  await poTab.click();
  await page.waitForTimeout(1_000);
  const createPo = page.getByRole("button", { name: "创建客户 PO" }).first();
  assert.ok(await createPo.count(), "Customer PO creation entry must be visible");
  const closureCheck = page.getByRole("button", { name: "闭环检查" }).first();
  if (await closureCheck.count()) {
    await closureCheck.click();
    await page.waitForTimeout(500);
  }
  const bodyText = await page.locator("body").innerText();
  assert.match(bodyText, /PO 管理|PO Management/i, "PMC must show customer PO area");
  if (await closureCheck.count()) {
    assert.match(bodyText, /PO 闭环控制|PO Closure/i, "PMC must expose PO closure workflow");
    assert.match(bodyText, /WO_LINKED/, "Closure gate list must be rendered");
  }
  assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, url: page.url(), title: await page.title() }));
} finally {
  await browser.close();
}
