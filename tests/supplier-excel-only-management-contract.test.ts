import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ui = readFileSync(new URL("../apps/web/src/wms/WmsSupplierManagement.tsx", import.meta.url), "utf8");

describe("supplier master is managed through Excel replacement", () => {
  it("exports the active list and removes the standalone create modal", () => {
    expect(ui).toContain("const exportCurrentSuppliers = async () =>");
    expect(ui).toContain('status: "active"');
    expect(ui).toContain("XLSX.utils.json_to_sheet(rows)");
    expect(ui).not.toContain("setCreating(true)");
    expect(ui).not.toContain("{creating && (");
    expect(ui).not.toContain("void archive(supplier)");
    expect(ui).not.toContain("停用供应商并保留历史记录");
    expect(ui).not.toContain("年度明细视图");
  });
});
