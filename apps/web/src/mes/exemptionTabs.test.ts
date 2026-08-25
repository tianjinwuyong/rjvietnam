import { describe, expect, it } from "vitest";
import { exemptionTabForType, filterExemptions } from "./exemptionTabs";

describe("MES exemption tabs", () => {
  it("classifies every persisted SMT exception type", () => {
    expect(exemptionTabForType("UNCLASSIFIED_MATERIAL")).toBe("material");
    expect(exemptionTabForType("BINDING_MISMATCH")).toBe("binding");
    expect(exemptionTabForType("IQC_BLOCKED")).toBe("quality");
    expect(exemptionTabForType("OFFLINE_VIOLATION")).toBe("system");
    expect(exemptionTabForType("FUTURE_EXCEPTION")).toBe("other");
  });

  it("filters without losing the authoritative row objects", () => {
    const rows = [
      { exceptionType: "IQC_BLOCKED", id: 1 },
      { exceptionType: "BINDING_MISMATCH", id: 2 },
      { exceptionType: "OFFLINE_VIOLATION", id: 3 },
    ];
    expect(filterExemptions(rows, "all")).toEqual(rows);
    expect(filterExemptions(rows, "quality").map(row => row.id)).toEqual([1]);
    expect(filterExemptions(rows, "binding").map(row => row.id)).toEqual([2]);
  });
});
