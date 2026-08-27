import { describe, expect, it } from "vitest";
import { isQrSourceType, nextAfterIqc, nextAfterMrb } from "./iqcDefectLoopRules";

describe("IQC defect loop rules", () => {
  it("accepts exactly the four QR receiving sources", () => {
    expect(["PO_RECEIPT", "LINE_RETURN", "REWORK_RETURN", "SUBCONTRACT_RETURN"].every(isQrSourceType)).toBe(true);
    expect(isQrSourceType("IQC")).toBe(false);
    expect(isQrSourceType("QUARANTINE")).toBe(false);
  });

  it("routes IQC pass to finished goods and fail to defect warehouse", () => {
    expect(nextAfterIqc("PASS")).toBe("FINISHED_GOODS");
    expect(nextAfterIqc("FAIL")).toBe("DEFECT_WAREHOUSE");
  });

  it("only routes MRB rework back through QR receiving", () => {
    expect(nextAfterMrb("REWORK")).toBe("QR_RECEIVING");
    expect(nextAfterMrb("SCRAP")).toBe("SCRAP");
    expect(nextAfterMrb("VENDOR_RETURN")).toBe("SUPPLIER_RETURN");
  });
});
