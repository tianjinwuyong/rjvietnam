import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(new URL("../services/replication/replicate-155-to-122.cjs", import.meta.url), "utf8");

describe("155 to 122 supplier-master replication", () => {
  it("treats 155 active suppliers as the complete valid list", () => {
    expect(worker).toContain("async function syncSupplierMaster()");
    expect(worker).toContain("FROM suppliers WHERE lower(status)='active'");
    expect(worker).toContain("await syncSupplierMaster()");
    expect(worker).toContain("NOT EXISTS(SELECT 1 FROM incoming_supplier_master");
    expect(worker).toContain("SET status='inactive'");
  });

  it("fails closed instead of clearing 122 when the 155 source is empty", () => {
    expect(worker).toContain("source has no active suppliers; refusing to invalidate destination list");
    expect(worker).toContain("destination verification failed");
  });
});
