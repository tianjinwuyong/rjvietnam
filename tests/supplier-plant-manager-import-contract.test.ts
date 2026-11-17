import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const api = readFileSync(new URL("../services/api/server.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../apps/web/src/wms/WmsSupplierManagement.tsx", import.meta.url), "utf8");

describe("plant manager supplier-list replacement", () => {
  it("enforces plant-management authorization and an auditable transaction", () => {
    expect(api).toContain('new Set(["admin","management","plant_manager","factory_manager"]).has(role)');
    expect(ui).toContain('["admin", "management", "plant_manager", "factory_manager"].includes(roleKey.trim().toLowerCase())');
    expect(api).toContain('action:"SUPPLIER_IMPORT_DENIED"');
    expect(api).toContain('SUPPLIER_LIST_REPLACED_BY_PLANT_MANAGER');
    expect(api).toContain('await client.query("BEGIN")');
    expect(api).toContain('await client.query("COMMIT")');
    expect(api).toContain("SET status='inactive'");
    expect(api).toContain("NOT EXISTS(SELECT 1 FROM incoming_supplier_import");
    expect(api).toContain("qualification_status='QUALIFIED'");
    expect(api).toContain("false,false,'QUALIFIED','LOW'");
    expect(ui).not.toContain("stats.review");
    expect(ui).not.toContain("<Status value={s.qualification_status} />\n                      <Status value={s.risk_level} />");
    expect(ui).not.toContain("同步远程门户");
    expect(ui).not.toContain('["audit", "审计记录"');
  });

  it("previews the newest selected file before confirmation", () => {
    expect(ui).toContain("sourceModifiedAt: new Date(file.lastModified).toISOString()");
    expect(ui).toContain("isSingleAnnualOrderList");
    expect(api).toContain('createHash("sha256").update(JSON.stringify([...incoming.values()]))');
    expect(ui).toContain("setImportPreview");
    expect(ui).toContain('"/wms/suppliers/import-replace"');
    expect(api).toContain('`${portalBase}/sync/supplier-list/replace`');
  });
});
