import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canCompleteOqcBatch } from "../apps/web/src/qms/QmsOqcBatches";

const oqc = readFileSync(new URL("../apps/web/src/qms/QmsOqcBatches.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../apps/web/src/qms/QmsApp.tsx", import.meta.url), "utf8");

describe("OQC staging UI contract", () => {
  it("keeps OQC batch disposition explicit and prevents incomplete submissions", () => {
    expect(oqc).toMatch(/PASS|合格/);
    expect(oqc).toMatch(/FAIL|NG|不合格/);
    expect(oqc).toMatch(/inspectionItems|items/);
    expect(oqc).toContain("canCompleteOqcBatch");
  });

  it.each([
    [[], false],
    [[{ result: "PASS" }, { result: "FAIL" }], false],
    [[{ result: "PASS" }, { result: "HOLD" }], false],
    [[{ result: "PASS" }, { result: "PASS" }], true],
  ])("allows completion only when every item passes", (items, expected) => {
    expect(canCompleteOqcBatch(items as Array<{ result?: string }>)).toBe(expected);
  });

  it("exposes OQC as a QMS tab", () => {
    expect(api).toMatch(/OQC|oqc/);
  });
});
