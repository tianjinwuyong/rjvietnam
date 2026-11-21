import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseFactoryBomWorkbook } from "../apps/web/src/pmc/bomExcelParser";

const sourceDir = process.env.BOM_SOURCE_DIR;
const apiBase = process.env.BOM_API_BASE;

describe.skipIf(!sourceDir || !apiBase)("controlled live BOM import", () => {
  it("imports new sources as drafts and converts same-revision changes into review requests", async () => {
    const login = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: process.env.BOM_API_USER ?? "admin", password: process.env.BOM_API_PASSWORD ?? "Factory@123" }),
    });
    expect(login.ok).toBe(true);
    const loginBody = await login.json() as any;
    const token = loginBody.token ?? loginBody.data?.token;
    expect(token).toBeTruthy();

    const files = fs.readdirSync(sourceDir!).filter((name) => /\.xlsx?$/i.test(name) && !name.startsWith("~$")).sort();
    const results: Array<Record<string, unknown>> = [];
    for (const name of files) {
      const fullPath = path.join(sourceDir!, name);
      const bytes = fs.readFileSync(fullPath);
      const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
      const sheets = Object.fromEntries(workbook.SheetNames.map((sheetName) => [
        sheetName,
        XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" }),
      ]));
      const parsed = parseFactoryBomWorkbook(sheets);
      const response = await fetch(`${apiBase}/boms/import`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ payload: {
          productCode: parsed.productCode,
          productName: parsed.productName,
          revision: parsed.revision,
          status: "draft",
          sourceFileName: name,
          sourceFingerprint: crypto.createHash("sha256").update(bytes).digest("hex"),
          lines: parsed.lines.map((line) => ({ ...line, qtyPer: line.qty })),
        } }),
      });
      const body = await response.json() as any;
      expect([201, 200, 409], `${name}: ${JSON.stringify(body)}`).toContain(response.status);
      if (response.status === 409) expect(body.error?.code).toBe("BOM_REVISION_CONTENT_CONFLICT");
      results.push({ file: name, product: parsed.productCode, revision: parsed.revision, status: response.status, result: body.error?.code ?? (body.data?.item?.idempotent ? "IDEMPOTENT" : "DRAFT_CREATED") });
    }
    console.table(results);
  });
});
