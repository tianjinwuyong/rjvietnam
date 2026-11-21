import { describe, expect, it } from "vitest";
import { normalizePdaMaterialLoad, validatePdaMaterialLoad } from "../packages/pda-components/src";

const valid = { operatorBadge: " op-01 ", materialSn: " reel-01 ", materialCode: " mat-01 ", qty: "10", sourceLocationCode: "WH-A01", destinationLocationCode: "LINE-L001-BUF", workOrderCode: "WO-1", machineCode: "NPM-01", channelCode: "L01", feederCode: "F01", slotNo: "F01", idempotencyKey: "load-1" };

describe("PDA material loading boundary", () => {
  it("normalizes scanner values and accepts a complete load", () => {
    expect(normalizePdaMaterialLoad(valid)).toMatchObject({ operatorBadge: "OP-01", materialSn: "REEL-01", qty: 10 });
    expect(validatePdaMaterialLoad(valid)).toEqual([]);
  });
  it("requires operator, locations, identity and positive quantity", () => {
    expect(validatePdaMaterialLoad({ ...valid, operatorBadge: "", sourceLocationCode: "", destinationLocationCode: "", materialCode: "", qty: 0 })).toEqual(expect.arrayContaining(["operatorBadge required", "sourceLocationCode required", "destinationLocationCode required", "materialCode required", "qty must be a positive number"]));
  });
  it("rejects a same-location move", () => {
    expect(validatePdaMaterialLoad({ ...valid, destinationLocationCode: valid.sourceLocationCode })).toContain("source and destination locations must differ");
  });
});
