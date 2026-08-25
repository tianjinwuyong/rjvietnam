import { describe, expect, it } from "vitest";
import {
  buildRepairStationCommand,
  normalizeRepairStationContext,
  validateMaterialUsage,
} from "./repairStationIntegration";

describe("repair station integration contract", () => {
  it("normalizes the three-domain context without inventing service data", () => {
    const context = normalizeRepairStationContext({
      mes: { available: true, workOrder: { status: "WAITING_REPAIR" } },
      wms: { available: false },
      qms: { available: true, case: { status: "OPEN" } },
    });

    expect(context.mes.workOrder?.status).toBe("WAITING_REPAIR");
    expect(context.wms.available).toBe(false);
    expect(context.wms.lots).toEqual([]);
    expect(context.qms.case?.status).toBe("OPEN");
  });

  it("rejects material usage without a positive quantity or lot", () => {
    expect(validateMaterialUsage({ materialCode: "CAP-1", lotNo: "", quantity: 1 })).toEqual({
      valid: false,
      error: "material lot is required",
    });
    expect(validateMaterialUsage({ materialCode: "CAP-1", lotNo: "LOT-1", quantity: 0 })).toEqual({
      valid: false,
      error: "quantity must be greater than zero",
    });
  });

  it("builds an auditable command envelope for MES adjudication", () => {
    const command = buildRepairStationCommand({
      type: "MATERIAL_USAGE_RECORDED",
      stationCode: "REPAIR-01",
      sn: "SN-001",
      workOrderNo: "RWO-1",
      operator: "tech-1",
      payload: { materialCode: "CAP-1", lotNo: "LOT-1", quantity: 2 },
    });

    expect(command.eventId).toMatch(/^repair-/);
    expect(command.authority).toBe("MES");
    expect(command.payload).toEqual({ materialCode: "CAP-1", lotNo: "LOT-1", quantity: 2 });
  });
});
// @ts-nocheck
