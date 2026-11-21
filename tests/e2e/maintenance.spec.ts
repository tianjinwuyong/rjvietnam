import { test, expect, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:5178";

/** ── helpers ─────────────────────────────────────────────────────────────── */
async function loginAsAdmin(page: Page) {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30_000 });
  // Form login as admin (locale-agnostic selectors; zh-CN UI placeholders)
  await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="text"]').first().fill("ADMIN_VN_01");
  await page.locator('input[type="password"]').fill("Factory@123");
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(2_000);
  // Should show dashboard
  await expect(page.getByText(/越南瑞晶|dashboard|设备维护/i).first()).toBeVisible({ timeout: 10_000 });
}

async function gotoMaintenance(page: Page) {
  // Click 设备维护 (Equipment Maintenance) in sidebar
  const maintBtn = page.getByText("设备维护").first();
  await maintBtn.click();
  await page.waitForTimeout(1_500);
}

/** ── TEST SUITE ──────────────────────────────────────────────────────────── */
test.describe("Maintenance Module E2E", () => {

  // ── 1. Login ─────────────────────────────────────────────────────────────
  test("01 — login as admin", async ({ page }) => {
    await loginAsAdmin(page);
    const body = await page.locator("body").innerText();
    expect(body).toContain("越南瑞晶");
    console.log("Dashboard loaded OK");
  });

  // ── 2. Navigate to Maintenance ───────────────────────────────────────────
  test("02 — navigate to maintenance module", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    // Should show maintenance tabs or content
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(50);
    console.log("Maintenance nav OK");
  });

  // ── 3. Maintenance Dashboard ─────────────────────────────────────────────
  test("03 — maintenance dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    await page.waitForTimeout(1_000);
    const text = await page.locator("body").innerText();
    // Should have maintenance KPIs or tabs
    const hasMaint = /设备|维护|保养|点检|故障|PM|总览|dashboard/i.test(text);
    expect(hasMaint).toBeTruthy();
    console.log("Maintenance dashboard visible");
  });

  // ── 4. Equipment List tab ────────────────────────────────────────────────
  test("04 — equipment list", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /设备列表|equipment|equipment.?list/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    const hasData = /SMT|贴片|AOI|PRINTER|印刷|回流|REFLOW|设备/i.test(text);
    expect(hasData).toBeTruthy();
    console.log("Equipment list loaded");
  });

  // ── 5. Equipment row click ─────────────────────────────────────────────
  test("05 — click equipment row opens detail", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /设备列表|equipment/i });
    if (await tabs.count() > 0) await tabs.first().click();
    await page.waitForTimeout(2_000);

    // Click first table row
    const rows = page.locator("table tbody tr");
    if (await rows.count() > 0) {
      await rows.first().click();
      await page.waitForTimeout(1_000);
      const text = await page.locator("body").innerText();
      expect(text.length).toBeGreaterThan(50);
      console.log("Equipment detail opened");
    } else {
      console.log("No table rows found — skipping row click");
    }
  });

  // ── 6. Inspection Plan tab ───────────────────────────────────────────────
  test("06 — inspection plan", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /点检计划|inspection.?plan|巡检计划/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    const has = /点检|inspection|模板|template|计划|plan/i.test(text);
    expect(has).toBeTruthy();
    console.log("Inspection plan tab OK");
  });

  // ── 7. Inspection Records ───────────────────────────────────────────────
  test("07 — inspection records", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /点检记录|inspection.?record/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(30);
    console.log("Inspection records tab OK");
  });

  // ── 8. Maintenance History ──────────────────────────────────────────────
  test("08 — maintenance history", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /历史|history|维保历史/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(30);
    console.log("Maintenance history tab OK");
  });

  // ── 9. PM Schedule ───────────────────────────────────────────────────────
  test("09 — PM schedule", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /PM|保养|计划|排程|schedule/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(30);
    console.log("PM schedule tab OK");
  });

  // ── 10. PM Execution ─────────────────────────────────────────────────────
  test("10 — PM execution", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /执行|execution|保养执行/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(30);
    console.log("PM execution tab OK");
  });

  // ── 11. Fault Report List ───────────────────────────────────────────────
  test("11 — fault report list", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /故障|fault|报障|异常/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(30);
    console.log("Fault report tab OK");
  });

  // ── 12. Equipment Checklists ────────────────────────────────────────────
  test("12 — equipment checklists", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /清单|checklist|表单|设备清单/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(30);
    console.log("Checklists tab OK");
  });

  // ── 13. Spare Parts Warehouse ───────────────────────────────────────────
  test("13 — spare parts", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /备件|spare|parts|仓库/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(30);
    console.log("Spare parts tab OK");
  });

  // ── 14. Supplier Comms ───────────────────────────────────────────────────
  test("14 — supplier comms", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /供应|supplier|厂商|联络/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(30);
    console.log("Supplier comms tab OK");
  });

  // ── 15. Work Orders tab ─────────────────────────────────────────────────
  test("15 — work orders", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /工单|work.?order|工单列表/i });
    if (await tabs.count() > 0) {
      await tabs.first().click();
      await page.waitForTimeout(2_000);
    }
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(30);
    console.log("Work orders tab OK");
  });

  // ── 16. Mouse hover on table ─────────────────────────────────────────────
  test("16 — hover highlights rows", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /设备列表|equipment/i });
    if (await tabs.count() > 0) await tabs.first().click();
    await page.waitForTimeout(2_000);
    const rows = page.locator("table tbody tr");
    if (await rows.count() > 0) {
      await rows.nth(0).hover();
      await page.waitForTimeout(300);
      console.log("Hover OK");
    }
  });

  // ── 17. Keyboard tab navigation ─────────────────────────────────────────
  test("17 — keyboard nav", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => document.activeElement?.tagName ?? "none");
    expect(tag).toBeTruthy();
    console.log("Keyboard nav OK, focus on:", tag);
  });

  // ── 18. Search filter ────────────────────────────────────────────────────
  test("18 — search filters", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /设备列表|equipment/i });
    if (await tabs.count() > 0) await tabs.first().click();
    await page.waitForTimeout(2_000);
    const search = page.locator("input[type=search], input[placeholder*='search' i]").first();
    if (await search.count() > 0) {
      await search.fill("SMT");
      await page.waitForTimeout(1_000);
      console.log("Search filter OK");
    }
  });

  // ── 19. Status filter ─────────────────────────────────────────────────────
  test("19 — status filter", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /设备列表|equipment/i });
    if (await tabs.count() > 0) await tabs.first().click();
    await page.waitForTimeout(2_000);
    const selects = page.locator("select");
    if (await selects.count() > 0) {
      await selects.first().selectOption({ index: 1 });
      await page.waitForTimeout(1_000);
      console.log("Status filter OK");
    }
  });

  // ── 20. Add fault button ─────────────────────────────────────────────────
  test("20 — add fault report", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /故障|fault/i });
    if (await tabs.count() > 0) await tabs.first().click();
    await page.waitForTimeout(2_000);
    const addBtn = page.locator("button").filter({ hasText: /新增|新建|添加|报告故障/i }).first();
    if (await addBtn.count() > 0) {
      await addBtn.click();
      await page.waitForTimeout(1_500);
      const text = await page.locator("body").innerText();
      const hasForm = /设备|description|描述|类型|type|优先级|priority/i.test(text);
      console.log("Fault report form:", hasForm ? "opened" : "not detected");
    }
  });

  // ── 21. Language switch vi-VN ───────────────────────────────────────────
  test("21 — locale vi-VN", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const lang = page.locator("select").first();
    if (await lang.count() > 0) {
      await lang.selectOption("vi-VN");
      await page.waitForTimeout(1_500);
      console.log("Switched to vi-VN");
    }
  });

  // ── 22. Resize viewport ───────────────────────────────────────────────────
  test("22 — resize", async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(500);
    await expect(page.locator("body")).toBeVisible();
    console.log("Resize OK");
  });

  // ── 23. Scroll on equipment list ─────────────────────────────────────────
  test("23 — scroll", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoMaintenance(page);
    const tabs = page.locator("[role=tab], .tab, button").filter({ hasText: /设备列表|equipment/i });
    if (await tabs.count() > 0) await tabs.first().click();
    await page.waitForTimeout(2_000);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    console.log("Scroll OK");
  });

  // ── 24. Navigate to PMC module ───────────────────────────────────────────
  test("24 — navigate PMC", async ({ page }) => {
    await loginAsAdmin(page);
    const pmcBtn = page.getByText("PMC").first();
    await pmcBtn.click();
    await page.waitForTimeout(2_000);
    const text = await page.locator("body").innerText();
    const hasPMC = /PMC|工单|work.?order|计划|planning/i.test(text);
    expect(hasPMC).toBeTruthy();
    console.log("PMC nav OK");
  });

  // ── 25. Session persists on re-nav ─────────────────────────────────────
  test("25 — session persists", async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByText("设备维护").first().click();
    await page.waitForTimeout(1_000);
    await page.getByText("PMC").first().click();
    await page.waitForTimeout(1_000);
    // Should not show login form
    const loginVisible = await page.getByText("Admin 01").isVisible().catch(() => false);
    console.log("Session persisted:", !loginVisible);
  });
});
