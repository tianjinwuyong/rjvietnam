import { describe, expect, it } from "vitest";
import { requireMesProcess } from "../services/api/src/mes-process-registry.js";

describe("MES process registry", () => {
  it("accepts manual-line material usage only in its own process", () => {
    expect(requireMesProcess("MANUAL_LINE_MATERIAL_USAGE", "manual-line", "MATERIAL_USAGE_REPORTED"))
      .toMatchObject({ ok: true, code: "MES_PROCESS_ACCEPTED", process: { domain: "manual-line" } });
  });

  it("rejects routing a manual fact through the SMT process", () => {
    expect(requireMesProcess("SMT_MACHINE_CONSUMPTION", "manual-line", "MATERIAL_USAGE_REPORTED"))
      .toMatchObject({ ok: false, code: "MES_PROCESS_DOMAIN_MISMATCH" });
  });

  it("rejects a fact type that the selected process does not own", () => {
    expect(requireMesProcess("MANUAL_LINE_MATERIAL_LOADING", "manual-line", "MATERIAL_USAGE_REPORTED"))
      .toMatchObject({ ok: false, code: "FACT_NOT_ACCEPTED_BY_PROCESS" });
  });
});
