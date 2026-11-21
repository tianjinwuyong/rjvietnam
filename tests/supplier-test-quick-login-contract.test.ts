import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const portal = readFileSync(new URL("../services/supplier-portal-api/main.py", import.meta.url), "utf8");
const portalUi = readFileSync(new URL("../apps/web/src/supplier-label-main.tsx", import.meta.url), "utf8");
const launcher = readFileSync(new URL("../start_dev.js", import.meta.url), "utf8");

describe("test supplier quick login", () => {
  it("starts the supplier API on the Vite proxy port in development", () => {
    expect(launcher).toContain("'--port', '8098'");
    expect(launcher).toContain("ENABLE_TEST_LOGIN: '1'");
    expect(launcher).toContain("startSupplierPortal();");
  });

  it("provisions the isolated test supplier when quick login is enabled", () => {
    expect(portal).toContain("def ensure_test_supplier(c):");
    expect(portal).toContain('supplier_code="SIM-SUP-001"');
    expect(portal).toContain("row=ensure_test_supplier(c)");
    expect(portal).toContain('role=\'SUPPLIER_ADMIN\'');
  });

  it("allows first supplier entry with the registered supplier name and code", () => {
    expect(portal).toContain("class SupplierEntryLogin(BaseModel):");
    expect(portal).toContain('@app.post("/supplier-entry-login")');
    expect(portal).toContain("FROM portal_suppliers WHERE supplier_code=?");
    expect(portal).toContain("registration_status AS status");
    expect(portal).toContain('str(wms["status"]).upper()=="REGISTERED"');
    expect(portal).toContain("p.registration_status='REGISTERED' AND p.portal_enabled=1");
    expect(portal).not.toContain("DELETE FROM sessions");
    expect(portal).toContain('"SUPPLIER_ENTRY_LOGIN_FAILED"');
    expect(portal).toContain('"SUPPLIER_ENTRY_LOGIN"');
    expect(portal).toContain('SUPPLIER_INITIAL_PASSWORD", "rj"');
    expect(portal).toContain("must_change_password=0");
    expect(portalUi).toContain('supplier_name: ""');
    expect(portalUi).toContain('password: ""');
    expect(portalUi).toContain('supplier_code: ""');
    expect(portalUi).toContain('/supplier-api/supplier-entry-login');
    expect(portalUi).toContain('slt("supplierName")');
    expect(portalUi).toContain('slt("supplierCode")');
    expect(portal).toContain('hmac.compare_digest(body.password.encode("utf-8"),INITIAL_PASSWORD.encode("utf-8"))');
    const firstLoginModel = portal.match(/class SupplierEntryLogin\(BaseModel\):([\s\S]*?)class PasswordChange/)?.[1] ?? "";
    expect(firstLoginModel).not.toContain("full_name");
    expect(portal).toContain('wms["supplier_name"],wms["supplier_name"]');
    expect(portalUi).toContain("function FirstPasswordChange");
    expect(portalUi).toContain("user.must_change_password");
    expect(portalUi).toContain('setPage("users")');
    expect(portal).toContain('@app.put("/sync/supplier-list/replace")');
    expect(portal).toContain("WMS_SUPPLIER_LIST_REPLACED");
    expect(portal).toContain("current_supplier_name");
  });
});
