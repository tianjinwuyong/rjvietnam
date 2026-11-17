import { describe, expect, it } from "vitest";
import { queryInProcess, queryNg, queryStationRows } from "../packages/shared-types/src/station-query";

describe("MES station query safety filters", () => {
  it("keeps the default NG filter when status is whitespace-only", () => {
    const rows = [
      { sn: "NG-001", status: "NG" },
      { sn: "PASS-001", status: "PASS" },
    ];

    expect(queryNg(rows, { status: "   " })).toEqual([{ sn: "NG-001", status: "NG" }]);
  });

  it("ignores whitespace-only generic filters instead of matching every row", () => {
    const rows = [
      { sn: "NG-001", station: "ICT-01" },
      { sn: "NG-002", station: "FCT-01" },
    ];

    expect(queryStationRows(rows, { station: "   " })).toEqual(rows);
  });

  it("recognizes in-process statuses regardless of API casing", () => {
    const rows = [
      { sn: "WIP-001", status: "wip" },
      { sn: "PASS-001", status: "PASS" },
    ];

    expect(queryInProcess(rows)).toEqual([{ sn: "WIP-001", status: "wip" }]);
  });
});
