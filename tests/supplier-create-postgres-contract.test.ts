import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const api = readFileSync(new URL("../services/api/server.js", import.meta.url), "utf8");

describe("WMS supplier creation PostgreSQL contract", () => {
  it("does not reuse nameZh as differently typed SQL parameters", () => {
    expect(api).toContain("const nameZh=String(p.nameZh).trim()");
    expect(api).toContain("nameEn=String(p.nameEn||nameZh).trim()");
    expect(api).not.toContain("coalesce(nullif($3,''),$2)");
  });
});
