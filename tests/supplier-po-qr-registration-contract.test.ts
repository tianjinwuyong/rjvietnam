import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const portal = readFileSync(new URL("../services/supplier-portal-api/main.py", import.meta.url), "utf8");
const wms = readFileSync(new URL("../services/api/server.js", import.meta.url), "utf8");
const labelUi = readFileSync(new URL("../apps/web/src/wms/WmsSupplierLabel.tsx", import.meta.url), "utf8");

describe("supplier PO printed QR registration contract", () => {
  it("publishes the PO snapshot and exact printed QR records", () => {
    expect(portal).toContain('"purchase_order":purchase_order');
    expect(portal).toContain('"printed_qrs":printed_qrs');
    expect(portal).toContain('"SUPPLIER_PO_QRS_REGISTERED"');
    expect(portal).toContain('"wms_registration":"QUEUED"');
  });

  it("rejects labels that are not tied to the supplier PO", () => {
    expect(portal).toContain('Purchase order not found for this supplier');
    expect(portal).toContain('Material is not registered on this purchase order');
    expect(wms).toContain('supplier QR registration requires po_no');
    expect(wms).toContain('is not registered for supplier');
    expect(portal).toContain('Purchase order is not open for label printing');
    expect(labelUi).toContain('[form.po, "瑞晶订单号"]');
    expect(labelUi).toContain('disabled={!form.po}');
    expect(labelUi).toContain('/supplier-api/orders');
  });

  it("registers printed QRs idempotently without allowing reassignment", () => {
    expect(wms).toContain('const printedQrs=p.printed_qrs||p.labels||[]');
    expect(wms).toContain('is already registered to another manifest');
    expect(wms).toContain('ON CONFLICT(qr_value) DO UPDATE');
  });

  it("keeps every print and requires a reason for reprints", () => {
    expect(portal).toContain("supplier_label_print_events");
    expect(portal).toContain("Reprint reason required");
    expect(portal).toContain('"SUPPLIER_LABEL_PRINTED"');
    expect(labelUi).toContain('/supplier-api/label-print-events');
    expect(labelUi).toContain("这是重复打印，请填写重打原因");
  });
});
