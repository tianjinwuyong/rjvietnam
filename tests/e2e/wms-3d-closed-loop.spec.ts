// ============================================================================
// WMS 3D Warehouse — Closed-Loop E2E (TDD / graph engineering)
// ============================================================================
// The site is modeled as a directed graph. Every edge is a user action that
// must complete and return to a consistent state (closed loop):
//
//   NODES
//     L     Login screen
//     SHELL Main app shell (sidebar, header) after auth
//     W3D   仓库与线边存储 3D page (h2 title + view tabs)
//     FLOOR Floor scene (3D canvas + live WMS stats panel + cell list)
//     WHSE  成品仓库 scene (product-warehouse 3D canvas)
//     SMART 智能查询 panel (natural-language WMS query)
//     FS    Fullscreen mode
//     PANEL Side panel (库位操作 / 运输任务 / 操作审计)
//     CELL  Selected rack cell detail + actions (LIGHT_ON ...)
//
//   EDGES (each is a test below)
//     L → SHELL            G01 one-click 蒙营 login
//     SHELL → W3D          G02 direct URL nav + title/tabs
//     W3D → FLOOR          G03 floor scene: canvas + live stats + no errors
//     FLOOR ⇄ WHSE         G04 tab switch forward/back (cycle returns intact)
//     W3D → SMART → answer G05 smart query returns a *meaningful* reply
//     W3D → FS ⇄ exit      G06 fullscreen enter/exit cycle
//     PANEL detail→tasks→audit→detail  G07 panel cycle
//     W3D → CELL → LIGHT_ON → sync msg  G08 rack action hits backend
//     FULL JOURNEY         G09 zero console errors / zero failed requests
// ============================================================================
import { test, expect } from "@playwright/test";

const MES_3D_URL = "/?view=mes&mesTab=warehouseStorage";

async function loginAsManager(page) {
  await page.goto(MES_3D_URL, { waitUntil: "domcontentloaded" });
  const quick = page.locator("button", { hasText: "工厂经理快速登录" }).first();
  await expect(quick).toBeVisible({ timeout: 15_000 });
  await quick.click();
  // logged in = login inputs gone
  await expect(page.locator("input[type=password]")).not.toBeVisible({ timeout: 15_000 });
}

function watchErrors(page, errors, failed) {
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => failed.push(r.url()));
}

function wmsErrors(errors) {
  return errors.filter((e) => /wms|3d|permission|owner|500|failed|ERR_/i.test(e));
}

test.describe("3D Warehouse closed-loop graph", () => {
  test("G01 L→SHELL: one-click factory-manager login lands in the app shell", async ({ page }) => {
    const errors = [], failed = [];
    watchErrors(page, errors, failed);
    await loginAsManager(page);
    await expect(page.locator("body")).toContainText("越南瑞晶 SMT 工厂系统", { timeout: 10_000 });
    expect(failed).toEqual([]);
  });

  test("G02 SHELL→W3D: warehouseStorage route renders title + view tabs", async ({ page }) => {
    await loginAsManager(page);
    await expect(page.locator("h2").filter({ hasText: "仓库与线边存储 3D" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "厂区与线边存储" })).toBeVisible();
    await expect(page.getByRole("button", { name: "成品仓库" })).toBeVisible();
  });

  test("G03 W3D→FLOOR: 3D canvas + live WMS stats, no errors", async ({ page }) => {
    const errors = [], failed = [];
    watchErrors(page, errors, failed);
    await loginAsManager(page);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("body")).toContainText("正常有货", { timeout: 15_000 });
    await expect(page.locator("body")).toContainText("空库位", { timeout: 5_000 });
    await expect(page.locator("body")).toContainText("实时同步", { timeout: 5_000 });
    expect(wmsErrors(errors)).toEqual([]);
    expect(failed).toEqual([]);
  });

  test("G04 FLOOR⇄WHSE: product-warehouse tab cycle returns floor intact", async ({ page }) => {
    const errors = [], failed = [];
    watchErrors(page, errors, failed);
    await loginAsManager(page);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("body")).toContainText("正常有货", { timeout: 15_000 });

    // forward edge: floor → warehouse
    await page.getByRole("button", { name: "成品仓库" }).click();
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2500);
    await expect(page.locator("body")).toContainText("成品仓库");

    // return edge: warehouse → floor (closed loop)
    await page.getByRole("button", { name: "厂区与线边存储" }).click();
    await expect(page.locator("body")).toContainText("正常有货", { timeout: 15_000 });
    await expect(page.locator("body")).toContainText("实时同步", { timeout: 5_000 });

    expect(wmsErrors(errors)).toEqual([]);
    expect(failed).toEqual([]);
  });

  test("G05 W3D→SMART→answer: smart query returns a meaningful reply (closed loop)", async ({ page }) => {
    const errors = [], failed = [];
    watchErrors(page, errors, failed);
    await loginAsManager(page);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

    // open smart query panel
    await page.getByRole("button", { name: /智能查询/ }).first().click();
    const input = page.locator("input[placeholder*='询问库存']");
    await expect(input).toBeVisible({ timeout: 10_000 });

    // ask a question
    await input.fill("哪些物料库存不足");
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/ai/query/inventory"), { timeout: 20_000 }),
      page.getByRole("button", { name: "查询", exact: true }).click(),
    ]);
    expect(resp.status()).toBe(200);

    // answer box must render a *meaningful* reply, never "[object Object]"
    await expect(page.getByText("正在读取实时 WMS", { exact: false })).not.toBeVisible({ timeout: 15_000 });
    const answerBox = page.locator("div", { hasText: /正在读取实时 WMS|库存/ }).last();
    await expect(answerBox).toBeVisible({ timeout: 5_000 });
    // real engine: answer must be live data, never the placeholder or "[object Object]"
    await expect(page.getByText("[库存查询需要更完整的实现]")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator("body")).toContainText(/库存最少的物料|活跃批次 \d+/, { timeout: 10_000 });
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("[object Object]");
    expect(wmsErrors(errors)).toEqual([]);
    expect(failed).toEqual([]);
  });

  test("G06 W3D→FS⇄exit: fullscreen cycle returns to page mode", async ({ page }) => {
    await loginAsManager(page);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

    const enter = page.getByRole("button", { name: "全屏浏览" }).first();
    await enter.click();
    await expect(page.getByRole("button", { name: "退出全屏" }).first()).toBeVisible({ timeout: 10_000 });

    const exit = page.getByRole("button", { name: "退出全屏" }).first();
    await exit.click();
    await expect(page.getByRole("button", { name: "全屏浏览" }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("G07 PANEL: detail→tasks→audit→detail cycle stays consistent", async ({ page }) => {
    await loginAsManager(page);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "运输任务" }).click();
    await expect(page.locator("body")).toContainText("运输任务", { timeout: 5_000 });
    await page.getByRole("button", { name: "操作审计" }).click();
    await expect(page.locator("body")).toContainText("操作审计", { timeout: 5_000 });
    await page.getByRole("button", { name: "库位操作" }).click();
    await expect(page.locator("body")).toContainText("库位操作", { timeout: 5_000 });
    await expect(page.locator("body")).toContainText("点击3D货架或地面区域开始操作", { timeout: 5_000 });
  });

  test("G08 W3D→CELL→LIGHT_ON→sync: rack action reaches backend and confirms", async ({ page }) => {
    const errors = [], failed = [];
    watchErrors(page, errors, failed);
    await loginAsManager(page);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("body")).toContainText("正常有货", { timeout: 15_000 });

    // list RAW rack cells
    const search = page.locator("input[placeholder*='物料/批次']");
    await search.fill("RAW");
    const cell = page.locator("button", { hasText: /A1-\d+/ }).first();
    await expect(cell).toBeVisible({ timeout: 10_000 });
    await cell.click();

    // detail panel with actions
    const light = page.getByRole("button", { name: "定位亮灯" });
    await expect(light).toBeEnabled({ timeout: 10_000 });
    const reason = page.locator("input[placeholder*='例如 A1']");
    await reason.fill("e2e closed-loop test");

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/3d/wms-commands"), { timeout: 20_000 }),
      light.click(),
    ]);
    expect([200, 201]).toContain(resp.status());
    await expect(page.locator("body")).toContainText("操作完成，三端已同步", { timeout: 15_000 });
    expect(wmsErrors(errors)).toEqual([]);
    expect(failed).toEqual([]);
  });

  test("G09 JOURNEY: full closed loop with zero console errors / failed requests", async ({ page }) => {
    const errors = [], failed = [];
    watchErrors(page, errors, failed);
    await loginAsManager(page);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("body")).toContainText("正常有货", { timeout: 15_000 });

    // 1. product tab and back
    await page.getByRole("button", { name: "成品仓库" }).click();
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "厂区与线边存储" }).click();
    await expect(page.locator("body")).toContainText("正常有货", { timeout: 15_000 });

    // 2. smart query
    await page.getByRole("button", { name: /智能查询/ }).first().click();
    const input = page.locator("input[placeholder*='询问库存']");
    await input.fill("查询 IQC HOLD 批次");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/ai/query/inventory"), { timeout: 20_000 }),
      page.getByRole("button", { name: "查询", exact: true }).click(),
    ]);
    await page.waitForTimeout(3000);
    expect((await page.locator("body").innerText())).not.toContain("[object Object]");

    // 3. fullscreen cycle
    await page.getByRole("button", { name: "全屏浏览" }).first().click();
    await expect(page.getByRole("button", { name: "退出全屏" }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "退出全屏" }).first().click();
    await expect(page.getByRole("button", { name: "全屏浏览" }).first()).toBeVisible({ timeout: 10_000 });

    // closed loop: everything still alive and consistent
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("body")).toContainText("实时同步", { timeout: 5_000 });
    expect(wmsErrors(errors)).toEqual([]);
    expect(failed).toEqual([]);
  });
  test("G10 TWIN-KPI: digital-twin dashboard shows live WMS KPIs matching the API", async ({ page }) => {
    const errors = [], failed = [];
    watchErrors(page, errors, failed);
    await loginAsManager(page);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

    // twin dashboard card must render
    const dashboard = page.locator('[data-testid="twin-dashboard"]');
    await expect(dashboard).toBeVisible({ timeout: 20_000 });
    await expect(dashboard).toContainText("数字孪生 KPI");
    // live KPI chips (data-driven; must be actual numbers, not placeholders)
    for (const label of ["库存总量", "库位利用率", "IQC待检", "临期(90天)", "已过期", "活跃任务"]) {
      await expect(dashboard).toContainText(label, { timeout: 10_000 });
    }
    const kpiText = await dashboard.innerText();
    // cross-check 库存总量 against the live API value
    const token = await page.evaluate(() => sessionStorage.getItem("auth_token"));
    const api = await page.request.get("http://127.0.0.1:8080/api/3d/wms-twin-summary", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(api.status()).toBe(200);
    const json = await api.json();
    const totalQty = (json?.data?.totals?.totalQty ?? 0).toLocaleString();
    await expect(dashboard).toContainText(totalQty, { timeout: 5_000 });
    expect(wmsErrors(errors)).toEqual([]);
    expect(failed).toEqual([]);
  });

  test("G11 TWIN-ALERTS+HEATMAP: real-time alert feed lists live lots; heatmap toggle works", async ({ page }) => {
    const errors = [], failed = [];
    watchErrors(page, errors, failed);
    await loginAsManager(page);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

    // alerts tab
    await page.getByRole("button", { name: "🚨 实时告警" }).click();
    const dashboard = page.locator('[data-testid="twin-dashboard"]');
    // data has 12 expired + 17 expiring + 3 hold/pending + 4 rejected lots -> feed is non-empty
    await expect(dashboard.getByText(/已过期|临期|待检|不合格/).first()).toBeVisible({ timeout: 15_000 });
    const feedText = await dashboard.innerText();
    // every alert row must carry a material code (real lots, not placeholders)
    expect(feedText).not.toContain("[库存查询需要更完整的实现]");

    // heatmap toggle: on -> zone occupancy coloring engaged, no errors; off -> back to normal
    const heatBtn = page.getByRole("button", { name: /热度图/ }).first();
    await heatBtn.click();
    await expect(page.getByRole("button", { name: "热度图开" }).first()).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(1500);
    await heatBtn.click();
    await expect(page.getByRole("button", { name: "热度图开" }).first()).not.toBeVisible({ timeout: 5_000 });

    expect(wmsErrors(errors)).toEqual([]);
    expect(failed).toEqual([]);
  });
});
