import { describe, expect, it } from "vitest";
import { buildReportSessionSheets, normalizeReportSession } from "./reportSessionExport";

describe("report session export", () => {
  it("keeps an auditable session envelope and stable filter snapshot", () => {
    const session = normalizeReportSession({
      key: "work-order-progress",
      title: "Work Order Progress",
      columns: [{ key: "status", label: "Status" }],
      rows: [{ status: "running" }],
      filters: { lineCode: "L01" },
      generatedAt: "2026-08-07T00:00:00.000Z",
    });

    expect(session.totalRows).toBe(1);
    expect(session.filters).toEqual({ lineCode: "L01" });
    expect(session.generatedAt).toBe("2026-08-07T00:00:00.000Z");
  });

  it("builds an index plus one bounded sheet per report session", () => {
    const sheets = buildReportSessionSheets([
      normalizeReportSession({ key: "work-order-progress", title: "Work Order Progress", columns: [{ key: "status", label: "Status" }], rows: [{ status: "running" }], filters: {}, generatedAt: "2026-08-07T00:00:00.000Z" }),
      normalizeReportSession({ key: "inventory-ledger", title: "Inventory Ledger", columns: [{ key: "quantity", label: "Quantity" }], rows: [{ quantity: 10 }], filters: {}, generatedAt: "2026-08-07T00:00:00.000Z" }),
    ]);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["Report Sessions", "work-order-progress", "inventory-ledger"]);
    expect(sheets[0].rows[0]).toEqual(["Report Key", "Report Title", "Generated At", "Rows", "Filters"]);
    expect(sheets[1].rows[1]).toEqual(["running"]);
    expect(sheets[2].rows[1]).toEqual([10]);
  });
});
