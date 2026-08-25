import { describe, expect, it, vi } from "vitest";
import { createProductGatePlugin } from "./productGate";
import type { PdaContext } from "../contracts";

const context: PdaContext = {
  deviceId: "staging-pda-01",
  hostIp: "127.0.0.1",
  stationCode: "STG-FCT-01",
  lineDomain: "manual-line",
  locale: "vi-VN",
  operatorId: "staging-operator",
  workOrderCode: "WO-STAGING-001",
  configurationVersion: "staging-test",
};

describe("PDA product-gate workflow", () => {
  it("rejects unsupported action types before calling the MES gate", async () => {
    const evaluate = vi.fn();
    const plugin = createProductGatePlugin({ evaluate });

    const result = await plugin.execute({
      type: "product-gate.unknown",
      payload: { identifier: "SN-STAGING-001" },
      idempotencyKey: "idem-staging-001",
      traceId: "trace-staging-001",
    }, context);

    expect(result).toMatchObject({
      ok: false,
      decision: "REJECT",
      code: "UNSUPPORTED_ACTION",
      traceId: "trace-staging-001",
    });
    expect(evaluate).not.toHaveBeenCalled();
  });
});
