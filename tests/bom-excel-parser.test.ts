import { describe, expect, it } from "vitest";
import { parseFactoryBomWorkbook } from "../apps/web/src/pmc/bomExcelParser";

describe("factory BOM workbook parser", () => {
  it("keeps purchased leaves and excludes assemblies, zero quantities and substitutes", () => {
    const result = parseFactoryBomWorkbook({
      BOM: [["Anker BOM V0.5"]],
      "BOM\u591a\u7ea7\u5c55\u5f00": [
        ["2.02.00.21.0139", "", "A2672 finished product"],
        ["\u5c42\u6b21", "\u5b50\u9879\u7269\u6599\u4ee3\u7801", "\u8d8a\u5357\u6599\u53f7", "\u7269\u6599\u540d\u79f0", "\u7269\u6599\u5c5e\u6027", "\u57fa\u672c\u5355\u4f4d", "\u57fa\u672c\u5355\u4f4d\u7528\u91cf", "\u635f\u8017\u7387(%)"],
        ["1", "ASM-01", "", "assembly", "\u81ea\u5236", "PCS", 1, 0],
        ["1.1", "CN-001", "VN-001", "capacitor", "\u5916\u8d2d", "PCS", 2, "2%"],
        ["1.2", "CN-ZERO", "VN-ZERO", "inactive", "\u5916\u8d2d", "PCS", 0, 0],
        ["\u66ff\u4ee3", "CN-SUB", "VN-SUB", "substitute", "\u66ff\u4ee3\u5916\u8d2d", "PCS", 2, 0],
      ],
    });

    expect(result.productCode).toBe("2.02.00.21.0139");
    expect(result.revision).toBe("V0.5");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ materialCode: "VN-001", chinaMaterialCode: "CN-001", qty: 2, lossRate: 0.02 });
    expect(result.warnings).toHaveLength(2);
  });
});
