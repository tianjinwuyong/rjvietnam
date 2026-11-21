import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));

try {
  await page.goto(process.env.TEST_WEB_URL ?? "http://192.168.6.155:5178/", {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  const quickLogin = page.locator(".auth-panel").nth(1).locator("button").first();
  assert.equal(await quickLogin.count(), 1, "factory-manager quick-login button must exist");
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/auth/login") && response.request().method() === "POST",
  );
  await quickLogin.click();
  const response = await responsePromise;
  const loginPayload = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(loginPayload));
  assert.equal(loginPayload.data.user.displayName, "蒙营");
  assert.equal(loginPayload.data.user.roleKey, "admin");
  await page.getByRole("button", { name: /PMC 工单|PMC Orders/i }).waitFor({ timeout: 10_000 });
  assert.deepEqual(failures, [], failures.join(" | "));

  const chineseLoginResponse = await page.request.post("http://192.168.6.155:8080/auth/login", {
    data: { username: "蒙营", password: "my" },
  });
  const chinesePayload = await chineseLoginResponse.json();
  assert.equal(chineseLoginResponse.status(), 200, JSON.stringify(chinesePayload));
  assert.equal(chinesePayload.data.user.username, "MENG_YING");
  assert.equal(chinesePayload.data.user.displayName, "蒙营");
  console.log(JSON.stringify({ ok: true, quickLogin: true, chineseLogin: true, url: page.url() }));
} finally {
  await browser.close();
}
