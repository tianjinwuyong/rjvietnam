import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const receiving = readFileSync(new URL("../apps/web/src/wms/WmsPdaReceiving.tsx", import.meta.url), "utf8");
const scene = readFileSync(new URL("../apps/web/src/mes/WarehouseScene3d.tsx", import.meta.url), "utf8");

describe("PDA receiving → WMS 3D status bridge", () => {
  it("publishes every receiving lifecycle phase through the shared browser bridge", () => {
    expect(receiving).toContain('"wms:pda-receiving-status"');
    for (const phase of ["SCANNED", "RECEIVING", "COMPLETED", "FAILED"]) {
      expect(receiving).toContain(`phase: "${phase}"`);
    }
    expect(receiving).toContain("localStorage.setItem");
    expect(receiving).toContain("new CustomEvent<PdaReceivingStatus>");
  });

  it("does not leave user-visible validation or ledger lookup failures stuck as RECEIVING", () => {
    expect(receiving).toContain('publishReceivingStatus({ phase: "FAILED"');
    expect(receiving).toContain('setFeedback({ ok: false');
    expect(receiving).toContain("!materialLotId");
  });

  it("lets the 3D scene consume same-tab and cross-tab updates and refresh WMS data", () => {
    expect(scene).toContain('window.addEventListener("wms:pda-receiving-status"');
    expect(scene).toContain('window.addEventListener("storage"');
    expect(scene).toContain("refreshWms()");
    expect(scene).toContain('data-testid="pda-receiving-live"');
    expect(scene).toContain('pdaReceiving.phase === "FAILED"');
  });
});
