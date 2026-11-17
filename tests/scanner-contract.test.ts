import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("scanner observation contract",()=>{
  it("keeps processScan read-only and fail-closed",()=>{
    const source=fs.readFileSync(path.resolve("apps/station-agent/src/scanEngine.ts"),"utf8");
    const start=source.indexOf("export async function processScan(");
    const end=source.indexOf("export async function recordScanFail(");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const processScan=source.slice(start,end);
    expect(processScan).not.toContain(".add(");
    expect(processScan).not.toContain("syncQueue");
    expect(processScan).not.toContain("recordLocal");
    expect(processScan).toContain("mes_guard_unavailable");
  });
});
