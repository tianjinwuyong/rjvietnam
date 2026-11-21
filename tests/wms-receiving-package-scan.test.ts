import { describe, expect, it } from "vitest";
import { resolveReceivingPackageIdentity } from "../apps/web/src/wms/receivingPackageScan";

describe("supplier package receiving identity", () => {
  const current = { materialCode: "", lotNo: "", purchaseOrder: "", supplier: "" };

  it("uses package-scan identity in the same binding operation", () => {
    expect(resolveReceivingPackageIdentity(current, {
      material_code: "MAT-001",
      lot_no: "LOT-001",
      poNo: "PO-001",
      supplierCode: "SUP-001",
    })).toEqual({ materialCode: "MAT-001", lotNo: "LOT-001", purchaseOrder: "PO-001", supplier: "SUP-001" });
  });

  it("keeps manually entered values when the scan omits optional identity", () => {
    const entered = { materialCode: "MAT-002", lotNo: "LOT-002", purchaseOrder: "PO-002", supplier: "SUP-002" };
    expect(resolveReceivingPackageIdentity(entered, { material_code: "  " })).toEqual(entered);
  });
});
