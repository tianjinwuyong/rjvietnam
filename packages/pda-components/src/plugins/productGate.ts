import type { PdaAction, PdaActionResult, PdaContext, PdaDecision, PdaPlugin } from "../contracts";

export interface ProductGateTransport {
  evaluate(request: Record<string, unknown>): Promise<{ decision: PdaDecision; code: string; messageKey?: string; data?: unknown }>;
}

export function createProductGatePlugin(transport: ProductGateTransport): PdaPlugin {
  return {
    id: "product-gate",
    version: "1.0.0",
    actions: ["product-gate.evaluate"],
    async execute(action: PdaAction, context: Readonly<PdaContext>): Promise<PdaActionResult> {
      if (action.type !== "product-gate.evaluate") {
        return { ok: false, decision: "REJECT", code: "UNSUPPORTED_ACTION", messageKey: "pda.productGate.unsupportedAction", traceId: action.traceId! };
      }
      if (!action.idempotencyKey) {
        return { ok: false, decision: "HOLD", code: "IDEMPOTENCY_REQUIRED", messageKey: "pda.productGate.idempotencyRequired", traceId: action.traceId! };
      }
      try {
        const response = await transport.evaluate({
          ...(action.payload as Record<string, unknown>),
          stationCode: context.stationCode,
          lineDomain: context.lineDomain,
          deviceId: context.deviceId,
          hostIp: context.hostIp,
          operatorId: context.operatorId,
          workOrderCode: context.workOrderCode,
          idempotencyKey: action.idempotencyKey,
          traceId: action.traceId,
        });
        return {
          ok: response.decision === "ALLOW" || response.decision === "COMPLETED",
          decision: response.decision,
          code: response.code,
          messageKey: response.messageKey ?? `pda.productGate.${response.decision.toLowerCase()}`,
          data: response.data,
          traceId: action.traceId!,
        };
      } catch {
        return { ok: false, decision: "HOLD", code: "PRODUCT_GATE_UNAVAILABLE", messageKey: "pda.productGate.unavailable", retryable: true, traceId: action.traceId! };
      }
    },
  };
}
